/**
 * The Portfolio chart's data: a cost-against-fit grid built from the rows
 * the table would show. Both axes are recorded bands, so each application
 * lands in exactly one box; an application missing either one is counted
 * as "not plotted" and never placed as low (same stance as the table's
 * "no run cost entered" banner). A box is shaded when any application in
 * it already carries the "Costly, poor fit" signal, so the chart reuses
 * that signal's own rule instead of restating it.
 */
import type { AnnualRunCost, FitForPurpose } from '../../contracts/delta';
import { ANNUAL_RUN_COST_BANDS } from '../../contracts/attributeSchema';
import type { PortfolioRow } from './usePortfolio';

/** Worst first, so the top row of the grid is where the attention goes. */
export const CHART_FIT_ROWS: readonly { key: FitForPurpose; label: string }[] = [
  { key: 'poor', label: 'Poor fit' },
  { key: 'adequate', label: 'Adequate' },
  { key: 'good', label: 'Good' },
  { key: 'excellent', label: 'Excellent' },
];

export const CHART_COST_COLUMNS: readonly { key: AnnualRunCost; label: string }[] = ANNUAL_RUN_COST_BANDS;

export interface CostFitCell {
  cost: AnnualRunCost;
  fit: FitForPurpose;
  rows: PortfolioRow[];
  /** At least one application here has the "Costly, poor fit" signal. */
  flagged: boolean;
}

export interface CostFitGrid {
  /** Fit rows (worst first) × cost columns, in display order. */
  cells: CostFitCell[][];
  notPlotted: PortfolioRow[];
}

export function buildCostFitGrid(rows: readonly PortfolioRow[]): CostFitGrid {
  const cells = CHART_FIT_ROWS.map((fit) =>
    CHART_COST_COLUMNS.map((cost): CostFitCell => ({ cost: cost.key, fit: fit.key, rows: [], flagged: false })),
  );
  const notPlotted: PortfolioRow[] = [];
  for (const row of rows) {
    const r = CHART_FIT_ROWS.findIndex((f) => f.key === row.fit);
    const c = CHART_COST_COLUMNS.findIndex((b) => b.key === row.cost);
    const cell = r >= 0 && c >= 0 ? cells[r]?.[c] : undefined;
    if (!cell) {
      notPlotted.push(row);
      continue;
    }
    cell.rows.push(row);
    if (row.signals.some((s) => s.key === 'costly_poor_fit')) cell.flagged = true;
  }
  return { cells, notPlotted };
}
