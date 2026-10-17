/**
 * F2 (full K1), SPEC-capture.md §5.2 step 2: the checked-in synonym table —
 * every header text below maps to its role with confidence 1.0, no LLM
 * call needed. Anything else falls through to prompt A (§6.1,
 * `mapColumns.ts`). Keys are `normaliseName(header)` (§7.2), so "Business
 * Owner", "business owner" and "Business  Owner" are all one lookup.
 *
 * Deliberate, disclosed narrowing: §5.2's own table lists bare "System" and
 * "Application" as example headers for *both* `name` (a systems-inventory
 * sheet) and `parent` ("on a Modules sheet") — one header text can't map to
 * two roles in a flat table. `name` is the far more common reading for a
 * bare "System"/"Application" column (most sheets aren't a Modules sheet),
 * so both stay mapped to `name` here; a genuine Modules-sheet `parent`
 * column is still unambiguous under its own wording ("Parent system",
 * "Part of").
 */
import { normaliseName } from './normalise';
import type { PromptAColumnRole } from './prompts/a';
import type { EvidenceWarning } from '../contracts/capture';

/**
 * F11: column roles reachable through this synonym table only, never
 * offered to prompt A (`actorType`, 2026-10-08: the export's own "Actor type"). Prompt A's text is frozen and its replay cassettes
 * are keyed on the exact request, so a new LLM role waits until they can be
 * re-recorded live; until then an exact synonym header ("TIME",
 * "Disposition", …) maps deterministically and any other header can't
 * reach the role at all.
 */
export type SynonymOnlyColumnRole =
  | 'disposition'
  | 'actorType'
  // The rest are attributes validated against the element's own attribute schema (`rowsToCandidates.ts`'s `SCHEMA_ATTRIBUTE_ROLE_KEYS`) — columns this product's own export writes.
  | 'kind'
  | 'criticality'
  | 'domain'
  | 'version'
  | 'annualRunCost'
  | 'supportEndsAt'
  | 'orgUnit'
  | 'capabilityCode'
  | 'importance'
  | 'essentialFunction'
  // ADR-026: an interface's own two attributes, on the module sheet.
  | 'interfaceType'
  | 'transformation';

/** Every role a column can end up with: prompt A's own, plus the synonym-only ones. */
export type ColumnRole = PromptAColumnRole | SynonymOnlyColumnRole;

const COLUMN_SYNONYMS_RAW: Readonly<Record<ColumnRole, readonly string[]>> = {
  atlasId: ['atlas_id', 'Atlas ID'],
  sourceKey: ['Asset ID', 'App ID', 'Ref', 'CMDB ID', 'Application number'],
  // 'Name' is the header this product's own export writes on every sheet.
  name: ['Application', 'System', 'Application name', 'Product', 'Solution', 'Module', 'Name'],
  description: ['Description', 'Purpose', 'What it does'],
  vendor: ['Supplier', 'Vendor', 'Provider', 'Manufacturer'],
  lifecycleStatus: ['Status', 'Lifecycle', 'State', 'Live?', 'Lifecycle (module override)'],
  introduced: ['Go-live', 'Implemented', 'Start date', 'In service since', 'Introduced'],
  plannedEnd: ['End of life', 'Contract end', 'Decommission date', 'Retire by', 'Planned end'],
  isExternal: ['Hosted', 'SaaS?', 'External', 'Internal/External'],
  externalOrganisation: ['Operated by', 'Third party', 'External organisation'],
  hostingModel: ['Hosting model', 'Deployment model', 'On-prem/cloud', 'Hosting model (module override)'],
  hostingProvider: ['Hosting provider', 'Data centre', 'Cloud provider', 'Hosting provider (module override)'],
  disposition: ['TIME', 'Disposition', 'Rationalisation', 'Rationalization', 'TIME category', 'TIME disposition'],
  // What this product's own export writes an actor's person/team/organisation column as (its "Type" is the element type).
  actorType: ['Actor type'],
  technology: ['Technology', 'Platform', 'Stack'],
  // 'Parent' / 'Parent capability' are what this product's own export writes on a capability sheet; 'Parent system' on a module sheet.
  parent: ['Parent system', 'Part of', 'Parent', 'Parent capability'],
  owner: ['Owner', 'Business owner', 'Service owner', 'Accountable', 'Team'],
  ownerEmail: ['Owner email', 'Contact', 'Email'],
  technicalOwner: ['Technical owner', 'IT owner', 'Engineering contact', 'Support team'],
  capability: ['Business area', 'Service', 'Function', 'Capability', 'Directorate', 'Domain'],
  usesSystems: ['Depends on', 'Integrations', 'Interfaces with', 'Upstream'],
  flowsTo: ['Sends data to', 'Feeds', 'Downstream'],
  integrationPlatform: ['Via', 'Integration platform', 'Routed through', 'Middleware'],
  notes: ['Notes', 'Comments'],
  // Provenance (`Source`, `Age`) and the element type (`Type`) the export writes — never data about the element — and a capability's sibling `Order`, which the app maintains.
  ignore: ['Type', 'Source', 'Age', 'Order'],
  kind: ['Kind'],
  criticality: ['Criticality', 'Criticality (module override)'],
  domain: ['IT/OT domain', 'Domain (module override)'],
  version: ['Version'],
  annualRunCost: ['Run cost'],
  supportEndsAt: ['Vendor support ends'],
  orgUnit: ['Org unit'],
  capabilityCode: ['Reference'],
  importance: ['Importance'],
  essentialFunction: ['Essential function (NIS/CAF)'],
  interfaceType: ['Interface type'],
  transformation: ['Transformation'],
};

