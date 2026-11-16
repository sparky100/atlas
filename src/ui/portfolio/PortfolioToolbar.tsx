import { useState } from 'react';
import { ANNUAL_RUN_COST_OPTIONS } from '../../contracts/attributeSchema';
import type { Criticality } from '../../contracts/delta';
import { DISPOSITION_LEVELS } from '../../contracts/attributeSchema';
import { CHART_FIT_ROWS, type ChartFit } from './portfolioChart';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { CRITICALITY_ORDER } from '../elements/criticalityTone';
import { DEFAULT_PORTFOLIO_FILTERS, type PortfolioFilters } from './portfolioFilter';
import { PORTFOLIO_ROW_KIND_LABEL, type PortfolioRowKind } from './portfolioRowKind';
import { PORTFOLIO_SORT_COLUMNS, type PortfolioSortKey } from './portfolioSort';
import { PORTFOLIO_SIGNAL_KEYS, PORTFOLIO_SIGNAL_LABEL } from './portfolioSignalLabels';
import styles from './PortfolioToolbar.module.css';

export interface PortfolioToolbarProps {
  sortKey: PortfolioSortKey;
  sortDirection: 'asc' | 'desc';
  onSortChange: (key: PortfolioSortKey) => void;
  filters: PortfolioFilters;
  onFiltersChange: (filters: PortfolioFilters) => void;
  includeContainers: boolean;
  onIncludeContainersChange: (include: boolean) => void;
  /** Table or chart: the same filters apply to both. */
  view: PortfolioViewMode;
  onViewChange: (view: PortfolioViewMode) => void;
  /** A fit picked by clicking a chart box; shown as a removable chip, not a dropdown. */
  fitPick: ChartFit | null;
  onFitPickChange: (fit: ChartFit | null) => void;
  shownCount: number;
  totalCount: number;
}

export type PortfolioViewMode = 'table' | 'chart';

const CRITICALITY_OPTIONS = Object.keys(CRITICALITY_ORDER) as Criticality[];
const KIND_OPTIONS: PortfolioRowKind[] = ['system', 'platform', 'module'];

