import type { AnnualRunCostBand } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';

/**
 * `none_included → under_50k → 50k_250k → 250k_1m → 1m_5m → over_5m`, as a
 * sortable order — the same "worst-of = max" shape `criticalityTone.ts`'s
 * own `CRITICALITY_ORDER` gives `worstCriticality`, for a future portfolio
 * view's "highest run cost among these elements" rollup. No colour-by/tone
 * map here (unlike `criticalityTone.ts`/`fitForPurposeTone.ts`) — the data
 * step this file supports is deliberately scoped to ordering and roll-ups
 * only, not a UI treatment.
 */
export const RUN_COST_BAND_ORDER: Record<AnnualRunCostBand, number> = {
  none_included: 0,
  under_50k: 1,
  '50k_250k': 2,
  '250k_1m': 3,
  '1m_5m': 4,
  over_5m: 5,
};

/** `a` vs `b` by cost, ascending — a plain `Array.prototype.sort` comparator. */
export function compareRunCostBands(a: AnnualRunCostBand, b: AnnualRunCostBand): number {
  return RUN_COST_BAND_ORDER[a] - RUN_COST_BAND_ORDER[b];
}

function runCostBandOf(element: ElementsHeadRow): AnnualRunCostBand | null {
  const value = attributesRecord(element.attributes).annualRunCost;
  return typeof value === 'string' && value in RUN_COST_BAND_ORDER ? (value as AnnualRunCostBand) : null;
}

/**
 * The highest `annualRunCost` band among `elements` (`over_5m` the
 * highest), or `null` if none has one recorded — unset elements are
 * skipped entirely, never treated as `none_included` or as the lowest
 * band (`AnnualRunCostBand`'s own doc comment: "not entered" is silent,
 * not a recorded low value). Never a sum or an average (CLAUDE.md rule on
 * this attribute) — a band is a judgement, not a figure to combine.
 */
export function highestRunCostBand(elements: readonly ElementsHeadRow[]): AnnualRunCostBand | null {
  let highest: AnnualRunCostBand | null = null;
  for (const element of elements) {
    const band = runCostBandOf(element);
    if (band !== null && (highest === null || RUN_COST_BAND_ORDER[band] > RUN_COST_BAND_ORDER[highest])) highest = band;
  }
  return highest;
}

/** Per-band counts across `elements`, plus how many carry no `annualRunCost` at all — the "how many in the set are not entered" figure `highestRunCostBand` alone doesn't surface, since it silently skips them. */
export interface RunCostBandCounts {
  counts: Record<AnnualRunCostBand, number>;
  notEntered: number;
}

/** Counts elements into each band they actually recorded — never a sum or an average of the bands themselves, same reasoning `highestRunCostBand` gives. */
export function countRunCostBands(elements: readonly ElementsHeadRow[]): RunCostBandCounts {
  const counts: Record<AnnualRunCostBand, number> = { none_included: 0, under_50k: 0, '50k_250k': 0, '250k_1m': 0, '1m_5m': 0, over_5m: 0 };
  let notEntered = 0;
  for (const element of elements) {
    const band = runCostBandOf(element);
    if (band === null) notEntered++;
    else counts[band]++;
  }
  return { counts, notEntered };
}