const COLUMN_SYNONYMS: ReadonlyMap<string, ColumnRole> = new Map(
  Object.entries(COLUMN_SYNONYMS_RAW).flatMap(([role, headers]) => headers.map((header) => [normaliseName(header), role as ColumnRole] as const)),
);

export function lookupColumnSynonym(header: string): ColumnRole | null {
  return COLUMN_SYNONYMS.get(normaliseName(header)) ?? null;
}

export const LOW_MAPPING_CONFIDENCE_THRESHOLD = 0.7;

export interface ColumnRoleAssignment {
  role: ColumnRole;
  confidence: number;
  source: 'synonym' | 'llm';
}

export interface LlmColumnAssignment {
  role: PromptAColumnRole;
  /** Already clamped to ≤ 0.90 (`clampMappingConfidence`, `confidence.ts`) — this module doesn't reclamp. */
  confidence: number;
}

export interface ResolveColumnRolesInput {
  /** Aligned by index; `''` (or whitespace-only) is a blank header cell, never assigned a role. */
  headers: readonly string[];
  /** Prompt A's own per-header assignments, keyed by header index — only for headers the synonym table missed. Omit entirely when every header had a synonym hit. */
  llmAssignments?: ReadonlyMap<number, LlmColumnAssignment>;
}

export interface ResolveColumnRolesResult {
  /** Aligned to `headers`; `null` for a blank header cell or a header neither pass assigned. */
  roles: (ColumnRoleAssignment | null)[];
  warnings: EvidenceWarning[];
  /** `null` → `SHEET_NO_NAME_COLUMN` (the caller's decision, not this function's — it only reports the fact). */
  nameColumnIndex: number | null;
}

/** §5.2 step 2, in full: synonym hits first, LLM assignments fill the rest, a synonym-sourced `name` always outranks an LLM-guessed one (never the reverse), and every runner-up `name` column becomes `ignore`. */
export function resolveColumnRoles(input: ResolveColumnRolesInput): ResolveColumnRolesResult {
  const roles: (ColumnRoleAssignment | null)[] = input.headers.map(() => null);
  const warnings: EvidenceWarning[] = [];

  for (let i = 0; i < input.headers.length; i++) {
    const header = input.headers[i];
    if (!header || header.trim() === '') continue;

    const synonymRole = lookupColumnSynonym(header);
    if (synonymRole) {
      roles[i] = { role: synonymRole, confidence: 1, source: 'synonym' };
      continue;
    }

    const llm = input.llmAssignments?.get(i);
    if (!llm) continue;
    roles[i] = { role: llm.role, confidence: llm.confidence, source: 'llm' };
    if (llm.confidence < LOW_MAPPING_CONFIDENCE_THRESHOLD) {
      warnings.push({ code: 'LOW_MAPPING_CONFIDENCE', column: header, confidence: llm.confidence });
    }
  }

  const nameIndices: number[] = [];
  for (let i = 0; i < roles.length; i++) {
    if (roles[i]?.role === 'name') nameIndices.push(i);
  }

  let nameColumnIndex: number | null = null;
  const firstNameIndex = nameIndices[0];
  if (firstNameIndex !== undefined) {
    nameColumnIndex = nameIndices.find((i) => roles[i]?.source === 'synonym') ?? firstNameIndex;
    for (const i of nameIndices) {
      const current = roles[i];
      if (i !== nameColumnIndex && current) roles[i] = { ...current, role: 'ignore' };
    }
  }

  return { roles, warnings, nameColumnIndex };
}
