/**
 * F2 (narrowed capture pipeline), Phase 1 — turns matched rows
 * (`matchImportRows.ts`) into the one batch of deltas an import commits in
 * a single `CommitEnvelope`, the same delta shapes `useElementCreate.ts`/
 * `useElementEditor.ts` already build for a single element, just batched
 * across every row. Pure — no Supabase call; the caller (`useSpreadsheetImport.ts`)
 * supplies everything this needs already loaded.
 */
import type { UUID, Delta } from '../contracts/delta';
import type { FactsRow } from '../contracts/rows';
import { defaultCreateAttributes } from '../contracts/attributeSchema';
import type { ImportRow } from './importRowSchema';
import type { MatchedImportRow } from './matchImportRows';

/** The reviewer's own pick for one row's `ambiguous` system match — required for every such row before this module will build anything (`buildImportDeltas` throws listing whichever rows are still unresolved, rather than guessing). Supports-column ambiguity is never resolved this way in v1 — see `matchImportRows.ts`'s own module comment on why it's always treated as unresolved instead. */
export type MatchResolution = 'new' | UUID;

export interface BuildImportDeltasInput {
  matchedRows: readonly MatchedImportRow[];
  /** Keyed by `row.rowNumber` — only rows whose `match.kind === 'ambiguous'` need an entry. */
  resolutions: ReadonlyMap<number, MatchResolution>;
  sourceId: UUID;
  /** Every *matched* system's own current facts, keyed by element id then attribute — `useElementEditor.ts`'s own `previousDeltaId: facts.get(key)?.delta_id ?? element.exists_delta_id` fallback, reused verbatim below. */
  factsByElementId: ReadonlyMap<UUID, ReadonlyMap<string, FactsRow>>;
  /** Every *matched* system's own `exists_delta_id`, for the same fallback. */
  existsDeltaIdByElementId: ReadonlyMap<UUID, UUID>;
}

export interface BuildImportDeltasResult {
  deltas: Delta[];
  /** One entry per row that produced no error but also didn't get everything it asked for — e.g. a `supports` capability name that didn't resolve. Never silent (ADR-008 rule 4); shown in the review screen alongside the otherwise-successful import. */
  warnings: string[];
}

function attributeValueOf(row: ImportRow, key: keyof ImportRow['attributes']): string | undefined {
  return row.attributes[key];
}

/** Is `newValue` (the row's own cell, already validated) different from what the target element's own current fact says? `undefined` (row didn't set this column at all) never counts as a change — importing a file that only sets `name`/`description` must never blank out an existing `criticality` nobody asked to touch. */
function hasChanged(newValue: string | undefined, fact: FactsRow | undefined): boolean {
  if (newValue === undefined) return false;
  const currentValue = fact?.value;
  return typeof currentValue !== 'string' || currentValue !== newValue;
}

const UPDATE_KEYS = ['description', 'lifecycleStatus', 'criticality', 'vendor', 'hostingModel'] as const;

export function buildImportDeltas(input: BuildImportDeltasInput): BuildImportDeltasResult {
  const { matchedRows, resolutions, sourceId, factsByElementId, existsDeltaIdByElementId } = input;

  const unresolved = matchedRows.filter((m) => m.match.kind === 'ambiguous' && !resolutions.has(m.row.rowNumber)).map((m) => m.row.rowNumber);
  if (unresolved.length > 0) {
    throw new Error(`Row${unresolved.length === 1 ? '' : 's'} ${unresolved.join(', ')} still need${unresolved.length === 1 ? 's' : ''} a pick before this import can commit.`);
  }

  const deltas: Delta[] = [];
  const warnings: string[] = [];

  for (const matched of matchedRows) {
    const { row } = matched;
    const resolution = matched.match.kind === 'ambiguous' ? resolutions.get(row.rowNumber) : matched.match.kind === 'matched' ? matched.match.element.elementId : 'new';

    if (resolution === 'new') {
      const elementId = crypto.randomUUID();
      deltas.push({
        kind: 'element.create',
        id: crypto.randomUUID(),
        elementId,
        elementType: 'system',
        name: row.name,
        parentId: null,
        // A change branch's own default (never `main` — an import always
        // lands on a fresh `record`-intent change branch), overridden by
        // whatever the row itself set.
        attributes: { ...defaultCreateAttributes('system', { onMain: false }), ...row.attributes },
        sourceId,
        confidence: 1,
      } as Delta);

      if (matched.supports.kind === 'matched') {
        deltas.push({
          kind: 'relationship.create',
          id: crypto.randomUUID(),
          relationshipId: crypto.randomUUID(),
          relationshipType: 'supports',
          fromElementId: elementId,
          toElementId: matched.supports.capability.elementId,
          // Same "never asked, created secondary outright" default
          // `useElementCreate.ts` already uses for a brand-new element's
          // first supports link — the landscape's own "no primary -> most
          // recently added decides" fallback places it correctly either
          // way, and a bulk import is exactly the case that fallback
          // exists for.
          attributes: { role: 'secondary' },
          sourceId,
          confidence: 1,
        });
      } else if (matched.supports.kind === 'unresolved') {
        warnings.push(`Row ${row.rowNumber} ("${row.name}"): capability "${matched.supports.name}" was not found — created without a supports link.`);
      } else if (matched.supports.kind === 'ambiguous') {
        warnings.push(`Row ${row.rowNumber} ("${row.name}"): capability "${row.supportsCapabilityName}" matched more than one existing capability — created without a supports link.`);
      }
      continue;
    }

    // Matched (or an ambiguous row resolved to an existing element) —
    // update only the attributes this row actually set that actually
    // differ; never re-link `supports` for an existing system in v1 (this
    // session's plan's own stated scope: re-linking risks the
    // `maxPrimaryPerFrom`/duplicate-edge invariants for a fact this
    // import can't see the full existing relationship picture for).
    // `resolution` is only ever `undefined` here for an `ambiguous` row with
    // no pick yet — already ruled out by the `unresolved` check above this
    // loop, which throws first; this guard is what lets TS see that too,
    // not a case this function actually expects to hit.
    if (resolution === undefined) continue;
    const elementId = resolution;
    const facts = factsByElementId.get(elementId) ?? new Map<string, FactsRow>();
    const existsDeltaId = existsDeltaIdByElementId.get(elementId);
    if (existsDeltaId === undefined) {
      warnings.push(`Row ${row.rowNumber} ("${row.name}"): the matched element's current state could not be read — skipped.`);
      continue;
    }

    for (const key of UPDATE_KEYS) {
      const value = attributeValueOf(row, key);
      const fact = facts.get(key);
      if (!hasChanged(value, fact)) continue;
      deltas.push({
        kind: 'element.update',
        id: crypto.randomUUID(),
        elementId,
        elementType: 'system',
        attribute: key,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- `hasChanged` above already returned false for `undefined`.
        value: value!,
        previousDeltaId: fact?.delta_id ?? existsDeltaId,
        sourceId,
        confidence: 1,
      } as Delta);
    }

    if (matched.supports.kind === 'matched' || matched.supports.kind === 'unresolved' || matched.supports.kind === 'ambiguous') {
      warnings.push(`Row ${row.rowNumber} ("${row.name}") matched an existing system — its supports link was left unchanged (not re-linked by this import).`);
    }
  }

  return { deltas, warnings };
}
