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

export function visiblePortfolioRows(rows: readonly PortfolioRow[], includeContainers: boolean): PortfolioRow[] {
  return includeContainers ? [...rows] : rows.filter((row) => row.element.element_type !== 'container');
}
