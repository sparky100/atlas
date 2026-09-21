/**
 * F2-lite ("spreadsheet import as reconciliation") — turns matched rows
 * (`matchImportRows.ts`) into the one batch of deltas an import commits in
 * a single `CommitEnvelope`, the same delta shapes `useElementCreate.ts`/
 * `useElementEditor.ts` already build for a single element, just batched
 * across every row. Pure — no Supabase call; the caller (`useSpreadsheetImport.ts`)
 * supplies everything this needs already loaded, and stages a confirmed
 * same-as pick's alias in `aliasesToWrite` rather than writing it — import
 * close-out: an alias only becomes real once this change's own branch
 * actually merges (`mergeApprovedRequest`), never at commit time, and never
 * at all if the change is cancelled or rejected.
 *
 * Never throws: a row still needing a same-as/new pick, or a module row
 * whose platform didn't resolve, shows up in `rows` as `'needs-pick'`/
 * `'blocked'` rather than raising — the dialog disables Import until every
 * row is `'new'`/`'changed'`/`'unchanged'`, the same live-preview shape
 * every call to this function already returns.
 */
import type { Delta, Json, UUID } from '../contracts/delta';
import { defaultCreateAttributes } from '../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import { normalizeName } from '../engine/merge';
import { ATTRIBUTE_COLUMNS, type ImportRow, type ImportRowAttributeKey } from './importRowSchema';
import type { ImportChangeRow } from './importChangeRow';
import type { ImportRelationshipRow } from './importRelationshipRow';
import { exactMatches, isIntegrationPlatformSystem, isPlatformSystem, toRefs, type ExistingElementRef, type MatchedImportRow, type MatchedImportValueStream, type NameResolutionOutcome } from './matchImportRows';

/**
 * The reviewer's own pick for one row's own `'undecided'` identity match —
 * required for every such row before this module will build a delta for it.
 * `UUID` is a plain `string` alias (`contracts/delta.ts`), so this union
 * looks redundant to the type checker even though `'new'` is a real,
 * distinct sentinel value at runtime, never an actual id.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type MatchResolution = 'new' | UUID;

export type RowOutcome =
  | { status: 'blocked'; reason: string }
  | { status: 'needs-pick'; candidates: readonly { elementId: UUID; name: string }[] }
  | { status: 'new' }
  | { status: 'unchanged'; elementId: UUID }
  | { status: 'changed'; elementId: UUID; changedColumns: string[] };

export interface RowResult {
  rowNumber: number;
  name: string;
  outcome: RowOutcome;
  /** Never blocks the row — the same "surfaced, not silent" stance ADR-008 rule 4 takes everywhere else (an unresolved `capability`/owner reference, an ambiguous one). */
  warnings: string[];
}

/** Import close-out: a matched element's own live `supports` edges — needed to tell "the row's own capability list already matches what's linked" from "it names a different primary," and to demote the right edge (`RelationshipCreateDemotion`'s own shape, `useRelationshipCreate.ts`) rather than guessing. */
export interface CurrentSupportsEdge {
  relationshipId: UUID;
  capabilityId: UUID;
  role: 'primary' | 'secondary';
  /** The delta that last set this edge's own `role` — its own `exists_delta_id` when `role` was never updated since creation (same fallback `previousDeltaId` uses everywhere else in this module). */
  roleDeltaId: UUID;
  /** JSON import follow-up (`replaced_by`): the edge's own `exists_delta_id` — a `relationship.retract`'s `previousDeltaId` needs the edge's own `$exists` delta, never `roleDeltaId` (a different attribute's own delta), the same distinction `useElementRetire.ts`'s own transfer makes. */
  existsDeltaId: UUID;
}

export type RelationshipRowOutcome = { status: 'blocked'; reason: string } | { status: 'new' } | { status: 'unchanged' } | { status: 'changed'; changedColumns: string[] };

export interface RelationshipRowResult {
  rowNumber: number;
  outcome: RelationshipRowOutcome;
}

/** F2-lite JSON import — one "changes" entry's own outcome. Never `'new'` (a change row only ever targets an existing system/module, never creates one). */
export type ChangeRowOutcome = { status: 'blocked'; reason: string } | { status: 'unchanged'; elementId: UUID } | { status: 'applied'; elementId: UUID };

export interface ChangeRowResult {
  rowNumber: number;
  name: string;
  action: ImportChangeRow['action'];
  reason: string | null;
  outcome: ChangeRowOutcome;
}

/** F6 (ADR-023) JSON import — one "value_streams" entry's own outcome. `'new'` when the stream itself is created; `'changed'` when a matched stream gains stages or `enables` edges; `'unchanged'` otherwise. Never `'blocked'`/`'needs-pick'` — a stream/stage is matched by exact name or created, and an unresolved `enables` name is a warning, not a blocker (same stance as a `capability` column). */
export type ValueStreamRowOutcome = 'new' | 'changed' | 'unchanged';

export interface ValueStreamRowResult {
  rowNumber: number;
  name: string;
  outcome: ValueStreamRowOutcome;
  warnings: string[];
}

