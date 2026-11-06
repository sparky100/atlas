/**
 * The Portfolio table/cards' own sort — one comparator per column, all
 * client-side over the already-loaded rows (`usePortfolio.ts`), the same
 * "own sort/filter state over one loaded set" shape `useElementBrowse.ts`
 * already establishes for the browse table. Default is cost band
 * descending (the task's own "Default sort: cost band descending"),
 * sortable by any column via `PORTFOLIO_SORT_COLUMNS`.
 *
 * An unset (`null`) ordinal value — cost, fit, criticality, lifecycle —
 * sorts as the lowest rank of all: a sort-order placement, not a signal
 * judgement. It never reads as "low"/"good"/etc for *what a row means*
 * (`portfolioSignals.ts` never sees this file), only for *where an
 * incomplete row lands in a list* — same "unset sorts first" convention
 * `useElementBrowse.ts`'s own `criticalityOrderOf` already uses for the
 * element browse table's criticality column.
 */
import type { AnnualRunCost, Criticality, Disposition, FitForPurpose } from '../../contracts/delta';
import { annualRunCostRank } from '../elements/annualRunCost';
import { CRITICALITY_ORDER } from '../elements/criticalityTone';
import { DISPOSITION_ORDER } from '../elements/disposition';
import { FIT_FOR_PURPOSE_ORDER } from '../elements/fitForPurposeTone';
import { LIFECYCLE_ORDER } from '../elements/lifecycleTone';
import { rowKindLabel } from './portfolioRowKind';
import type { PortfolioRow } from './usePortfolio';

export type PortfolioSortKey = 'name' | 'kind' | 'cost' | 'fit' | 'criticality' | 'disposition' | 'lifecycle' | 'capabilities' | 'owner' | 'signals';

export const PORTFOLIO_SORT_COLUMNS: { key: PortfolioSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'cost', label: 'Run cost' },
  { key: 'fit', label: 'Fit' },
  { key: 'criticality', label: 'Criticality' },
  { key: 'disposition', label: 'Disposition' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'capabilities', label: 'Capabilities served' },
  { key: 'owner', label: 'Business owner' },
  { key: 'signals', label: 'Signals' },
];

export const DEFAULT_PORTFOLIO_SORT_KEY: PortfolioSortKey = 'cost';
export const DEFAULT_PORTFOLIO_SORT_DIRECTION: 'asc' | 'desc' = 'desc';

export function costRank(cost: AnnualRunCost | null): number {
  return cost === null ? -1 : annualRunCostRank(cost);
}

export function fitRank(fit: FitForPurpose | null): number {
  // Ascending = best-first (excellent before poor) — `FIT_FOR_PURPOSE_ORDER` itself runs excellent=0..poor=3, already the right direction.
  return fit === null ? -1 : FIT_FOR_PURPOSE_ORDER[fit];
}

export function dispositionRank(disposition: Disposition | null): number {
  return disposition === null ? -1 : DISPOSITION_ORDER.indexOf(disposition);
}

export function criticalityRank(criticality: Criticality | null): number {
  return criticality === null ? -1 : CRITICALITY_ORDER[criticality];
}

export function lifecycleRank(status: string | null): number {
  return status !== null && status in LIFECYCLE_ORDER ? LIFECYCLE_ORDER[status as keyof typeof LIFECYCLE_ORDER] : -1;
}

function compareByKey(a: PortfolioRow, b: PortfolioRow, key: PortfolioSortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'kind':
      return rowKindLabel(a).localeCompare(rowKindLabel(b)) || a.name.localeCompare(b.name);
    case 'cost':
      return costRank(a.cost) - costRank(b.cost) || a.name.localeCompare(b.name);
    case 'fit':
      return fitRank(a.fit) - fitRank(b.fit) || a.name.localeCompare(b.name);
    case 'criticality':
      return criticalityRank(a.criticality) - criticalityRank(b.criticality) || a.name.localeCompare(b.name);
    case 'disposition':
      // Unset first, then invest → tolerate → migrate → eliminate (worst last), the same "unset sorts first" rule as the other ordinal columns.
      return dispositionRank(a.disposition) - dispositionRank(b.disposition) || a.name.localeCompare(b.name);
    case 'lifecycle':
      return lifecycleRank(a.lifecycleStatus) - lifecycleRank(b.lifecycleStatus) || a.name.localeCompare(b.name);
    case 'capabilities':
      return a.capabilities.length - b.capabilities.length || a.name.localeCompare(b.name);
    case 'owner':
      return (a.businessOwner?.name ?? '').localeCompare(b.businessOwner?.name ?? '') || a.name.localeCompare(b.name);
    case 'signals':
      return a.signals.length - b.signals.length || a.name.localeCompare(b.name);
  }
}

/** Sorts a copy of `rows` by `key`/`direction` — never mutates its input, same convention every other sort in this codebase (`useElementBrowse.ts`'s own `compareRows` caller) follows. */
export function sortPortfolioRows(rows: readonly PortfolioRow[], key: PortfolioSortKey, direction: 'asc' | 'desc'): PortfolioRow[] {
  const sorted = [...rows].sort((a, b) => compareByKey(a, b, key));
  return direction === 'asc' ? sorted : sorted.reverse();
}
