/**
 * The Portfolio view's own containers-inclusion toggle (task item 2):
 * "systems and platforms by default, with a toggle to include containers."
 * A pure visibility filter over `usePortfolio.ts`'s already-computed rows
 * — it only ever narrows which rows are *displayed*; every row's own
 * `signals` were computed once, in the hook, over the whole model
 * regardless of this toggle (decision 3), so flipping it can only add or
 * remove rows from the list, never change what any remaining row says.
 */
import type { PortfolioRow } from './usePortfolio';

/**
 * `includeNotLive` (the "Include planned and retired" switch) is off by
 * default: the portfolio is the current portfolio, so a planned system (not
 * live yet) and a retired one are left out until asked for.
 */
export function visiblePortfolioRows(rows: readonly PortfolioRow[], includeContainers: boolean, includeNotLive = false): PortfolioRow[] {
  return rows.filter((row) => (includeContainers || row.element.element_type !== 'container') && (includeNotLive || row.lifecycleState === 'active'));
}
