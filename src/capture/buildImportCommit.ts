/**
 * F2-lite ("spreadsheet import as reconciliation") — turns matched rows
 * (`matchImportRows.ts`) into the one batch of deltas an import commits in
 * a single `CommitEnvelope`, the same delta shapes `useElementCreate.ts`/
 * `useElementEditor.ts` already build for a single element, just batched
 * across every row. Pure — no Supabase call; the caller (`useSpreadsheetImport.ts`)
 * supplies everything this needs already loaded, and performs the one real
 * side effect this module can't (writing a confirmed same-as pick's alias)
 * off `aliasesToWrite` below.
 *
 * Never throws: a row still needing a same-as/new pick, or a module row
 * whose platform didn't resolve, shows up in `rows` as `'needs-pick'`/
 * `'blocked'` rather than raising — the dialog disables Import until every
 * row is `'new'`/`'changed'`/`'unchanged'`, the same live-preview shape
 * every call to this function already returns.
 */
import type { Delta, UUID } from '../contracts/delta';
import { defaultCreateAttributes } from '../contracts/attributeSchema';
import type { FactsRow } from '../contracts/rows';
import { normalizeName } from '../engine/merge';
import { ATTRIBUTE_COLUMNS, type ImportRow, type ImportRowAttributeKey } from './importRowSchema';
import type { MatchedImportRow, NameResolutionOutcome } from './matchImportRows';

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
}