/** The Portfolio's own toolbar: sort (any column, click-to-toggle direction via the already-sorted select), the four filters (task item 6), and the containers-inclusion toggle (item 2) — one row of plain controls, the same `<select>`/`<input type="checkbox">` shape `ElementBrowseTable.tsx`'s own toolbar already uses, not a bespoke filter-bar component. */
export function PortfolioToolbar({ sortKey, sortDirection, onSortChange, filters, onFiltersChange, includeContainers, onIncludeContainersChange, view, onViewChange, fitPick, onFitPickChange, shownCount, totalCount }: PortfolioToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  // A hidden filter that is doing something must never stay out of sight.
  const moreActive = filters.signal !== 'all' || filters.cost !== 'all' || includeContainers;
  const showMore = moreOpen || moreActive;
  const chips: { label: string; clear: () => void }[] = [];
  if (filters.kind !== 'all') chips.push({ label: `Kind: ${PORTFOLIO_ROW_KIND_LABEL[filters.kind]}`, clear: () => { onFiltersChange({ ...filters, kind: 'all' }); } });
  if (filters.criticality !== 'all') chips.push({ label: `Criticality: ${filters.criticality}`, clear: () => { onFiltersChange({ ...filters, criticality: 'all' }); } });
  if (filters.disposition !== 'all') chips.push({ label: `Planned action: ${filters.disposition === 'not_assessed' ? 'Not assessed' : (DISPOSITION_LEVELS.find((l) => l.key === filters.disposition)?.label ?? filters.disposition)}`, clear: () => { onFiltersChange({ ...filters, disposition: 'all' }); } });
  if (filters.signal !== 'all') chips.push({ label: `Signal: ${PORTFOLIO_SIGNAL_LABEL[filters.signal]}`, clear: () => { onFiltersChange({ ...filters, signal: 'all' }); } });
  if (filters.cost !== 'all') chips.push({ label: `Run cost: ${annualRunCostLabel(filters.cost)}`, clear: () => { onFiltersChange({ ...filters, cost: 'all' }); } });
  if (fitPick) chips.push({ label: `Fit: ${CHART_FIT_ROWS.find((f) => f.key === fitPick)?.label ?? fitPick}`, clear: () => { onFitPickChange(null); } });
  return (
    <>
    <div className={styles.toolbar}>
      <div className={styles.switch} role="group" aria-label="Show as">
        {(['table', 'chart'] as const).map((mode) => (
          <button key={mode} type="button" className={[styles.switchButton, view === mode ? styles.switchOn : ''].filter(Boolean).join(' ')} aria-pressed={view === mode} onClick={() => { onViewChange(mode); }}>
            {mode === 'table' ? 'Table' : 'Chart'}
          </button>
        ))}
      </div>
      {view === 'table' && (
      <label className={styles.field}>
        <span>Sort by</span>
        <div className={styles.sortControl}>
          <select
            className={styles.select}
            value={sortKey}
            onChange={(e) => {
              onSortChange(e.target.value as PortfolioSortKey);
            }}
          >
            {PORTFOLIO_SORT_COLUMNS.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.directionButton}
            aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() => {
              onSortChange(sortKey);
            }}
          >
            {sortDirection === 'asc' ? '▲' : '▼'}
          </button>
        </div>
      </label>
      )}

      <label className={styles.field}>
        <span>Kind</span>
        <select
          className={styles.select}
          value={filters.kind}
          onChange={(e) => {
            onFiltersChange({ ...filters, kind: e.target.value as PortfolioFilters['kind'] });
          }}
        >
          <option value="all">All kinds</option>
          {KIND_OPTIONS.map((kind) => (
            <option key={kind} value={kind}>
              {PORTFOLIO_ROW_KIND_LABEL[kind]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Criticality</span>
        <select
          className={styles.select}
          value={filters.criticality}
          onChange={(e) => {
            onFiltersChange({ ...filters, criticality: e.target.value as PortfolioFilters['criticality'] });
          }}
        >
          <option value="all">All criticalities</option>
          {CRITICALITY_OPTIONS.map((criticality) => (
            <option key={criticality} value={criticality}>
              {criticality}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Planned action</span>
        <select
          className={styles.select}
          value={filters.disposition}
          onChange={(e) => {
            onFiltersChange({ ...filters, disposition: e.target.value as PortfolioFilters['disposition'] });
          }}
        >
          <option value="all">Any planned action</option>
          {DISPOSITION_LEVELS.map((level) => (
            <option key={level.key} value={level.key}>
              {level.label}
            </option>
          ))}
          <option value="not_assessed">Not assessed</option>
        </select>
      </label>

      <button type="button" className={styles.moreButton} aria-expanded={showMore} onClick={() => { setMoreOpen((open) => !open); }} disabled={moreActive && !moreOpen}>
        More filters {showMore ? '▴' : '▾'}
      </button>
      <span className={styles.count} role="status">
        {shownCount} of {totalCount} {totalCount === 1 ? 'application' : 'applications'}
      </span>
    </div>
    {showMore && (
      <div className={styles.toolbar}>
      <label className={styles.field}>
        <span>Signal</span>
        <select
          className={styles.select}
          value={filters.signal}
          onChange={(e) => {
            onFiltersChange({ ...filters, signal: e.target.value as PortfolioFilters['signal'] });
          }}
        >
          <option value="all">All signals</option>
          {PORTFOLIO_SIGNAL_KEYS.map((key) => (
            <option key={key} value={key}>
              {PORTFOLIO_SIGNAL_LABEL[key]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Run cost</span>
        <select
          className={styles.select}
          value={filters.cost}
          onChange={(e) => {
            onFiltersChange({ ...filters, cost: e.target.value as PortfolioFilters['cost'] });
          }}
        >
          <option value="all">All bands</option>
          {ANNUAL_RUN_COST_OPTIONS.map((band) => (
            <option key={band} value={band}>
              {annualRunCostLabel(band)}
            </option>
          ))}
        </select>
      </label>


        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={includeContainers}
            onChange={(e) => {
              onIncludeContainersChange(e.target.checked);
            }}
          />
          <span>Include containers (modules)</span>
        </label>
      </div>
    )}
    {chips.length > 0 && (
      <ul className={styles.chips} aria-label="Applied filters">
        {chips.map((chip) => (
          <li key={chip.label}>
            <button type="button" className={styles.chip} aria-label={`Remove filter ${chip.label}`} onClick={chip.clear}>
              {chip.label} ✕
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => {
              onFiltersChange(DEFAULT_PORTFOLIO_FILTERS);
              onFitPickChange(null);
            }}
          >
            Clear filters
          </button>
        </li>
      </ul>
    )}
    </>
  );
}
