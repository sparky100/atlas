/**
 * F2 (narrowed capture pipeline) — matches each parsed row against the
 * model's current systems (and, for `supports`, capabilities), in order:
 * exact `id` → exact `normalizeName` equality → fuzzy trigram similarity
 * → new. Pure — takes already-loaded element lists, no Supabase call of
 * its own, so it's fully unit-testable against hand-built element sets.
 *
 * Phase 2 (this session's plan) is the fuzzy tier below — the same
 * trigram-similarity primitive `src/engine/trigram.ts` already implements
 * for E7/merge_elements (its own doc comment: "the real matching path
 * once the capture pipeline... exists", i.e. this module), reused as-is
 * rather than rewritten. `IDENTITY_TRIGRAM_THRESHOLD` (0.6) and the 0.05
 * ambiguity margin are this session's own plan's stated thresholds, not a
 * new invention.
 *
 * A capability named in `supports` that doesn't resolve — exactly or
 * fuzzily — to an existing one is never auto-created (same stance the
 * full capture spec takes on capability creation, §15: "never automatic;
 * a reviewer adds it on the map") — it's surfaced as an unresolved
 * warning on the row instead.
 */
import type { ElementsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import { normalizeName } from '../engine/merge';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from '../engine/trigram';
import type { ImportRow } from './importRowSchema';

/** How close a second-best fuzzy candidate has to be to the best one to make the match ambiguous rather than confident — this session's own plan's stated value, not SPEC-capture.md's (§7.5 doesn't fix one; this narrowed build does). */
const AMBIGUITY_MARGIN = 0.05;

export interface ExistingElementRef {
  elementId: UUID;
  name: string;
}

export type ElementMatchOutcome =
  | { kind: 'new' }
  | { kind: 'matched'; element: ExistingElementRef }
  /** Either two or more live elements share this exact normalized name, or two or more scored within `AMBIGUITY_MARGIN` of each other's fuzzy trigram similarity — a real tie either way; the reviewer picks one (or "create new") rather than this module guessing. */
  | { kind: 'ambiguous'; candidates: ExistingElementRef[] };

export type SupportsOutcome =
  | { kind: 'none' }
  | { kind: 'matched'; capability: ExistingElementRef }
  | { kind: 'ambiguous'; candidates: ExistingElementRef[] }
  /** Named in the row's own `supports` column, but nothing on the target branch matches it, exactly or fuzzily — never auto-created. */
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

/**
 * The fuzzy tier — only ever reached for a name with zero *exact*
 * normalized-name hits (`matchByNameCascade` below never falls through an
 * exact `matched`/`ambiguous` result into this). Every candidate scoring
 * `≥ IDENTITY_TRIGRAM_THRESHOLD` is a real hit; the best one wins unless a
 * second is within `AMBIGUITY_MARGIN` of it, in which case every candidate
 * that close to the best is shown, not silently narrowed to two.
 */
function matchByFuzzyName(name: string, pool: readonly ExistingElementRef[]): ElementMatchOutcome {
  const target = normalizeName(name);
  const scored = pool
    .map((ref) => ({ ref, score: trigramSimilarity(target, normalizeName(ref.name)) }))
    .filter((s) => s.score >= IDENTITY_TRIGRAM_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { kind: 'new' };
  const tiedWithBest = scored.filter((s) => best.score - s.score < AMBIGUITY_MARGIN);
  if (tiedWithBest.length > 1) return { kind: 'ambiguous', candidates: tiedWithBest.map((s) => s.ref) };
  return { kind: 'matched', element: best.ref };
}

/** Exact tier first, fuzzy tier only on a clean miss (`new`) — an exact `ambiguous` tie is a real fact about the pool (two elements already share this name exactly) and must never be papered over by a fuzzy re-ranking. */
function matchByNameCascade(name: string, pool: readonly ExistingElementRef[]): ElementMatchOutcome {
  const exact = matchByExactName(name, pool);
  return exact.kind === 'new' ? matchByFuzzyName(name, pool) : exact;
}

/** One row's own system match — `row.id`, when given, always wins (and always resolves against `systems` by id, never falls through to name matching even on a miss, so a stale/typo'd id is a clear "not found" rather than a surprising name-based match). */
function matchSystemRow(row: ImportRow, systems: readonly ElementsHeadRow[]): ElementMatchOutcome {
  if (row.id !== null) {
    const byId = systems.find((s) => s.element_id === row.id);
    return byId ? { kind: 'matched', element: { elementId: byId.element_id, name: byId.name } } : { kind: 'new' };
  }
  return matchByNameCascade(row.name, toRefs(systems));
}

function matchSupports(row: ImportRow, capabilities: readonly ElementsHeadRow[]): SupportsOutcome {
  if (row.supportsCapabilityName === null) return { kind: 'none' };
  const outcome = matchByNameCascade(row.supportsCapabilityName, toRefs(capabilities));
  if (outcome.kind === 'matched') return { kind: 'matched', capability: outcome.element };
  if (outcome.kind === 'ambiguous') return { kind: 'ambiguous', candidates: outcome.candidates };
  return { kind: 'unresolved', name: row.supportsCapabilityName };
}

/** `systems`/`capabilities` are the target branch's own current head rows (`listSystemsForLandscape`/`listCapabilitiesForMap` — the same reads every other page already does; this module doesn't fetch anything itself). */
export function matchImportRows(rows: readonly ImportRow[], systems: readonly ElementsHeadRow[], capabilities: readonly ElementsHeadRow[]): MatchedImportRow[] {
  return rows.map((row) => ({ row, match: matchSystemRow(row, systems), supports: matchSupports(row, capabilities) }));
}
