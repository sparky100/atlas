/**
 * The Portfolio table/cards' own filters — kind, signal, cost band,
 * criticality (the task's own item 6) — each independent and combinable,
 * `'all'` meaning "don't filter on this facet". Client-side over the
 * already-loaded rows, same shape `portfolioSort.ts` uses alongside it.
 * The containers-inclusion toggle is a separate, coarser display decision
 * (`PortfolioView.tsx`'s own state, not this file) — these filters apply
 * to whichever rows that toggle currently makes visible.
 */
import type { AnnualRunCost, Criticality } from '../../contracts/delta';
import type { PortfolioSignalKey } from './portfolioSignals';
import { rowKindOf, type PortfolioRowKind } from './portfolioRowKind';
import type { PortfolioRow } from './usePortfolio';

export interface PortfolioFilters {
  kind: PortfolioRowKind | 'all';
  signal: PortfolioSignalKey | 'all';
  cost: AnnualRunCost | 'all';
  criticality: Criticality | 'all';
}

export const DEFAULT_PORTFOLIO_FILTERS: PortfolioFilters = { kind: 'all', signal: 'all', cost: 'all', criticality: 'all' };

export function matchesPortfolioFilters(row: PortfolioRow, filters: PortfolioFilters): boolean {
  if (filters.kind !== 'all' && rowKindOf(row.element) !== filters.kind) return false;
  if (filters.signal !== 'all' && !row.signals.some((s) => s.key === filters.signal)) return false;
  if (filters.cost !== 'all' && row.cost !== filters.cost) return false;
  if (filters.criticality !== 'all' && row.criticality !== filters.criticality) return false;
  return true;
}

export function filterPortfolioRows(rows: readonly PortfolioRow[], filters: PortfolioFilters): PortfolioRow[] {
  return rows.filter((row) => matchesPortfolioFilters(row, filters));
}
