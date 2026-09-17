/**
 * F2 (narrowed capture pipeline), Phase 1 — matches each parsed row
 * against the model's current systems (and, for `supports`, capabilities)
 * **deterministically**: exact `id`, else exact `normalizeName` equality,
 * else new. Pure — takes already-loaded element lists, no Supabase call
 * of its own, so it's fully unit-testable against hand-built element
 * sets (this session's plan's own Phase 1 test list).
 *
 * Phase 2 (this session's plan) adds a fuzzy trigram tier here, between
 * the exact-name tier and "new" — this module is where that lands; nothing
 * about parsing or committing changes upstream/downstream of it needs to
 * change for that.
 *
 * A capability named in `supports` that doesn't exactly match an existing
 * one is never auto-created (same stance the full capture spec takes on
 * capability creation, §15: "never automatic; a reviewer adds it on the
 * map") — it's surfaced as an unresolved warning on the row instead.
 */
import type { ElementsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { normalizeName } from '../engine/merge';
import type { ImportRow } from './importRowSchema';

export interface ExistingElementRef {
  elementId: UUID;
  name: string;
}

export type ElementMatchOutcome =
  | { kind: 'new' }
  | { kind: 'matched'; element: ExistingElementRef }
  /** Two or more live elements share this exact normalized name — a real, if rare, deterministic tie; the reviewer picks one (or "create new") rather than this module guessing. */
  | { kind: 'ambiguous'; candidates: ExistingElementRef[] };

export type SupportsOutcome =
  | { kind: 'none' }
  | { kind: 'matched'; capability: ExistingElementRef }
  | { kind: 'ambiguous'; candidates: ExistingElementRef[] }
  /** Named in the row's own `supports` column, but nothing on the target branch matches it exactly — never auto-created. */
  | { kind: 'unresolved'; name: string };

export interface MatchedImportRow {
  row: ImportRow;
  match: ElementMatchOutcome;
  supports: SupportsOutcome;
}

function toRefs(elements: readonly ElementsHeadRow[]): ExistingElementRef[] {
  return elements.map((e) => ({ elementId: e.element_id, name: e.name }));
}

function matchByExactName(name: string, pool: readonly ExistingElementRef[]): ElementMatchOutcome {
  const target = normalizeName(name);
  const candidates = pool.filter((e) => normalizeName(e.name) === target);
  if (candidates.length === 0) return { kind: 'new' };
  if (candidates.length === 1) {
    const [only] = candidates;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees this.
    return { kind: 'matched', element: only! };
  }
  return { kind: 'ambiguous', candidates };
}

/** One row's own system match — `row.id`, when given, always wins (and always resolves against `systems` by id, never falls through to name matching even on a miss, so a stale/typo'd id is a clear "not found" rather than a surprising name-based match). */
function matchSystemRow(row: ImportRow, systems: readonly ElementsHeadRow[]): ElementMatchOutcome {
  if (row.id !== null) {
    const byId = systems.find((s) => s.element_id === row.id);
    return byId ? { kind: 'matched', element: { elementId: byId.element_id, name: byId.name } } : { kind: 'new' };
  }
  return matchByExactName(row.name, toRefs(systems));
}

function matchSupports(row: ImportRow, capabilities: readonly ElementsHeadRow[]): SupportsOutcome {
  if (row.supportsCapabilityName === null) return { kind: 'none' };
  const outcome = matchByExactName(row.supportsCapabilityName, toRefs(capabilities));
  if (outcome.kind === 'matched') return { kind: 'matched', capability: outcome.element };
  if (outcome.kind === 'ambiguous') return { kind: 'ambiguous', candidates: outcome.candidates };
  return { kind: 'unresolved', name: row.supportsCapabilityName };
}

/** `systems`/`capabilities` are the target branch's own current head rows (`listSystemsForLandscape`/`listCapabilitiesForMap` — the same reads every other page already does; this module doesn't fetch anything itself). */
export function matchImportRows(rows: readonly ImportRow[], systems: readonly ElementsHeadRow[], capabilities: readonly ElementsHeadRow[]): MatchedImportRow[] {
  return rows.map((row) => ({ row, match: matchSystemRow(row, systems), supports: matchSupports(row, capabilities) }));
}