export interface BuildImportInput {
  matchedRows: readonly MatchedImportRow[];
  /** Keyed by `row.rowNumber` — only rows whose `match.kind === 'undecided'` need an entry. */
  resolutions: ReadonlyMap<number, MatchResolution>;
  fileName: string;
  sourceId: UUID;
  /** Every *matched* element's own current facts, keyed by element id then attribute — `useElementEditor.ts`'s own `previousDeltaId: facts.get(key)?.delta_id ?? element.exists_delta_id` fallback, reused verbatim below. */
  factsByElementId: ReadonlyMap<UUID, ReadonlyMap<string, FactsRow>>;
  /** Every *matched* element's own `exists_delta_id`, for the same fallback. */
  existsDeltaIdByElementId: ReadonlyMap<UUID, UUID>;
  /** Import close-out: every *matched* system/module's own live `supports` edges — empty/omitted means "don't touch capability links for matched rows" (harmless; every caller that cares passes it). `| undefined` explicitly (not just `?:`) so a caller building this object programmatically can pass a possibly-`undefined` value straight through, same convention `Text.tsx`'s own `className` prop documents. */
  currentSupportsByElementId?: ReadonlyMap<UUID, readonly CurrentSupportsEdge[]> | undefined;
  /** Import close-out: the optional Relationships sheet's own rows — empty/omitted for a CSV import, or an XLSX with no such sheet. */
  relationshipRows?: readonly ImportRelationshipRow[] | undefined;
  /** Every live system/container/actor in the model — the Relationships sheet's own endpoint pool (name-or-alias, same rule as a row's own identity match), alongside this same file's own new/matched rows. Omitted/empty is fine when `relationshipRows` is empty too. */
  systems?: readonly ElementsHeadRow[] | undefined;
  containers?: readonly ElementsHeadRow[] | undefined;
  actors?: readonly ElementsHeadRow[] | undefined;
  aliasesByElementId?: ReadonlyMap<UUID, readonly string[]> | undefined;
  /** Every live `uses`/`flows_to` edge in the model — matched by `(from, to, type)` to tell a Relationships-sheet row's own create from its own update. */
  currentUsesFlowsToEdges?: readonly RelationshipsHeadRow[] | undefined;
  /** Every *matched* `uses`/`flows_to` edge's own current facts, keyed by relationship id then attribute — the relationship-side twin of `factsByElementId`. */
  relationshipFactsByRelationshipId?: ReadonlyMap<UUID, ReadonlyMap<string, FactsRow>> | undefined;
  /** F2-lite JSON import's own "changes" section — empty/omitted for a CSV/XLSX import, which has no such section. */
  changeRows?: readonly ImportChangeRow[] | undefined;
  /** F6 (ADR-023): the matched value streams (`matchImportValueStreams`'s own output) — empty/omitted for a CSV/XLSX import, or a JSON import with no `value_streams` section. */
  matchedValueStreams?: readonly MatchedImportValueStream[] | undefined;
  /** Every live `enables` edge in the model — matched by `(from, to)` to tell a stage's own missing edge (create it) from one already present (leave it). */
  currentEnablesEdges?: readonly RelationshipsHeadRow[] | undefined;
}

export interface BuildImportResult {
  rows: RowResult[];
  /** Import close-out — one per `relationshipRows` input row, same order. Always empty when the input's own `relationshipRows` is empty/omitted. */
  relationshipRows: RelationshipRowResult[];
  /** F2-lite JSON import — one per `changeRows` input row, same order. Always empty for a CSV/XLSX import. */
  changeRows: ChangeRowResult[];
  /** F6 (ADR-023) — one per `matchedValueStreams` input row, same order. Always empty for a CSV/XLSX import. */
  valueStreamRows: ValueStreamRowResult[];
  deltas: Delta[];
  /** Every element id a non-`blocked` row resolved to (matched, same-as-picked, or newly minted — owners included) — `sources.import_touched_element_ids`'s own value, and the live "not in file" preview's own input (`notInFile.ts`). */
  touchedElementIds: UUID[];
  /** A confirmed same-as pick whose file-row name differs from the matched element's own current name — staged for the caller to persist as `sources.pending_aliases`, applied as a real `'name'` alias only once this change's own branch merges (`mergeApprovedRequest`). Never written here, and never immediately: this module stays pure, and import close-out moved alias-writing off the import step entirely. */
  aliasesToWrite: { elementId: UUID; aliasValue: string }[];
}

function attributeValueOf(row: ImportRow, key: ImportRowAttributeKey): string | undefined {
  return row.attributes[key];
}

/** Is `newValue` (the row's own cell, already validated) different from what the target element's own current fact says? `undefined` (row didn't set this column at all) never counts as a change — importing a file that only sets `name`/`description` must never blank out an existing `criticality` nobody asked to touch. */
function hasChanged(newValue: string | undefined, fact: FactsRow | undefined): boolean {
  if (newValue === undefined) return false;
  const currentValue = fact?.value;
  return typeof currentValue !== 'string' || currentValue !== newValue;
}

/** `isExternal`'s own boolean-kind twin of `hasChanged` above. */
function hasChangedBoolean(newValue: boolean | undefined, fact: FactsRow | undefined): boolean {
  if (newValue === undefined) return false;
  return typeof fact?.value !== 'boolean' || fact.value !== newValue;
}

/** This row's own resolved identity — the matched/same-as-picked element id, or `'new'` — `undefined` only for a row this function's caller must never reach (`'blocked'`, or `'undecided'` with no pick yet). */
function resolveIdentity(matched: MatchedImportRow, resolutions: ReadonlyMap<number, MatchResolution>): MatchResolution | undefined {
  const { match, row } = matched;
  if (match.kind === 'matched') return match.element.elementId;
  if (match.kind === 'new') return 'new';
  if (match.kind === 'undecided') return resolutions.get(row.rowNumber);
  return undefined;
}

/** JSON import follow-up: a row/relRow/changeRow's own `sourceRef` locator, with its optional `quote` appended — `${fileName} › row N › column — "quote"` when given, otherwise the plain locator, unchanged from before `quote` existed. Shared by every one of this module's per-entry loops (main rows, actors, relationships, changes) — one place building this string, not four. */
function makeLocator(fileName: string, rowNumber: number, quote: string | undefined): (column: string) => string {
  return (column: string) => `${fileName} › row ${String(rowNumber)} › ${column}${quote ? ` — "${quote}"` : ''}`;
}

