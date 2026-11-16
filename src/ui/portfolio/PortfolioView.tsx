import { useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { Text } from '../components/Text/Text';
import { countAnnualRunCosts } from '../elements/annualRunCost';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import type { AnnualRunCost, FitForPurpose } from '../../contracts/delta';
import { PortfolioCards } from './PortfolioCards';
import { PortfolioChart } from './PortfolioChart';
import { ExportViewButtons } from '../components/ExportViewButtons/ExportViewButtons';
import { portfolioExportPlan, portfolioExportTable } from '../exports/portfolioExport';
import type { ExportStamp } from '../exports/viewExport';
import { DEFAULT_PORTFOLIO_FILTERS, filterPortfolioRows, type PortfolioFilters } from './portfolioFilter';
import { DEFAULT_PORTFOLIO_SORT_DIRECTION, DEFAULT_PORTFOLIO_SORT_KEY, sortPortfolioRows, type PortfolioSortKey } from './portfolioSort';
import { visiblePortfolioRows } from './portfolioVisibility';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioToolbar, type PortfolioViewMode } from './PortfolioToolbar';
import type { PortfolioData } from './usePortfolio';
import { SavedReportBar } from '../reports/SavedReportBar';
import { portfolioStateToSpec, specToPortfolioState } from '../reports/portfolioReport';
import type { MemberRole } from '../../db/types';
import styles from './PortfolioView.module.css';

export interface PortfolioViewProps {
  data: PortfolioData;
  elementHref: (elementId: UUID) => string;
  /** F13 step 1: the export stamp's model and state; the export is offered only when given. */
  exportStamp?: Omit<ExportStamp, 'viewLabel'> | undefined;
  /** F14: who is looking, so the saved-reports strip can offer Save. Omitted = no strip. */
  savedReports?: { modelId: UUID; orgId: UUID; userId: UUID | null; role: MemberRole | null } | undefined;
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
export function PortfolioView({ data, elementHref, exportStamp, savedReports }: PortfolioViewProps) {
  const [includeContainers, setIncludeContainers] = useState(false);
  const [sortKey, setSortKey] = useState<PortfolioSortKey>(DEFAULT_PORTFOLIO_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(DEFAULT_PORTFOLIO_SORT_DIRECTION);
  const [filters, setFilters] = useState<PortfolioFilters>(DEFAULT_PORTFOLIO_FILTERS);
  const [expandedRowId, setExpandedRowId] = useState<UUID | null>(null);
  const [view, setView] = useState<PortfolioViewMode>('table');
  // Picked by clicking a chart box. View-only: the saved report keeps only the filters above it.
  const [fitPick, setFitPick] = useState<FitForPurpose | null>(null);
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);

  const visibleRows = useMemo(() => visiblePortfolioRows(data.rows, includeContainers), [data.rows, includeContainers]);
  const notEntered = useMemo(() => countAnnualRunCosts(visibleRows.map((row) => row.cost)).notEntered, [visibleRows]);
  const filteredRows = useMemo(() => filterPortfolioRows(visibleRows, filters), [visibleRows, filters]);
  const rows = useMemo(() => sortPortfolioRows(fitPick ? filteredRows.filter((row) => row.fit === fitPick) : filteredRows, sortKey, sortDirection), [filteredRows, fitPick, sortKey, sortDirection]);

  function handlePickCell(cost: AnnualRunCost, fit: FitForPurpose): void {
    setFilters((current) => ({ ...current, cost }));
    setFitPick(fit);
    setView('table');
  }

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
      {savedReports && (
        <SavedReportBar
          source="portfolio"
          {...savedReports}
          current={portfolioStateToSpec({ includeContainers, filters, sortKey, sortDirection })}
          onOpen={(spec) => {
            const restored = specToPortfolioState(spec);
            if (!restored.ok) return restored.reason;
            setIncludeContainers(restored.state.includeContainers);
            setFilters(restored.state.filters);
            setSortKey(restored.state.sortKey);
            setSortDirection(restored.state.sortDirection);
            return null;
          }}
        />
      )}
      <PortfolioToolbar
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSort}
        filters={filters}
        onFiltersChange={setFilters}
        includeContainers={includeContainers}
        onIncludeContainersChange={setIncludeContainers}
        view={view}
        onViewChange={setView}
        fitPick={fitPick}
        onFitPickChange={setFitPick}
        shownCount={view === 'chart' ? filteredRows.length : rows.length}
        totalCount={visibleRows.length}
      />
      {exportStamp && (
        <div className={styles.exportActions}>
          <ExportViewButtons
            what="portfolio"
            formats={['xlsx', 'pdf']}
            buildXlsx={async () => {
              const { portfolioTableToXlsxBlob } = await import('../exports/portfolioExportXlsx');
              return portfolioTableToXlsxBlob(portfolioExportTable(rows), { ...exportStamp, viewLabel: 'Portfolio' });
            }}
            build={() => {
              const plan = portfolioExportPlan(rows, exportStamp);
              return { plan, stamp: { ...exportStamp, viewLabel: 'Portfolio' } };
            }}
          />
        </div>
      )}
      {notEntered > 0 && (
        <Text as="p" size="sm" tone="muted" className={styles.notEnteredBanner}>
          {notEntered} {notEntered === 1 ? 'row has' : 'rows have'} no run cost entered — excluded from every cost-based signal below, not treated as low.
        </Text>
      )}
      {view === 'chart' ? (
        <PortfolioChart rows={filteredRows} onPickCell={handlePickCell} onShowTable={() => { setView('table'); }} />
      ) : narrow ? (
        <PortfolioCards rows={rows} expandedRowId={expandedRowId} onToggleExpand={handleToggleExpand} elementHref={elementHref} />
      ) : (
        <PortfolioTable rows={rows} sortKey={sortKey} sortDirection={sortDirection} onSort={handleSort} expandedRowId={expandedRowId} onToggleExpand={handleToggleExpand} elementHref={elementHref} />
      )}
    </div>
  );
}
