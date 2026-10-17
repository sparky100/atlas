/**
 * MuleSoft Anypoint capture adapter (docs/import/mulesoft/mulesoft-export.mjs's
 * output in, the JSON import format of SPEC-capture.md §5.6 out) — a pure
 * conversion, so the existing capture pipeline (matching, review queue,
 * apply to a change) does everything after it, unchanged.
 *
 * What an Anypoint export can and can't say (ADR-026 shapes the output):
 * - one `integration_platform` system, one interface (an `api` module of it)
 *   per API instance, one consumer system per client application;
 * - a client application with an approved contract on an API consumes that
 *   API's interface. When the API's backend hostname is mapped to an Atlas
 *   element (`options.aliases`) the consumer *flows to* that element `via`
 *   the interface (the business-level A→B fact ADR-026 keeps); otherwise the
 *   consumer `uses` the interface and the hostname is listed in the report so
 *   it can be mapped. Nothing is ever guessed from a hostname.
 *
 * Deterministic and I/O-free (CLAUDE.md rules 6 and 7): the same file and
 * options give the same output, every confidence is a named constant here,
 * and nothing in the export is invented — owners, capabilities and costs are
 * simply absent.
 */
import { z } from 'zod';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../../engine/trigram';
import { normaliseName } from '../normalise';

/** Confidence per kind of fact: what Anypoint states outright vs what we infer from it. */
export const MULESOFT_CONFIDENCE = {
  platform: 0.85,
  interface: 0.85,
  consumer: 0.6,
  consumerToInterface: 0.85,
  flowToMappedProducer: 0.7,
} as const;

export const DEFAULT_MULESOFT_PLATFORM_NAME = 'MuleSoft Anypoint';

const nullableString = z.string().nullish();

const apiSchema = z.object({
  id: z.union([z.number(), z.string()]),
  assetId: z.string().min(1),
  assetVersion: nullableString,
  productVersion: nullableString,
  instanceLabel: nullableString,
  description: nullableString,
  endpointUri: nullableString,
  endpointType: nullableString,
  deprecated: z.boolean().nullish(),
  activeContractsCount: z.number().nullish(),
});

const contractSchema = z.object({
  id: z.union([z.number(), z.string()]),
  status: z.string(),
  application: z.object({ id: z.union([z.number(), z.string()]), name: z.string().min(1) }).nullish(),
});

const exportSchema = z.object({
  format: z.literal('atlas-mulesoft-export'),
  version: z.literal(1),
  organizationId: nullableString,
  environments: z.array(
    z.object({
      name: z.string().min(1),
      apis: z.array(apiSchema),
      contracts: z.record(z.string(), z.array(contractSchema)),
    }),
  ),
});

export type MulesoftExportFile = z.infer<typeof exportSchema>;

export type ParseMulesoftExportResult = { ok: true; file: MulesoftExportFile } | { ok: false; error: string };

export function parseMulesoftExport(text: string): ParseMulesoftExportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `Could not read the file as JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined || first.path.length === 0 ? 'the file' : first.path.join('.');
    return { ok: false, error: `This is not a MuleSoft export made by Atlas's export script (problem at ${where}: ${first?.message ?? 'invalid'}).` };
  }
  return { ok: true, file: parsed.data };
}

export interface MulesoftConversionOptions {
  /** The platform element's name. */
  platformName?: string;
  /** Backend hostname (lower case) → the name of the Atlas element that provides it. Optional; unmapped hostnames only appear in the report. */
  aliases?: Readonly<Record<string, string>>;
}

export interface MulesoftConversionReport {
  counts: { interfaces: number; consumers: number; relationships: number; flowsToProducer: number };
  /** Contracts that did not become a relationship, with why. */
  skippedContracts: { contractId: string; apiId: string; reason: string }[];
  /** Backend hostnames with no mapping: add them to the alias file to get a flow to the producer. */
  unmappedHosts: string[];
  /** Names the importer's duplicate check would merge into one element (SPEC-capture §5.2); nothing in the file can stop that today. */
  nameCollisions: { names: string[] }[];
  warnings: string[];
}

export interface MulesoftImportJson {
  systems: Record<string, unknown>[];
  relationships: Record<string, unknown>[];
  changes: Record<string, unknown>[];
}

