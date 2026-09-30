/**
 * Pure Run-cost helpers — band ordering/comparison and the two non-additive
 * roll-ups a portfolio view needs (highest band among a set; counts by
 * band). Beside `criticalityTone.ts` deliberately: this is the same shape
 * (a judged, ordered enum plus its one ordering utility), for a field with
 * the opposite consumer rules — no tone, no colour-by, no engine rule.
 *
 * **Bands are ordinal, never arithmetic.** There is no sum and no average
 * of bands anywhere in this file or the product (the constraint on
 * `annualRunCost`); "highest" means the most expensive *band*, computed by
 * rank, and an unset member is skipped — but counted, never folded into
 * `none_included`, on either helper (`notEntered` is a first-class part of
 * each result). Unset is "not entered", which is not a cost of zero.
 *
 * Ordering and labels both come from `attributeSchema.ts`'s single
 * `ANNUAL_RUN_COST_BANDS` declaration — cheapest → most expensive — so
 * this file can't drift from what the element page shows.
 */
import { ANNUAL_RUN_COST_BANDS, ANNUAL_RUN_COST_LABELS, ANNUAL_RUN_COST_OPTIONS } from '../../contracts/attributeSchema';
import type { AnnualRunCost } from '../../contracts/delta';

/** The bands cheapest → most expensive: the canonical order for sorting and for `annualRunCostRank`. */
export const ANNUAL_RUN_COST_ORDER: readonly AnnualRunCost[] = ANNUAL_RUN_COST_OPTIONS;

/** A band's position in the order (0 = `none_included`, cheapest; 5 = `over_5m`). Inputs are typed as `AnnualRunCost`, so this is never negative in practice. */
export function annualRunCostRank(band: AnnualRunCost): number {
  return ANNUAL_RUN_COST_ORDER.indexOf(band);
}

/** Ascending comparator (cheapest first) — `Array.prototype.sort` order, never a numeric difference between bands. */
export function compareAnnualRunCost(a: AnnualRunCost, b: AnnualRunCost): number {
  return annualRunCostRank(a) - annualRunCostRank(b);
}

/** A band's display label ("£50k–£250k"), from the same declaration the element page renders. */
export function annualRunCostLabel(band: AnnualRunCost): string {
  return ANNUAL_RUN_COST_LABELS[band];
}

export interface AnnualRunCostRollup {
  /** How many members recorded each band — every band always present, so a set with no members reads as six zeroes rather than an empty object. */
  counts: Record<AnnualRunCost, number>;
  /** Members with no band recorded — reported, never merged into `none_included`. */
  notEntered: number;
}

function emptyCounts(): Record<AnnualRunCost, number> {
  const counts = {} as Record<AnnualRunCost, number>;
  for (const band of ANNUAL_RUN_COST_BANDS) counts[band.key] = 0;
  return counts;
}

/**
 * The most expensive band among a set, cheapest-first rank, or `null` when
 * every member is unset (nothing recorded is not a zero cost). Unset
 * members are ignored for the comparison itself and reported in
 * `notEntered` — `highestAnnualRunCost(['none_included', undefined])` is
 * `band: 'none_included'` with `notEntered: 1`, not an error and not a
 * missing member.
 */
export function highestAnnualRunCost(bands: Iterable<AnnualRunCost | null | undefined>): { band: AnnualRunCost | null; notEntered: number } {
  let band: AnnualRunCost | null = null;
  let notEntered = 0;
  for (const candidate of bands) {
    if (candidate === null || candidate === undefined) {
      notEntered += 1;
      continue;
    }
    if (band === null || annualRunCostRank(candidate) > annualRunCostRank(band)) band = candidate;
  }
  return { band, notEntered };
}

/** Per-band counts plus the not-entered count — a tally, never a total. Ignores nothing: every member lands in exactly one bucket. */
export function countAnnualRunCosts(bands: Iterable<AnnualRunCost | null | undefined>): AnnualRunCostRollup {
  const counts = emptyCounts();
  let notEntered = 0;
  for (const candidate of bands) {
    if (candidate === null || candidate === undefined) {
      notEntered += 1;
      continue;
    }
    counts[candidate] += 1;
  }
  return { counts, notEntered };
}
