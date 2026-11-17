/**
 * The Portfolio quadrant: business fit up the side, technical health along
 * the bottom, the four boxes named as in Gartner's TIME model (Invest,
 * Migrate, Tolerate, Eliminate). Built only from facts someone recorded:
 *
 * - Business fit is the fit rating on the application's capability links
 *   (worst across them): Good or Excellent is high, Adequate or Poor is low.
 * - Technical health is read from lifecycle: Active or Planned with no
 *   exposure is healthy; Retiring, or past its planned end or vendor
 *   support end with nothing replacing it (the existing lifecycle-exposure
 *   rule), is at risk. Atlas holds no technical score, and none is invented.
 *
 * The box is a suggestion, never a recorded planned action: a planned
 * action is a judgement someone owns (ADR-000, disposition amendment), so
 * dots are coloured by the planned action actually recorded and a dot
 * sitting in a box that disagrees with it is visible, not overwritten. An
 * application with no fit rating, no lifecycle, or already retired is not
 * placed and is counted, never put in a corner by default.
 */
import type { AnnualRunCost, Disposition, FitForPurpose } from '../../contracts/delta';

export type TechHealth = 'healthy' | 'at_risk';
export type QuadrantKey = 'invest' | 'migrate' | 'tolerate' | 'eliminate';
export type NotPlacedReason = 'fit' | 'health' | 'retired';

export interface QuadrantItem {
  id: string;
  name: string;
  fit: FitForPurpose | null;
  /** The row's recorded lifecycle status, as stored (`planned`, `active`, `retiring`, `retired`), or null. */
  lifecycle: string | null;
  /** The existing lifecycle-exposure result: true past a planned or support end with no replacement, null when it cannot be told. */
  exposed: boolean | null;
  cost: AnnualRunCost | null;
  disposition: Disposition | null;
}

export const QUADRANT_ORDER: readonly QuadrantKey[] = ['migrate', 'invest', 'eliminate', 'tolerate'];

/** The same four words as the planned-action choices, so the box and the recorded action read alike. */
export const QUADRANT_LABEL: Record<QuadrantKey, { name: string; caption: string }> = {
  invest: { name: 'Invest', caption: 'Fits well, technically healthy' },
  migrate: { name: 'Migrate', caption: 'Fits well, technically at risk' },
  tolerate: { name: 'Tolerate', caption: 'Fits less well, technically healthy' },
  eliminate: { name: 'Eliminate', caption: 'Fits less well, technically at risk' },
};

export const NOT_PLACED_LABEL: Record<NotPlacedReason, string> = {
  fit: 'with no fit rating',
  health: 'with no lifecycle recorded',
  retired: 'already retired',
};

/** Healthy / at risk from recorded lifecycle facts alone; null when no lifecycle is recorded. */
export function techHealthOf(lifecycle: string | null, exposed: boolean | null): TechHealth | null {
  if (lifecycle === 'retiring' || exposed === true) return 'at_risk';
  if (lifecycle === 'active' || lifecycle === 'planned') return 'healthy';
  return null;
}

/** High fit is Good or Excellent; Adequate and Poor are the lower half. */
export function isHighFit(fit: FitForPurpose): boolean {
  return fit === 'good' || fit === 'excellent';
}

export function quadrantOf(fit: FitForPurpose, health: TechHealth): QuadrantKey {
  if (isHighFit(fit)) return health === 'healthy' ? 'invest' : 'migrate';
  return health === 'healthy' ? 'tolerate' : 'eliminate';
}

/** Dot sizes in pixels, by run-cost band: bigger costs more. A missing or "none / included" cost gets the smallest dot, not a made-up size. */
const COST_DOT_PX: Record<AnnualRunCost, number> = { none_included: 8, under_50k: 10, '50k_250k': 14, '250k_1m': 18, '1m_5m': 24, over_5m: 30 };
export const COST_DOT_UNKNOWN_PX = 8;
const COST_ORDER: readonly AnnualRunCost[] = ['over_5m', '1m_5m', '250k_1m', '50k_250k', 'under_50k', 'none_included'];

export function dotSizeOf(cost: AnnualRunCost | null): number {
  return cost === null ? COST_DOT_UNKNOWN_PX : COST_DOT_PX[cost];
}

export interface QuadrantResult {
  boxes: Record<QuadrantKey, QuadrantItem[]>;
  notPlaced: Record<NotPlacedReason, QuadrantItem[]>;
  placedCount: number;
  notPlacedCount: number;
}

function costRank(cost: AnnualRunCost | null): number {
  const i = cost === null ? -1 : COST_ORDER.indexOf(cost);
  return i < 0 ? COST_ORDER.length : i;
}

/** Biggest cost first, then name, so a box reads the same each time. */
function byCostThenName(a: QuadrantItem, b: QuadrantItem): number {
  return costRank(a.cost) - costRank(b.cost) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function buildQuadrant(items: readonly QuadrantItem[]): QuadrantResult {
  const boxes: Record<QuadrantKey, QuadrantItem[]> = { invest: [], migrate: [], tolerate: [], eliminate: [] };
  const notPlaced: Record<NotPlacedReason, QuadrantItem[]> = { fit: [], health: [], retired: [] };
  for (const item of items) {
    if (item.lifecycle === 'retired') {
      notPlaced.retired.push(item);
      continue;
    }
    if (item.fit === null) {
      notPlaced.fit.push(item);
      continue;
    }
    const health = techHealthOf(item.lifecycle, item.exposed);
    if (health === null) {
      notPlaced.health.push(item);
      continue;
    }
    boxes[quadrantOf(item.fit, health)].push(item);
  }
  for (const list of [...Object.values(boxes), ...Object.values(notPlaced)]) list.sort(byCostThenName);
  const placedCount = QUADRANT_ORDER.reduce((n, key) => n + boxes[key].length, 0);
  return { boxes, notPlaced, placedCount, notPlacedCount: items.length - placedCount };
}
