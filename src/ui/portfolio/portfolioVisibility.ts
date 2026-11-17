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

/** The three groups the Portfolio can show, in the order the control lists them. */
export type PortfolioLifecycleState = 'active' | 'planned' | 'retired';
export const PORTFOLIO_LIFECYCLE_STATES: readonly PortfolioLifecycleState[] = ['active', 'planned', 'retired'];
/** Opens on today's portfolio: only what is live now. */
export const DEFAULT_PORTFOLIO_LIFECYCLE_STATES: readonly PortfolioLifecycleState[] = ['active'];

/**
 * `states` is which groups to show (the Active / Planned / Retired control).
 * It starts as active only: the portfolio is the current portfolio, so a
 * planned system (not live yet) and a retired one are left out until asked
 * for.
 */
export function visiblePortfolioRows(rows: readonly PortfolioRow[], includeContainers: boolean, states: readonly PortfolioLifecycleState[] = DEFAULT_PORTFOLIO_LIFECYCLE_STATES): PortfolioRow[] {
  return rows.filter((row) => (includeContainers || row.element.element_type !== 'container') && states.includes(row.lifecycleState));
}

/** How many rows sit in each group (containers left out unless included), so the control can show a count on each. */
export function portfolioLifecycleCounts(rows: readonly PortfolioRow[], includeContainers: boolean): Record<PortfolioLifecycleState, number> {
  const counts: Record<PortfolioLifecycleState, number> = { active: 0, planned: 0, retired: 0 };
  for (const row of rows) {
    if (includeContainers || row.element.element_type !== 'container') counts[row.lifecycleState] += 1;
  }
  return counts;
}

/** Turn one group on or off. The last one on cannot be turned off, so the list is never silently empty. Keeps the canonical order. */
export function togglePortfolioLifecycleState(states: readonly PortfolioLifecycleState[], toggled: PortfolioLifecycleState): PortfolioLifecycleState[] {
  const next = states.includes(toggled) ? states.filter((s) => s !== toggled) : [...states, toggled];
  if (next.length === 0) return [...states];
  return PORTFOLIO_LIFECYCLE_STATES.filter((s) => next.includes(s));
}