export interface BuildImportResult {
  rows: RowResult[];
  deltas: Delta[];
  /** Every element id a non-`blocked` row resolved to (matched, same-as-picked, or newly minted — owners included) — `sources.import_touched_element_ids`'s own value, and the live "not in file" preview's own input (`notInFile.ts`). */
  touchedElementIds: UUID[];
  /** A confirmed same-as pick whose file-row name differs from the matched element's own current name — written as a `'name'` alias by the caller (`createAlias`, same pattern `useElementRename.ts`/`elementMerges.ts` already use), so a later import matches on it directly. Never built here: writing one is a real DB call, and this module stays pure. */
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

/** This row's own resolved identity — the matched/same-as-picked element id, or `'new'` — `undefined` only for a row this function's caller must never reach (`'blocked'`, or `'undecided'` with no pick yet). */
function resolveIdentity(matched: MatchedImportRow, resolutions: ReadonlyMap<number, MatchResolution>): MatchResolution | undefined {
  const { match, row } = matched;
  if (match.kind === 'matched') return match.element.elementId;
  if (match.kind === 'new') return 'new';
  if (match.kind === 'undecided') return resolutions.get(row.rowNumber);
  return undefined;
}

/** One dedup'd "create this actor if it doesn't already exist" — an owner name repeated across many rows/columns mints exactly one actor, not one per mention. Keyed by `normalizeName`, so "Jane Doe" and "jane doe" share the same new actor. */
interface PendingActor {
  id: UUID;
  name: string;
  /** The first row/column this name was seen at — this actor's own `element.create`'s `sourceRef`. */
  firstSeenRowNumber: number;
  firstSeenColumn: 'business_owner' | 'technical_owner';
}

function collectPendingActors(matchedRows: readonly MatchedImportRow[]): Map<string, PendingActor> {
  const pending = new Map<string, PendingActor>();
  const consider = (outcome: NameResolutionOutcome, name: string | null, rowNumber: number, column: 'business_owner' | 'technical_owner') => {
    if (outcome.kind !== 'new' || name === null) return;
    const key = normalizeName(name);
    if (!pending.has(key)) pending.set(key, { id: crypto.randomUUID(), name, firstSeenRowNumber: rowNumber, firstSeenColumn: column });
  };
  for (const matched of matchedRows) {
    consider(matched.businessOwner, matched.row.businessOwnerName, matched.row.rowNumber, 'business_owner');
    consider(matched.technicalOwner, matched.row.technicalOwnerName, matched.row.rowNumber, 'technical_owner');
  }
  return pending;
}

/** An owner reference's own resolved actor id — `undefined` only for `'none'`/`'ambiguous'` (never an edge, `warnings` already covers the ambiguous case). */
function resolveOwnerActorId(outcome: NameResolutionOutcome, name: string | null, pendingActors: ReadonlyMap<string, PendingActor>): UUID | undefined {
  if (outcome.kind === 'matched') return outcome.element.elementId;
  if (outcome.kind === 'new' && name !== null) return pendingActors.get(normalizeName(name))?.id;
  return undefined;
}

export function buildImportDeltas(input: BuildImportInput): BuildImportResult {
  const { matchedRows, resolutions, fileName, sourceId, factsByElementId, existsDeltaIdByElementId } = input;

  const deltas: Delta[] = [];
  const touchedElementIds: UUID[] = [];
  const aliasesToWrite: { elementId: UUID; aliasValue: string }[] = [];
  const rows: RowResult[] = [];

  const pendingActors = collectPendingActors(matchedRows);
  for (const actor of pendingActors.values()) {
    deltas.push({
      kind: 'element.create',
      id: crypto.randomUUID(),
      elementId: actor.id,
      elementType: 'actor',
      name: actor.name,
      parentId: null,
      attributes: { subtype: 'person', isExternal: false },
      sourceId,
      sourceRef: `${fileName} › row ${String(actor.firstSeenRowNumber)} › ${actor.firstSeenColumn}`,
      confidence: 1,
    });
    touchedElementIds.push(actor.id);
  }

  for (const matched of matchedRows) {
    const { row } = matched;
    const warnings: string[] = [];
    const locator = (column: string) => `${fileName} › row ${String(row.rowNumber)} › ${column}`;

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

    if (matched.capability.kind === 'new') {
      warnings.push(`capability "${row.capabilityName ?? ''}" was not found — never created by an import.`);
    } else if (matched.capability.kind === 'ambiguous') {
      warnings.push(`capability "${row.capabilityName ?? ''}" matched more than one existing capability — left unlinked.`);
    }
    if (matched.businessOwner.kind === 'ambiguous') warnings.push(`business_owner "${row.businessOwnerName ?? ''}" matched more than one existing actor — left unlinked.`);
    if (matched.technicalOwner.kind === 'ambiguous') warnings.push(`technical_owner "${row.technicalOwnerName ?? ''}" matched more than one existing actor — left unlinked.`);

    if (resolution === 'new') {
      const elementId = crypto.randomUUID();
      touchedElementIds.push(elementId);
      deltas.push({
        kind: 'element.create',
        id: crypto.randomUUID(),
        elementId,
        elementType: row.elementType,
        name: row.name,
        // A module row's platform already resolved to `'matched'` — anything
        // else was classified `'blocked'` above and never reaches here.
        parentId: row.elementType === 'container' && matched.platform.kind === 'matched' ? matched.platform.element.elementId : null,
        // A change branch's own default (never `main` — an import always
        // lands on a fresh `record`-intent change branch), overridden by
        // whatever the row itself set.
        attributes: { ...defaultCreateAttributes(row.elementType, { onMain: false }), ...row.attributes },
        sourceId,
        sourceRef: locator('row'),
        confidence: 1,
      } as Delta);

      if (matched.capability.kind === 'matched') {
        deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'supports', fromElementId: elementId, toElementId: matched.capability.element.elementId, attributes: { role: 'secondary' }, sourceId, sourceRef: locator('capability'), confidence: 1 });
      }
      const businessOwnerId = resolveOwnerActorId(matched.businessOwner, row.businessOwnerName, pendingActors);
      if (businessOwnerId) deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'owns', fromElementId: businessOwnerId, toElementId: elementId, attributes: { role: 'business' }, sourceId, sourceRef: locator('business_owner'), confidence: 1 });
      const technicalOwnerId = resolveOwnerActorId(matched.technicalOwner, row.technicalOwnerName, pendingActors);
      if (technicalOwnerId) deltas.push({ kind: 'relationship.create', id: crypto.randomUUID(), relationshipId: crypto.randomUUID(), relationshipType: 'owns', fromElementId: technicalOwnerId, toElementId: elementId, attributes: { role: 'technical' }, sourceId, sourceRef: locator('technical_owner'), confidence: 1 });

      rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: { status: 'new' }, warnings });
      continue;
    }

    // Matched (or an `undecided` row resolved to an existing element) —
    // update only the attributes this row actually set that actually
    // differ; never (re-)link `capability`/owners for an existing element
    // in F2-lite, same stance F2 Phase 1/2 already took for `supports`: a
    // bulk reconciliation can't see the full existing relationship picture
    // (which owner, if any, should be displaced; `maxPrimaryPerFrom`'s own
    // one-primary-supports invariant) well enough to edit it safely.
    const elementId: UUID = resolution;
    touchedElementIds.push(elementId);
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
        elementType: row.elementType,
        attribute,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `hasChanged` above already returned false for `undefined`.
        value: value!,
        previousDeltaId: facts.get(attribute)?.delta_id ?? existsDeltaId,
        sourceId,
        sourceRef: locator(column),
        confidence: 1,
      } as Delta);
      changedColumns.push(column);
    }

    if (matched.capability.kind === 'matched' || matched.businessOwner.kind === 'matched' || matched.technicalOwner.kind === 'matched') {
      warnings.push('matched an existing element — its capability/owner links were left unchanged (not re-linked by this import).');
    }

    // A confirmed same-as pick whose file name differs from the matched
    // element's own current name — worth an alias so a later import (or a
    // search) matches on it directly (SPEC-capture.md §7.6's own "every
    // level-2/level-3 match... yields alias proposals", the same intent
    // `useElementRename.ts`/`elementMerges.ts` already act on immediately
    // rather than staging).
    if (matched.match.kind === 'undecided' && normalizeName(row.name) !== normalizeName(matched.match.candidates.find((c) => c.elementId === elementId)?.name ?? row.name)) {
      aliasesToWrite.push({ elementId, aliasValue: row.name });
    }

    rows.push({ rowNumber: row.rowNumber, name: row.name, outcome: changedColumns.length > 0 ? { status: 'changed', elementId, changedColumns } : { status: 'unchanged', elementId }, warnings });
  }

  return { rows, deltas, touchedElementIds, aliasesToWrite };
}
