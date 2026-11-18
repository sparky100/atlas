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
 * the list shows the planned action actually recorded next to the box that
 * suggests otherwise, visible and never overwritten. An
 * application with no fit rating, no lifecycle, or already retired is not
 * placed and is counted, never put in a corner by default.
 */
import type { AnnualRunCost, Disposition, FitForPurpose } from '../../contracts/delta';
import { highestAnnualRunCost } from '../../engine/elementRead/annualRunCost';

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

export const FIT_ROWS: readonly FitForPurpose[] = ['excellent', 'good', 'adequate', 'poor'];
export const HEALTH_COLUMNS: readonly TechHealth[] = ['at_risk', 'healthy'];
const COST_ORDER: readonly AnnualRunCost[] = ['over_5m', '1m_5m', '250k_1m', '50k_250k', 'under_50k', 'none_included'];

/** One of the eight cells: a fit rating by a health. Cost is the highest band in the cell and a tally, never a sum (run-cost bands are ordinal, `annualRunCost.ts`). */
export interface GridCell {
  fit: FitForPurpose;
  health: TechHealth;
  quadrant: QuadrantKey;
  items: QuadrantItem[];
  highestCost: AnnualRunCost | null;
  costNotEntered: number;
  noPlannedAction: number;
}

/** An application worth a second look: at risk, or rated a poor fit. */
export interface WorthALookRow {
  item: QuadrantItem;
  atRisk: boolean;
  poorFit: boolean;
}

/** How many rows "Worth a look" shows before "See all in the table". */
export const WORTH_A_LOOK_LIMIT = 6;

export interface QuadrantResult {
  boxes: Record<QuadrantKey, QuadrantItem[]>;
  grid: GridCell[];
  worthALook: WorthALookRow[];
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
  const grid = FIT_ROWS.flatMap((fit) =>
    HEALTH_COLUMNS.map((health): GridCell => {
      const cellItems = Object.values(boxes).flat().filter((i) => i.fit === fit && techHealthOf(i.lifecycle, i.exposed) === health).sort(byCostThenName);
      const rollup = highestAnnualRunCost(cellItems.map((i) => i.cost));
      return { fit, health, quadrant: quadrantOf(fit, health), items: cellItems, highestCost: rollup.band, costNotEntered: rollup.notEntered, noPlannedAction: cellItems.filter((i) => i.disposition === null).length };
    }),
  );
  const worthALook = Object.values(boxes)
    .flat()
    .filter((i) => i.fit === 'poor' || techHealthOf(i.lifecycle, i.exposed) === 'at_risk')
    .sort(byCostThenName)
    .map((item): WorthALookRow => ({ item, atRisk: techHealthOf(item.lifecycle, item.exposed) === 'at_risk', poorFit: item.fit === 'poor' }));
  const placedCount = QUADRANT_ORDER.reduce((n, key) => n + boxes[key].length, 0);
  return { boxes, grid, worthALook, notPlaced, placedCount, notPlacedCount: items.length - placedCount };
}
