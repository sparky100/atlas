import { useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Text } from '../components/Text/Text';
import { countAnnualRunCosts } from '../elements/annualRunCost';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import { PortfolioCards } from './PortfolioCards';
import { DEFAULT_PORTFOLIO_FILTERS, filterPortfolioRows, type PortfolioFilters } from './portfolioFilter';
import { DEFAULT_PORTFOLIO_SORT_DIRECTION, DEFAULT_PORTFOLIO_SORT_KEY, sortPortfolioRows, type PortfolioSortKey } from './portfolioSort';
import { visiblePortfolioRows } from './portfolioVisibility';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioToolbar } from './PortfolioToolbar';
import type { PortfolioData } from './usePortfolio';
import styles from './PortfolioView.module.css';

export interface PortfolioViewProps {
  data: PortfolioData;
  elementHref: (elementId: UUID) => string;
}

/** Same breakpoint every other table/canvas → mobile-card swap in this app uses (`ElementBrowseTable.tsx`, `ValueStreamsPage.tsx`). */
const MOBILE_BREAKPOINT_PX = 768;

/**
 * The Portfolio view's own chrome: toolbar (sort/filter/containers toggle),
 * the "not entered" count banner (task item 3 — computed over whichever
 * rows the containers toggle currently makes visible, before the facet
 * filters below it narrow further, so the count reads as "this is the
 * picture you're browsing," not something that shifts with every filter
 * pick), and the table/cards swap. Owns every piece of UI-only state
 * itself (sort, filters, containers toggle, the one expanded row) — none
 * of it persisted, all of it client-side over `usePortfolio.ts`'s already-
 * loaded rows, the same shape `useElementBrowse.ts`'s own table owns its
 * sort/filter state.
 */
export function PortfolioView({ data, elementHref }: PortfolioViewProps) {
  const [includeContainers, setIncludeContainers] = useState(false);
  const [sortKey, setSortKey] = useState<PortfolioSortKey>(DEFAULT_PORTFOLIO_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(DEFAULT_PORTFOLIO_SORT_DIRECTION);
  const [filters, setFilters] = useState<PortfolioFilters>(DEFAULT_PORTFOLIO_FILTERS);
  const [expandedRowId, setExpandedRowId] = useState<UUID | null>(null);
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);

  const visibleRows = useMemo(() => visiblePortfolioRows(data.rows, includeContainers), [data.rows, includeContainers]);
  const notEntered = useMemo(() => countAnnualRunCosts(visibleRows.map((row) => row.cost)).notEntered, [visibleRows]);
  const rows = useMemo(() => sortPortfolioRows(filterPortfolioRows(visibleRows, filters), sortKey, sortDirection), [visibleRows, filters, sortKey, sortDirection]);

  function handleSort(key: PortfolioSortKey): void {
    if (key === sortKey) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }

  function handleToggleExpand(elementId: UUID): void {
    setExpandedRowId((current) => (current === elementId ? null : elementId));
  }

  return (
    <div>
      <PortfolioToolbar
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSort}
        filters={filters}
        onFiltersChange={setFilters}
        includeContainers={includeContainers}
        onIncludeContainersChange={setIncludeContainers}
      />
      {notEntered > 0 && (
        <Text as="p" size="sm" tone="muted" className={styles.notEnteredBanner}>
          {notEntered} {notEntered === 1 ? 'row has' : 'rows have'} no run cost entered — excluded from every cost-based signal below, not treated as low.
        </Text>
      )}
      {narrow ? (
        <PortfolioCards rows={rows} expandedRowId={expandedRowId} onToggleExpand={handleToggleExpand} elementHref={elementHref} />
      ) : (
        <PortfolioTable rows={rows} sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} expandedRowId={expandedRowId} onToggleExpand={handleToggleExpand} elementHref={elementHref} />
      )}
    </div>
  );
}
