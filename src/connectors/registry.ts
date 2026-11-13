/**
 * The connectors Atlas offers. A connector is "sign in to another tool, read
 * it, and produce the file its import source already reads", so the result
 * enters the ordinary capture pipeline untouched. Adding one: a kind in
 * `src/contracts/connectors.ts` (and the `org_connectors.kind` check), a
 * fetcher beside `mulesoft/`, an entry here, and a settings form.
 */
import type { ConnectorKind } from '../contracts/connectors';
import { parseMulesoftConfig } from '../contracts/connectors';
import type { ImportSourceId } from '../capture/importSources';
import type { Http } from './http';
import { fetchMulesoftExport, listEnvironments, signIn, type AnypointDeps } from './mulesoft/anypoint';

export interface ConnectorRuntime {
  http: Http;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export interface FetchedFile {
  fileName: string;
  text: string;
  warnings: string[];
}

export interface ConnectorDefinition {
  kind: ConnectorKind;
  label: string;
  /** The import source whose dialog this connector feeds. */
  importSource: ImportSourceId;
  /** Checks stored settings; plain-English error when they are not usable. */
  validateConfig: (config: unknown) => { ok: true } | { ok: false; error: string };
  /** Signs in and reads something small, to prove the settings work. Returns a sentence for the person. */
  test: (runtime: ConnectorRuntime, config: unknown, secret: string) => Promise<string>;
  /** Reads everything and returns the file. */
  fetch: (runtime: ConnectorRuntime, config: unknown, secret: string) => Promise<FetchedFile>;
}

function mulesoftConfigOrThrow(config: unknown) {
  const parsed = parseMulesoftConfig(config);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.config;
}

export const CONNECTORS: readonly ConnectorDefinition[] = [
  {
    kind: 'mulesoft',
    label: 'MuleSoft Anypoint',
    importSource: 'mulesoft',
    validateConfig: (config) => {
      const parsed = parseMulesoftConfig(config);
      return parsed.ok ? { ok: true } : parsed;
    },
    test: async (runtime, config, secret) => {
      const c = mulesoftConfigOrThrow(config);
      const deps: AnypointDeps = runtime;
      const token = await signIn(deps, c.region, c.clientId, secret);
      const environments = await listEnvironments(deps, c, token);
      const missing = c.environments.filter((name) => !environments.some((e) => e.name.toLowerCase() === name.toLowerCase()));
      if (missing.length === c.environments.length) return `Signed in, but none of ${c.environments.join(', ')} exist in this organisation. Anypoint has: ${environments.map((e) => e.name).join(', ') || 'no environments the app can see'}.`;
      return missing.length > 0 ? `Signed in. ${missing.join(', ')} ${missing.length === 1 ? 'was' : 'were'} not found, the rest were.` : `Signed in, and found ${c.environments.join(', ')}.`;
    },
    fetch: async (runtime, config, secret) => {
      const c = mulesoftConfigOrThrow(config);
      const document = await fetchMulesoftExport(runtime, c, secret);
      return { fileName: 'mulesoft-export.json', text: JSON.stringify(document), warnings: document.warnings };
    },
  },
];

export function connectorByKind(kind: string): ConnectorDefinition | undefined {
  return CONNECTORS.find((c) => c.kind === kind);
}
