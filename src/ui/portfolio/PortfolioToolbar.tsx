import { ANNUAL_RUN_COST_OPTIONS } from '../../contracts/attributeSchema';
import type { Criticality } from '../../contracts/delta';
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
}

const CRITICALITY_OPTIONS = Object.keys(CRITICALITY_ORDER) as Criticality[];
const KIND_OPTIONS: PortfolioRowKind[] = ['system', 'platform', 'module'];

/** The Portfolio's own toolbar: sort (any column, click-to-toggle direction via the already-sorted select), the four filters (task item 6), and the containers-inclusion toggle (item 2) — one row of plain controls, the same `<select>`/`<input type="checkbox">` shape `ElementBrowseTable.tsx`'s own toolbar already uses, not a bespoke filter-bar component. */
export function PortfolioToolbar({ sortKey, sortDirection, onSortChange, filters, onFiltersChange, includeContainers, onIncludeContainersChange }: PortfolioToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <label className={styles.field}>
        <span>Sort by</span>
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
      </label>

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

      {(filters.kind !== 'all' || filters.signal !== 'all' || filters.cost !== 'all' || filters.criticality !== 'all') && (
        <button
          type="button"
          className={styles.clearButton}
          onClick={() => {
            onFiltersChange(DEFAULT_PORTFOLIO_FILTERS);
          }}
        >
          Clear filters
        </button>
      )}

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
  );
}