/** "test-2" → "Test 2", "customer_orders" → "Customer Orders". */
export function readableName(assetId: string): string {
  return assetId
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function hostOf(endpointUri: string): string | null {
  try {
    return new URL(endpointUri).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

interface InterfaceInfo {
  api: z.infer<typeof apiSchema>;
  environment: string;
  name: string;
}

export function convertMulesoftExport(file: MulesoftExportFile, options: MulesoftConversionOptions = {}): { importJson: MulesoftImportJson; report: MulesoftConversionReport } {
  const platformName = options.platformName ?? DEFAULT_MULESOFT_PLATFORM_NAME;
  const aliases = new Map(Object.entries(options.aliases ?? {}).map(([host, target]) => [host.toLowerCase(), target]));
  const multipleEnvironments = file.environments.length > 1;
  const report: MulesoftConversionReport = { counts: { interfaces: 0, consumers: 0, relationships: 0, flowsToProducer: 0 }, skippedContracts: [], unmappedHosts: [], nameCollisions: [], warnings: [] };

  const systems: Record<string, unknown>[] = [
    {
      name: platformName,
      kind: 'integration_platform',
      vendor: 'MuleSoft',
      hosting_model: 'saas',
      quote: `Anypoint organisation ${file.organizationId ?? '(unknown)'}`,
      confidence: MULESOFT_CONFIDENCE.platform,
    },
  ];
  const relationships: Record<string, unknown>[] = [];

  // Consumers are keyed by Anypoint application id, so one app on several APIs is one system.
  const consumers = new Map<string, { name: string; quote: string }>();
  const unmappedHosts = new Set<string>();
  const interfaceNames: string[] = [];

  for (const environment of file.environments) {
    const apis = [...environment.apis].sort((a, b) => Number(a.id) - Number(b.id));
    for (const api of apis) {
      const baseName = (api.instanceLabel ?? '').trim() !== '' ? (api.instanceLabel ?? '').trim() : readableName(api.assetId);
      const info: InterfaceInfo = { api, environment: environment.name, name: multipleEnvironments ? `${baseName} (${environment.name})` : baseName };
      interfaceNames.push(info.name);
      const via = `${platformName} · ${info.name}`;
      const quote = `API Manager instance ${String(api.id)}, assetId ${api.assetId}${api.assetVersion ? ` v${api.assetVersion}` : ''}, environment ${environment.name}`;

      const row: Record<string, unknown> = { name: info.name, platform: platformName, interface_type: 'api', quote, confidence: MULESOFT_CONFIDENCE.interface };
      if ((api.description ?? '').trim() !== '') row.description = (api.description ?? '').trim();
      if (api.deprecated === true) row.lifecycle = 'retiring';
      systems.push(row);
      report.counts.interfaces += 1;

      const contracts = environment.contracts[String(api.id)] ?? [];
      const approved = contracts.filter((contract) => contract.status.toUpperCase() === 'APPROVED');
      for (const contract of contracts) {
        if (contract.status.toUpperCase() !== 'APPROVED') report.skippedContracts.push({ contractId: String(contract.id), apiId: String(api.id), reason: `status ${contract.status}, not approved` });
        else if (contract.application === null || contract.application === undefined) report.skippedContracts.push({ contractId: String(contract.id), apiId: String(api.id), reason: 'no client application on the contract' });
      }
      if (typeof api.activeContractsCount === 'number' && api.activeContractsCount !== approved.length) {
        report.warnings.push(`API ${String(api.id)} (${info.name}) reports ${String(api.activeContractsCount)} active contract(s) but the export holds ${String(approved.length)} approved.`);
      }

      const host = api.endpointUri === null || api.endpointUri === undefined || api.endpointUri.trim() === '' ? null : hostOf(api.endpointUri);
      if (api.endpointUri !== null && api.endpointUri !== undefined && api.endpointUri.trim() !== '' && host === null) report.warnings.push(`API ${String(api.id)} (${info.name}): could not read its endpoint "${api.endpointUri}" as a URL.`);
      const producer = host === null ? undefined : aliases.get(host);
      if (host !== null && producer === undefined) unmappedHosts.add(host);

      const seenApps = new Set<string>();
      for (const contract of approved) {
        const application = contract.application;
        if (application === null || application === undefined) continue;
        const appKey = String(application.id);
        const existing = consumers.get(appKey);
        if (existing === undefined) consumers.set(appKey, { name: application.name, quote: `Anypoint client application ${appKey}` });
        else if (existing.name !== application.name) report.warnings.push(`Client application ${appKey} is named "${existing.name}" and "${application.name}"; using the first.`);
        if (seenApps.has(appKey)) continue;
        seenApps.add(appKey);

        const appName = (existing ?? { name: application.name }).name;
        const contractIds = approved.filter((c) => String(c.application?.id) === appKey).map((c) => String(c.id));
        const relationshipQuote = `Contract ${contractIds.join(', ')}, APPROVED, application ${appName} -> API ${String(api.id)} (${environment.name})`;
        const protocol = (api.endpointType ?? '').toLowerCase() === 'http' ? { protocol_in: 'rest_api' } : {};
        if (producer !== undefined) {
          relationships.push({ from: appName, type: 'flows_to', to: producer, description: 'calls', via, ...protocol, quote: `${relationshipQuote}; backend ${host ?? ''}`, confidence: MULESOFT_CONFIDENCE.flowToMappedProducer });
          report.counts.flowsToProducer += 1;
        } else {
          relationships.push({ from: appName, type: 'uses', to: via, description: 'consumes', ...protocol, quote: relationshipQuote, confidence: MULESOFT_CONFIDENCE.consumerToInterface });
        }
        report.counts.relationships += 1;
      }
    }
  }

  for (const consumer of consumers.values()) {
    systems.push({ name: consumer.name, quote: consumer.quote, confidence: MULESOFT_CONFIDENCE.consumer });
    report.counts.consumers += 1;
  }
  report.unmappedHosts = [...unmappedHosts].sort();

  // The importer folds near-identical names in one place into a single element; say so before the user finds out in review.
  const collide = (names: readonly string[]): void => {
    const done = new Set<string>();
    names.forEach((a, i) => {
      for (const b of names.slice(i + 1)) {
        if (done.has(`${a}|${b}`)) continue;
        if (trigramSimilarity(normaliseName(a), normaliseName(b)) >= IDENTITY_TRIGRAM_THRESHOLD) {
          done.add(`${a}|${b}`);
          report.nameCollisions.push({ names: [a, b] });
        }
      }
    });
  };
  collide(interfaceNames);
  collide([platformName, ...[...consumers.values()].map((consumer) => consumer.name)]);
  for (const collision of report.nameCollisions) {
    report.warnings.push(`"${collision.names[0] ?? ''}" and "${collision.names[1] ?? ''}" look like the same name to the importer and would be merged into one element.`);
  }

  return { importJson: { systems, relationships, changes: [] }, report };
}