/** One dedup'd "create this actor if it doesn't already exist" — an owner name repeated across many rows/columns mints exactly one actor, not one per mention. Keyed by `normalizeName`, so "Jane Doe" and "jane doe" share the same new actor. */
interface PendingActor {
  id: UUID;
  name: string;
  /** "Name (External: Org)" (import close-out) — creates an external organisation actor instead of an ordinary person. `null` for a plain name. First-seen mention wins if the same name is ever spelled both ways. */
  externalOrganisation: string | null;
  /** The first row/column this name was seen at — this actor's own `element.create`'s `sourceRef`. */
  firstSeenRowNumber: number;
  firstSeenColumn: 'business_owner' | 'technical_owner';
  /** JSON import follow-up: the first-seen mention's own row-level `quote`/`confidence`, carried onto this actor's own `element.create` — same first-seen-wins rule as `externalOrganisation` above. */
  quote: string | undefined;
  confidence: number | undefined;
}

function collectPendingActors(matchedRows: readonly MatchedImportRow[]): Map<string, PendingActor> {
  const pending = new Map<string, PendingActor>();
  const consider = (outcome: NameResolutionOutcome, ref: { name: string; externalOrganisation: string | null } | null, row: ImportRow, column: 'business_owner' | 'technical_owner') => {
    if (outcome.kind !== 'new' || ref === null) return;
    const key = normalizeName(ref.name);
    if (!pending.has(key)) pending.set(key, { id: crypto.randomUUID(), name: ref.name, externalOrganisation: ref.externalOrganisation, firstSeenRowNumber: row.rowNumber, firstSeenColumn: column, quote: row.quote, confidence: row.confidence });
  };
  for (const matched of matchedRows) {
    consider(matched.businessOwner, matched.row.businessOwner, matched.row, 'business_owner');
    consider(matched.technicalOwner, matched.row.technicalOwner, matched.row, 'technical_owner');
  }
  return pending;
}

/** An owner reference's own resolved actor id — `undefined` only for `'none'`/`'ambiguous'` (never an edge, `warnings` already covers the ambiguous case). */
function resolveOwnerActorId(outcome: NameResolutionOutcome, ref: { name: string } | null, pendingActors: ReadonlyMap<string, PendingActor>): UUID | undefined {
  if (outcome.kind === 'matched') return outcome.element.elementId;
  if (outcome.kind === 'new' && ref !== null) return pendingActors.get(normalizeName(ref.name))?.id;
  return undefined;
}

/**
 * Every capability a row's own list resolved to, in order — `undefined`
 * entries (unresolved/ambiguous) dropped; `warnings` already covers those.
 * Deduped by resolved element id, first occurrence wins: `parseCapabilityList`
 * (`importRowSchema.ts`) already collapses a literal repeated *name* in the
 * same cell, but two *different* names in the row's own list (an alias and
 * the capability's own name, say) can still resolve to the identical
 * element — without this, both the "brand-new element" and "matched
 * element, capability changed" branches below would each push two
 * `relationship.create` deltas for the exact same `(supports, elementId,
 * capabilityId)` triple in one commit, which V6 (`checkNoDuplicateRelationship`,
 * `src/engine/deltas.ts`) now correctly rejects rather than letting through
 * as the same real duplicate it always was.
 */
function resolvedCapabilityIds(capabilities: readonly NameResolutionOutcome[]): UUID[] {
  const ids = capabilities.flatMap((c) => (c.kind === 'matched' ? [c.element.elementId] : []));
  return [...new Set(ids)];
}

/** A row this same import resolved to a real element — this file's own rows are as legitimate a relationship endpoint as anything already in the model (a system and its own new outbound `uses` edge can land in the same file), and, per the same reasoning, as legitimate a `changes`/`replaced_by` target too (a full inventory import commonly creates a system only to retire it in the same commit — recording history, not proposing a no-op). */
interface ResolvedFileRow {
  elementId: UUID;
  row: ImportRow;
  /** The *real*, resolved element type — never `row.elementType` alone, which only reflects this row's own `platform` field and stops being trustworthy once a bare row can resolve to an existing module (`matchImportRows.ts`'s own container cross-check). */
  elementType: 'system' | 'container';
  /** Set only for a row that minted a brand-new element in this very batch — that element's own `element.create` delta id, so a same-file `changes` entry retiring/restoring it in the same commit has something to chain its own `previousDeltaId` onto (nothing is pre-loaded for an element that doesn't exist outside this batch yet). `undefined` for a row that matched something already in the model. */
  createDeltaId: UUID | undefined;
}

