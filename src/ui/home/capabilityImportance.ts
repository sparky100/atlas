/**
 * Pure `importance` helpers — reading the attribute off a capability, and
 * its own display/sort order. Beside `criticalityTone.ts`/
 * `annualRunCost.ts` deliberately (the same "a judged, ordered enum plus
 * its one ordering utility" shape), but `IMPORTANCE_ORDER` runs the
 * *opposite* direction from every other ordered-enum table in this
 * codebase (`CRITICALITY_ORDER`, `FIT_FOR_PURPOSE_ORDER`): those all rank
 * worst-first for a "worst-of" roll-up, this ranks most-important-first,
 * because its one consumer is a display sort (Director home's weak-
 * capability tiles), never a roll-up — see `Importance`'s own doc comment
 * (`delta.ts`) for the full reasoning. Ordering only: nothing here computes
 * a score, a finding, or a colour-by value.
 */
import { IMPORTANCE_LABELS, IMPORTANCE_OPTIONS } from '../../contracts/attributeSchema';
import type { Importance } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';

/** `high` sorts first (0), `low` last (2) among *rated* capabilities — unset is handled separately by callers (it sorts after every rated level, never folded into `low`; see `compareWeakTiles` in `capabilityTileFit.ts`). */
export const IMPORTANCE_ORDER: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** A capability's own `importance`, or `null` if unset/unrecognised — "not assessed," never read as `'low'`. */
export function importanceOf(capability: ElementsHeadRow): Importance | null {
  const value = attributesRecord(capability.attributes).importance;
  return typeof value === 'string' && (IMPORTANCE_OPTIONS as readonly string[]).includes(value) ? (value as Importance) : null;
}

/** The tile's own small label — a real level's display text, or the gentle "Importance not set" prompt for an unset one. */
export function importanceLabel(importance: Importance | null): string {
  return importance === null ? 'Importance not set' : IMPORTANCE_LABELS[importance];
}