/** Import close-out: a Relationships-sheet endpoint — a plain name, or "Platform · Module" naming one of a platform's own modules. Name-or-alias, exact only (no fuzzy tier — a reference column at this remove from the row's own identity isn't worth the same near-match UI); `null` when nothing resolves it. */
function resolveEndpointRef(raw: string, existingPool: readonly ExistingElementRef[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>, fileRowsByName: ReadonlyMap<string, ResolvedFileRow>, platformSystems: readonly ElementsHeadRow[], containers: readonly ElementsHeadRow[]): ExistingElementRef | null {
  const compound = raw.split('·').map((s) => s.trim());
  if (compound.length === 2 && compound[0] && compound[1]) {
    const [platformName, moduleName] = compound;
    const platform = platformSystems.find((p) => normalizeName(p.name) === normalizeName(platformName));
    const existingModule = platform ? containers.find((c) => c.parent_id === platform.element_id && normalizeName(c.name) === normalizeName(moduleName)) : undefined;
    if (existingModule) return { elementId: existingModule.element_id, name: existingModule.name };
    const fileRow = fileRowsByName.get(normalizeName(moduleName));
    if (fileRow?.row.elementType === 'container' && fileRow.row.platformName !== null && normalizeName(fileRow.row.platformName) === normalizeName(platformName)) {
      return { elementId: fileRow.elementId, name: fileRow.row.name };
    }
    return null;
  }

  const exact = exactMatches(raw, existingPool, aliasesByElementId);
  if (exact.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
    return exact[0]!;
  }
  const fileRow = fileRowsByName.get(normalizeName(raw));
  if (fileRow) return { elementId: fileRow.elementId, name: fileRow.row.name };
  return null;
}

/** F2-lite JSON import — a "changes" row's own target: an existing system or module, matched by name-or-alias against the model's *current* elements only (never this same file's own new rows — retiring something the file just created makes no sense). `null` when the name resolves to none, or to more than one, of the two pools combined. Needs `elementType` (unlike a plain `ExistingElementRef`) because `lifecycleStatus`'s own `element.update` delta carries it. */
function resolveChangeTarget(name: string, systems: readonly ElementsHeadRow[], containers: readonly ElementsHeadRow[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>): { elementId: UUID; elementType: 'system' | 'container' } | null {
  // "Platform · Module" — the same compound form `resolveEndpointRef` below
  // resolves for a Relationships-sheet endpoint, so a module retirement can
  // name a specific platform's own module even when another platform has a
  // same-named one. Existing elements only — `resolveChangeReference` below
  // is the one that also checks this same file's own new/matched rows.
  const compound = name.split('·').map((s) => s.trim());
  if (compound.length === 2 && compound[0] && compound[1]) {
    const [platformName, moduleName] = compound;
    const platform = systems.filter(isPlatformSystem).find((p) => normalizeName(p.name) === normalizeName(platformName));
    if (!platform) return null;
    const module = containers.find((c) => c.parent_id === platform.element_id && normalizeName(c.name) === normalizeName(moduleName));
    return module ? { elementId: module.element_id, elementType: 'container' } : null;
  }

  const systemMatches = exactMatches(name, toRefs(systems), aliasesByElementId).map((ref) => ({ ...ref, elementType: 'system' as const }));
  const containerMatches = exactMatches(name, toRefs(containers), aliasesByElementId).map((ref) => ({ ...ref, elementType: 'container' as const }));
  const all = [...systemMatches, ...containerMatches];
  if (all.length !== 1) return null;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
  const match = all[0]!;
  return { elementId: match.elementId, elementType: match.elementType };
}

/**
 * A `changes` row's own `name`/`replaced_by` — `resolveChangeTarget` against
 * the model's current elements first, falling back to this same file's own
 * new/matched rows (`fileRowsByName`) only when nothing existing matches. A
 * full-inventory import commonly creates a system only to retire it (with a
 * replacement) in the very same commit — recording a fact that was already
 * true, not proposing a no-op — so a `changes` entry naming something this
 * file's own `systems` array is also describing is a real, common shape, not
 * a mistake. The existing-model pool always wins on a genuine name clash
 * (matching `resolveEndpointRef`'s own precedence for the identical
 * question on a Relationships-sheet endpoint).
 *
 * A resolved *file* row's own currently-pending `supports` edges (if any —
 * a row's own `capability` column) are **not** transferred to a
 * `replaced_by` target the way a pre-existing element's live edges are:
 * there is nothing pre-loaded to read for an element that doesn't exist
 * outside this batch yet, and redirecting deltas this same pass already
 * queued is out of scope here — the capability link lands on the new
 * element itself, not the replacement, and needs a manual follow-up if
 * that's not wanted.
 */
function resolveChangeReference(name: string, systems: readonly ElementsHeadRow[], containers: readonly ElementsHeadRow[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>, fileRowsByName: ReadonlyMap<string, ResolvedFileRow>): { elementId: UUID; elementType: 'system' | 'container'; createDeltaId: UUID | undefined } | null {
  const existing = resolveChangeTarget(name, systems, containers, aliasesByElementId);
  if (existing) return { ...existing, createDeltaId: undefined };
  const fileRow = fileRowsByName.get(normalizeName(name));
  return fileRow ? { elementId: fileRow.elementId, elementType: fileRow.elementType, createDeltaId: fileRow.createDeltaId } : null;
}

/** `via` is always a plain system name (never "Platform · Module" — an integration platform is a top-level system, never a module) and must resolve to `kind === 'integration_platform'`, whether that system already exists or is itself one of this file's own new rows. */
function resolveVia(raw: string, systems: readonly ElementsHeadRow[], aliasesByElementId: ReadonlyMap<UUID, readonly string[]>, fileRowsByName: ReadonlyMap<string, ResolvedFileRow>): ExistingElementRef | null {
  const exact = exactMatches(raw, toRefs(systems), aliasesByElementId);
  if (exact.length === 1) {
    const system = systems.find((s) => s.element_id === exact[0]?.elementId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
    return system && isIntegrationPlatformSystem(system) ? exact[0]! : null;
  }
  const fileRow = fileRowsByName.get(normalizeName(raw));
  if (fileRow?.row.elementType === 'system' && fileRow.row.attributes.kind === 'integration_platform') return { elementId: fileRow.elementId, name: fileRow.row.name };
  return null;
}

export function buildImportDeltas(input: BuildImportInput): BuildImportResult {
  const {
    matchedRows,
    resolutions,
    fileName,
    sourceId,
    factsByElementId,
    existsDeltaIdByElementId,
    currentSupportsByElementId,
    relationshipRows = [],
    systems = [],
    containers = [],
    actors = [],
    aliasesByElementId = new Map<UUID, readonly string[]>(),
    currentUsesFlowsToEdges = [],
    relationshipFactsByRelationshipId = new Map<UUID, ReadonlyMap<string, FactsRow>>(),
    changeRows = [],
    matchedValueStreams = [],
    currentEnablesEdges = [],
  } = input;

  const deltas: Delta[] = [];
  const touchedElementIds: UUID[] = [];
  const aliasesToWrite: { elementId: UUID; aliasValue: string }[] = [];
  const rows: RowResult[] = [];
  const fileRowsByName = new Map<string, ResolvedFileRow>();

  const pendingActors = collectPendingActors(matchedRows);
  for (const actor of pendingActors.values()) {
    deltas.push({
      kind: 'element.create',
      id: crypto.randomUUID(),
      elementId: actor.id,
      elementType: 'actor',
      name: actor.name,
      parentId: null,
      attributes: actor.externalOrganisation !== null ? { subtype: 'organisation', isExternal: true, externalOrganisation: actor.externalOrganisation } : { subtype: 'person', isExternal: false },
      sourceId,
      sourceRef: makeLocator(fileName, actor.firstSeenRowNumber, actor.quote)(actor.firstSeenColumn),
      confidence: actor.confidence ?? 1,
    });
    touchedElementIds.push(actor.id);
  }

  for (const matched of matchedRows) {
    const { row } = matched;
    const warnings: string[] = [];
    const locator = makeLocator(fileName, row.rowNumber, row.quote);

    if (matched.match.kind === 'blocked') {
      rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: { status: 'blocked', reason: matched.match.reason }, warnings });
      continue;
    }
    if (matched.match.kind === 'undecided' && !resolutions.has(row.rowNumber)) {
      rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: { status: 'needs-pick', candidates: matched.match.candidates }, warnings });
      continue;
    }
    const resolution = resolveIdentity(matched, resolutions);
    if (resolution === undefined) {
      // Unreachable given the two guards above — kept so TS can see every path returns, not a case this function actually expects to hit.
      continue;
    }

    matched.capabilities.forEach((outcome, i) => {
      const name = row.capabilityNames[i] ?? '';
      if (outcome.kind === 'new') warnings.push(`capability "${name}" was not found — never created by an import.`);
      else if (outcome.kind === 'ambiguous') warnings.push(`capability "${name}" matched more than one existing capability — left unlinked.`);
    });
    if (matched.businessOwner.kind === 'ambiguous') warnings.push(`business_owner "${row.businessOwner?.name ?? ''}" matched more than one existing actor — left unlinked.`);
    if (matched.technicalOwner.kind === 'ambiguous') warnings.push(`technical_owner "${row.technicalOwner?.name ?? ''}" matched more than one existing actor — left unlinked.`);

    if (resolution === 'new') {
      const elementId = crypto.randomUUID();
      const createDeltaId = crypto.randomUUID();
      touchedElementIds.push(elementId);
      fileRowsByName.set(normalizeName(row.name), { elementId, row, elementType: row.elementType, createDeltaId });
      deltas.push({
        kind: 'element.create',
        id: createDeltaId,
        elementId,
        elementType: row.elementType,
        name: row.name,
        // A module row's platform already resolved to `'matched'` — anything
        // else was classified `'blocked'` above and never reaches here.
        parentId: row.elementType === 'container' && matched.platform.kind === 'matched' ? matched.platform.element.elementId : null,
        // A change branch's own default (never `main` — an import always
        // lands on a fresh `record`-intent change branch), overridden by
        // whatever the row itself set.
        attributes: { ...defaultCreateAttributes(row.elementType, { onMain: false }), ...row.attributes, ...(row.isExternal !== undefined ? { isExternal: row.isExternal } : {}) },
        sourceId,
        sourceRef: locator('row'),
        confidence: row.confidence ?? 1,
      } as Delta);

      resolvedCapabilityIds(matched.capabilities).forEach((capabilityId, i) => {
        deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'supports', fromElementId: elementId, toElementId: capabilityId, attributes: { role: i === 0 ? 'primary' : 'secondary' }, sourceId, sourceRef: locator('capability'), confidence: row.confidence ?? 1 });
      });
      const businessOwnerId = resolveOwnerActorId(matched.businessOwner, row.businessOwner, pendingActors);
      if (businessOwnerId) deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'owns', fromElementId: businessOwnerId, toElementId: elementId, attributes: { role: 'business' }, sourceId, sourceRef: locator('business_owner'), confidence: row.confidence ?? 1 });
      const technicalOwnerId = resolveOwnerActorId(matched.technicalOwner, row.technicalOwner, pendingActors);
      if (technicalOwnerId) deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'owns', fromElementId: technicalOwnerId, toElementId: elementId, attributes: { role: 'technical' }, sourceId, sourceRef: locator('technical_owner'), confidence: row.confidence ?? 1 });

      rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: { status: 'new' }, warnings });
      continue;
    }

    // Matched (or an `undecided` row resolved to an existing element) —
    // update only the attributes this row actually set that actually
    // differ. Owners are still never (re-)linked for an existing element (a
    // bulk reconciliation can't see the full existing ownership picture —
    // which owner, if any, should be displaced — well enough to edit it
    // safely) — but import close-out *does* reconcile `capability`, since
    // `supports`'s own role rules (one primary, `maxPrimaryPerFrom`) give a
    // safe, well-defined "what changes" the owner rules don't have.
    const elementId: UUID = resolution;
    touchedElementIds.push(elementId);
    // The row's own `elementType` only ever reflects its own `platform`
    // column — never trusted for an *existing* element (a bare row's own
    // identity can now resolve to a module via `crossCheckAgainstModules`,
    // `matchImportRows.ts`), so every delta below carries the real,
    // resolved element's own type instead.
    const elementType = containers.some((c) => c.element_id === elementId) ? 'container' : 'system';
    fileRowsByName.set(normalizeName(row.name), { elementId, row, elementType, createDeltaId: undefined });
    const facts = factsByElementId.get(elementId) ?? new Map<string, FactsRow>();
    const existsDeltaId = existsDeltaIdByElementId.get(elementId);
    if (existsDeltaId === undefined) {
      rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: { status: 'blocked', reason: "the matched element's current state could not be read" }, warnings });
      continue;
    }

    const changedColumns: string[] = [];
    for (const [column, attribute] of ATTRIBUTE_COLUMNS) {
      const value = attributeValueOf(row, attribute);
      const fact = facts.get(attribute);
      if (!hasChanged(value, fact)) continue;
      deltas.push({
        kind: 'element.update',
        id: crypto.randomUUID(),
        elementId,
        elementType,
        attribute,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `hasChanged` above already returned false for `undefined`.
        value: value!,
        previousDeltaId: facts.get(attribute)?.delta_id ?? existsDeltaId,
        sourceId,
        sourceRef: locator(column),
        confidence: row.confidence ?? 1,
      } as Delta);
      changedColumns.push(column);
    }
    if (hasChangedBoolean(row.isExternal, facts.get('isExternal'))) {
      deltas.push({ kind: 'element.update', id: crypto.randomUUID(), elementId, elementType, attribute: 'isExternal', value: row.isExternal, previousDeltaId: facts.get('isExternal')?.delta_id ?? existsDeltaId, sourceId, sourceRef: locator('is_external'), confidence: row.confidence ?? 1 } as Delta);
      changedColumns.push('is_external');
    }

    // Import close-out: "changed rows with a different capability produce
    // supports changes (new edge, previous primary demoted) per the
    // existing role rules." A row with no `capability` column at all never
    // touches existing links (same "omitted column never asserts a
    // change" stance every other column already takes).
    if (row.capabilityNames.length > 0) {
      const newIds = resolvedCapabilityIds(matched.capabilities);
      const currentEdges = currentSupportsByElementId?.get(elementId) ?? [];
      const currentPrimary = currentEdges.find((e) => e.role === 'primary');
      const newPrimaryId = newIds[0];
      const primaryDiffers = newPrimaryId !== undefined && newPrimaryId !== currentPrimary?.capabilityId;

      if (primaryDiffers) {
        if (currentPrimary) {
          deltas.push({ kind: 'relationship.update', id: crypto.randomUUID(), relationshipId: currentPrimary.relationshipId, relationshipType: 'supports', attribute: 'role', value: 'secondary', previousDeltaId: currentPrimary.roleDeltaId, sourceId, sourceRef: locator('capability'), confidence: row.confidence ?? 1 });
        }
        // The row's new primary can already be linked as a *secondary* edge
        // (a real production case: an element already supports a capability
        // secondarily, and an import now names it primary) — promoting that
        // edge in place, never a fresh `relationship.create`, which would
        // leave two live edges for the identical (supports, elementId,
        // newPrimaryId) triple and fail V6 (`checkNoDuplicateRelationship`,
        // src/engine/deltas.ts) the moment this commit is folded.
        const existingNewPrimaryEdge = currentEdges.find((e) => e.capabilityId === newPrimaryId);
        if (existingNewPrimaryEdge) {
          deltas.push({ kind: 'relationship.update', id: crypto.randomUUID(), relationshipId: existingNewPrimaryEdge.relationshipId, relationshipType: 'supports', attribute: 'role', value: 'primary', previousDeltaId: existingNewPrimaryEdge.roleDeltaId, sourceId, sourceRef: locator('capability'), confidence: row.confidence ?? 1 });
        } else {
          deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'supports', fromElementId: elementId, toElementId: newPrimaryId, attributes: { role: 'primary' }, sourceId, sourceRef: locator('capability'), confidence: row.confidence ?? 1 });
        }
      }
      // Every other newly-listed capability (index 1+, or index 0 when it
      // already matched the current primary and needed no promotion) that
      // isn't already linked at all — added as secondary; nothing already
      // linked is ever removed just for being absent from this row's list.
      for (const capabilityId of newIds) {
        if (capabilityId === newPrimaryId && primaryDiffers) continue;
        if (currentEdges.some((e) => e.capabilityId === capabilityId)) continue;
        deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'supports', fromElementId: elementId, toElementId: capabilityId, attributes: { role: 'secondary' }, sourceId, sourceRef: locator('capability'), confidence: row.confidence ?? 1 });
      }
      if (primaryDiffers || newIds.some((id) => !currentEdges.some((e) => e.capabilityId === id))) changedColumns.push('capability');
    }

    if (matched.businessOwner.kind === 'matched' || matched.technicalOwner.kind === 'matched') {
      warnings.push('matched an existing element — its owner links were left unchanged (not re-linked by this import).');
    }

    // A confirmed same-as pick whose file name differs from the matched
    // element's own current name — staged as a pending alias
    // (`sources.pending_aliases`), applied only once this change's own
    // branch merges (import close-out — never immediately, and never at
    // all on a cancelled/rejected change).
    if (matched.match.kind === 'undecided' && normalizeName(row.name) !== normalizeName(matched.match.candidates.find((c) => c.elementId === elementId)?.name ?? row.name)) {
      aliasesToWrite.push({ elementId, aliasValue: row.name });
    }

    rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: changedColumns.length > 0 ? { status: 'changed', elementId, changedColumns } : { status: 'unchanged', elementId }, warnings });
  }

  // Import close-out: the optional Relationships sheet — a second pass,
  // once every element row's own final id is known (`fileRowsByName`
  // above), since a relationship can reference a system created earlier in
  // this very same file.
  const relationshipResults: RelationshipRowResult[] = [];
  const endpointPool = [...toRefs(systems), ...toRefs(containers), ...toRefs(actors)];
  const platformSystems = systems.filter(isPlatformSystem);
  for (const relRow of relationshipRows) {
    const locator = makeLocator(fileName, relRow.rowNumber, relRow.quote);
    const from = resolveEndpointRef(relRow.from, endpointPool, aliasesByElementId, fileRowsByName, platformSystems, containers);
    if (!from) {
      relationshipResults.push({ rowNumber: relRow.rowNumber, outcome: { status: 'blocked', reason: `"from" "${relRow.from}" was not found` } });
      continue;
    }
    const to = resolveEndpointRef(relRow.to, endpointPool, aliasesByElementId, fileRowsByName, platformSystems, containers);
    if (!to) {
      relationshipResults.push({ rowNumber: relRow.rowNumber, outcome: { status: 'blocked', reason: `"to" "${relRow.to}" was not found` } });
      continue;
    }
    let viaId: UUID | undefined;
    if (relRow.via !== null) {
      const via = resolveVia(relRow.via, systems, aliasesByElementId, fileRowsByName);
      if (!via) {
        relationshipResults.push({ rowNumber: relRow.rowNumber, outcome: { status: 'blocked', reason: `"via" "${relRow.via}" must resolve to an integration platform` } });
        continue;
      }
      viaId = via.elementId;
    }

    const attrsToSet: Record<string, Json> = { description: relRow.description, ...(relRow.dataClassification !== null ? { dataClassification: relRow.dataClassification } : {}), ...(viaId !== undefined ? { via: viaId } : {}) };
    const existingEdge = currentUsesFlowsToEdges.find((e) => e.relationship_type === relRow.type && e.from_element_id === from.elementId && e.to_element_id === to.elementId);

    if (!existingEdge) {
      deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: relRow.type, fromElementId: from.elementId, toElementId: to.elementId, attributes: attrsToSet, sourceId, sourceRef: locator('row'), confidence: relRow.confidence ?? 1 });
      relationshipResults.push({ rowNumber: relRow.rowNumber, outcome: { status: 'new' } });
      continue;
    }

    const relFacts = relationshipFactsByRelationshipId.get(existingEdge.relationship_id) ?? new Map<string, FactsRow>();
    const changedColumns: string[] = [];
    for (const [attribute, value] of Object.entries(attrsToSet)) {
      const fact = relFacts.get(attribute);
      const changed = attribute === 'via' ? fact?.value !== value : typeof fact?.value !== 'string' || fact.value !== value;
      if (!changed) continue;
      deltas.push({ kind: 'relationship.update', id: crypto.randomUUID(), relationshipId: existingEdge.relationship_id, relationshipType: relRow.type, attribute, value, previousDeltaId: relFacts.get(attribute)?.delta_id ?? existingEdge.exists_delta_id, sourceId, sourceRef: locator(attribute), confidence: relRow.confidence ?? 1 } as Delta);
      changedColumns.push(attribute);
    }
    relationshipResults.push({ rowNumber: relRow.rowNumber, outcome: changedColumns.length > 0 ? { status: 'changed', changedColumns } : { status: 'unchanged' } });
  }

  // F2-lite JSON import: the "changes" section — explicit retire/restore
  // declarations, resolved against the model's own current systems/modules
  // only (never this file's own new rows, and never an actor — matching
  // `useElementRetire.ts`'s own restriction: `lifecycleStatus` is a
  // system/container attribute alone).
  const changeResults: ChangeRowResult[] = [];
  for (const changeRow of changeRows) {
    const locator = makeLocator(fileName, changeRow.rowNumber, changeRow.quote);
    const pushResult = (outcome: ChangeRowOutcome) => changeResults.push({ rowNumber: changeRow.rowNumber, name: changeRow.name, action: changeRow.action, reason: changeRow.reason, outcome });

    const target = resolveChangeReference(changeRow.name, systems, containers, aliasesByElementId, fileRowsByName);
    if (!target) {
      pushResult({ status: 'blocked', reason: `"${changeRow.name}" was not found, or matched more than one existing system/module` });
      continue;
    }
    const { elementId, elementType } = target;
    touchedElementIds.push(elementId);
    // A same-file new/matched row (`target.createDeltaId` set) has nothing
    // pre-loaded — its own `element.create` delta id stands in for
    // `existsDeltaId`, the exact same fallback role it already plays for
    // every attribute on a *matched* row that's never had its own update
    // yet (`facts.get(attribute)?.delta_id ?? existsDeltaId`, above).
    const facts = target.createDeltaId === undefined ? (factsByElementId.get(elementId) ?? new Map<string, FactsRow>()) : new Map<string, FactsRow>();
    const existsDeltaId = target.createDeltaId ?? existsDeltaIdByElementId.get(elementId);
    if (existsDeltaId === undefined) {
      pushResult({ status: 'blocked', reason: "the matched element's current state could not be read" });
      continue;
    }

    // `replaced_by` (JSON import follow-up) — resolved the same way `name`
    // itself now is: the model's current elements first, falling back to
    // this same file's own new/matched rows (`resolveChangeReference`'s own
    // doc comment). Resolved before any delta is pushed: an explicit
    // replacement that can't be found blocks the whole row, the same
    // "can't silently skip an explicit instruction" stance `platform`
    // unresolved already takes for a module row.
    let replacementId: UUID | undefined;
    if (changeRow.replacedBy !== null) {
      const replacement = resolveChangeReference(changeRow.replacedBy, systems, containers, aliasesByElementId, fileRowsByName);
      if (!replacement) {
        pushResult({ status: 'blocked', reason: `"replaced_by" "${changeRow.replacedBy}" was not found, or matched more than one existing system/module` });
        continue;
      }
      replacementId = replacement.elementId;
    }

    const changeDeltas: Delta[] = [];
    const targetStatus = changeRow.action === 'retire' ? 'retired' : 'active';
    const currentStatus = facts.get('lifecycleStatus')?.value;
    if (currentStatus !== targetStatus) {
      changeDeltas.push({ kind: 'element.update', id: crypto.randomUUID(), elementId, elementType, attribute: 'lifecycleStatus', value: targetStatus, previousDeltaId: facts.get('lifecycleStatus')?.delta_id ?? existsDeltaId, sourceId, sourceRef: locator(changeRow.action), confidence: changeRow.confidence ?? 1 });
    }

    // `replaced_by`: every one of the retiring element's own `supports`
    // edges (primary and secondary alike) transfers to the replacement as
    // `role: 'secondary'` — `useElementRetire.ts`'s own "replaced by"
    // picker, verbatim: never `'primary'` (a collision this reconciliation
    // pass has no reliable way to rule out either), and every edge, not
    // just the primary one (the retiring element's own current capability
    // set is exactly what's being handed off).
    if (replacementId !== undefined) {
      const ownSupportsEdges = currentSupportsByElementId?.get(elementId) ?? [];
      for (const edge of ownSupportsEdges) {
        changeDeltas.push({ kind: 'relationship.retract', id: crypto.randomUUID(), relationshipId: edge.relationshipId, relationshipType: 'supports', previousDeltaId: relationshipFactsByRelationshipId.get(edge.relationshipId)?.get('$exists')?.delta_id ?? edge.existsDeltaId, sourceId, sourceRef: locator('replaced_by'), confidence: changeRow.confidence ?? 1 });
        changeDeltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'supports', fromElementId: replacementId, toElementId: edge.capabilityId, attributes: { role: 'secondary' }, sourceId, sourceRef: locator('replaced_by'), confidence: changeRow.confidence ?? 1 });
      }
    }

    if (changeDeltas.length === 0) {
      pushResult({ status: 'unchanged', elementId });
      continue;
    }
    deltas.push(...changeDeltas);
    pushResult({ status: 'applied', elementId });
  }

  // F6 (ADR-023): the "value_streams" section — structural, and gated to a
  // `correct`-intent change by the caller (`useSpreadsheetImport.ts`), and
  // never retracting anything: a stream/stage the file doesn't name is left
  // alone, only missing streams/stages/enables edges are created. Streams
  // first, then stages, then enables edges — C22 (a stage's parent is a
  // stream; `enables` targets a stage) holds within the fold order.
  const valueStreamResults: ValueStreamRowResult[] = [];
  matchedValueStreams.forEach((matched, streamIndex) => {
    const warnings: string[] = [];
    const locator = makeLocator(fileName, matched.rowNumber, undefined);

    let streamElementId: UUID;
    let streamCreated = false;
    if (matched.match.kind === 'new') {
      streamCreated = true;
      streamElementId = crypto.randomUUID();
      touchedElementIds.push(streamElementId);
      deltas.push({ kind: 'element.create', id: crypto.randomUUID(), elementId: streamElementId, elementType: 'value_stream', name: matched.name, parentId: null, attributes: { order: (streamIndex + 1) * 10 }, sourceId, sourceRef: locator('value_streams'), confidence: 1 });
    } else {
      streamElementId = matched.match.element.elementId;
      touchedElementIds.push(streamElementId);
    }

    let createdStages = 0;
    const stageElementIds: UUID[] = [];
    matched.stages.forEach((stage, stageIndex) => {
      let stageElementId: UUID;
      if (stage.match.kind === 'new') {
        createdStages++;
        stageElementId = crypto.randomUUID();
        touchedElementIds.push(stageElementId);
        deltas.push({ kind: 'element.create', id: crypto.randomUUID(), elementId: stageElementId, elementType: 'value_stream', name: stage.name, parentId: streamElementId, attributes: { order: (stageIndex + 1) * 10 }, sourceId, sourceRef: locator('value_streams'), confidence: 1 });
      } else {
        stageElementId = stage.match.element.elementId;
        touchedElementIds.push(stageElementId);
      }
      stageElementIds.push(stageElementId);
    });

    let createdEnables = 0;
    matched.stages.forEach((stage, stageIndex) => {
      const stageElementId = stageElementIds[stageIndex];
      if (stageElementId === undefined) return;
      for (const { name, outcome } of stage.enables) {
        if (outcome.kind === 'matched') {
          const capabilityId = outcome.element.elementId;
          const alreadyLinked = currentEnablesEdges.some((e) => e.from_element_id === capabilityId && e.to_element_id === stageElementId);
          if (!alreadyLinked) {
            createdEnables++;
            deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'enables', fromElementId: capabilityId, toElementId: stageElementId, attributes: {}, sourceId, sourceRef: locator('enables'), confidence: 1 });
          }
        } else if (outcome.kind === 'new') {
          warnings.push(`enables "${name}" was not found — never created by an import.`);
        } else if (outcome.kind === 'ambiguous') {
          warnings.push(`enables "${name}" matched more than one existing capability — left unlinked.`);
        }
        // `kind === 'none'` is unreachable here — an enables name is always a
        // non-empty string, so `resolveReference` never returns it — handled
        // as a no-op rather than a fallthrough.
      }
    });

    const outcome: ValueStreamRowOutcome = streamCreated ? 'new' : createdStages > 0 || createdEnables > 0 ? 'changed' : 'unchanged';
    valueStreamResults.push({ rowNumber: matched.rowNumber, name: matched.name, outcome, warnings });
  });

  return { rows, relationshipRows: relationshipResults, changeRows: changeResults, valueStreamRows: valueStreamResults, deltas, touchedElementIds, aliasesToWrite };
}
