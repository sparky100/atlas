import { Fragment } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { annualRunCostLabel } from '../elements/annualRunCost';
import { criticalityToneFor } from '../elements/criticalityTone';
import { dispositionLabel, dispositionTone } from '../elements/disposition';
import { fitForPurposeToneFor } from '../elements/fitForPurposeTone';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { PortfolioRowDetail } from './PortfolioRowDetail';
import { PortfolioSignalChip } from './PortfolioSignalChip';
import { rowKindLabel } from './portfolioRowKind';
import type { PortfolioSortKey } from './portfolioSort';
import type { PortfolioRow } from './usePortfolio';
import styles from './PortfolioTable.module.css';

export interface PortfolioTableProps {
  rows: readonly PortfolioRow[];
  sortKey: PortfolioSortKey;
  sortDirection: 'asc' | 'desc';
  onSort: (key: PortfolioSortKey) => void;
  expandedRowId: UUID | null;
  onToggleExpand: (elementId: UUID) => void;
  elementHref: (elementId: UUID) => string;
}

const COLUMNS: { key: PortfolioSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'kind', label: 'Kind' },
  { key: 'cost', label: 'Run cost' },
  { key: 'fit', label: 'Fit' },
  { key: 'criticality', label: 'Criticality' },
  { key: 'disposition', label: 'Planned action' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'capabilities', label: 'Capabilities served' },
  { key: 'owner', label: 'Business owner' },
  { key: 'signals', label: 'Signals' },
];

/**
 * The Portfolio's desktop table (≥768px) — a plain sortable `<table>`,
 * deliberately without `ElementBrowseTable.tsx`'s own dynamic column-width
 * measurement machinery (that exists to keep a *sticky* header aligned
 * with a `table-layout: fixed` body; this table has neither a sticky
 * header nor a fixed layout, so there's nothing for that machinery to fix
 * here, and no risk of reintroducing the overflow bug it was built to
 * solve). Row expand ("why this cost", task item 7) is a second `<tr>`
 * with a single spanning `<td>`, the closest table-native equivalent of
 * `CollapsibleSection`'s own disclosure.
 */
export function PortfolioTable({ rows, sortKey, sortDirection, onSort, expandedRowId, onToggleExpand, elementHref }: PortfolioTableProps) {
  if (rows.length === 0) return <EmptyState>No systems or platforms match this filter.</EmptyState>;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key}>
                <button type="button" className={styles.sortButton} onClick={() => { onSort(column.key); }}>
                  {column.label}
                  {sortKey === column.key && (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                </button>
              </th>
            ))}
            <th>
              <span>Expand</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = expandedRowId === row.element.element_id;
            return (
              <Fragment key={row.element.element_id}>
                <tr>
                  <td>
                    <Link to={elementHref(row.element.element_id)}>
                      <Text as="span">{row.name}</Text>
                    </Link>
                  </td>
                  <td>
                    <Text as="span" tone="muted" size="sm">
                      {rowKindLabel(row)}
                    </Text>
                  </td>
                  <td>{row.cost ? <Text as="span" size="sm">{annualRunCostLabel(row.cost)}</Text> : <Text as="span" tone="faint" size="sm">Not entered</Text>}</td>
                  <td>{row.fit ? <Chip tone={fitForPurposeToneFor(row.fit)}>{row.fit}</Chip> : <Text as="span" tone="faint" size="sm">Unrated</Text>}</td>
                  <td>{row.criticality ? <Chip tone={criticalityToneFor(row.criticality) ?? 'neutral'}>{row.criticality}</Chip> : <Text as="span" tone="faint" size="sm">—</Text>}</td>
                  <td>{row.disposition ? <Chip tone={dispositionTone(row.disposition)}>{dispositionLabel(row.disposition)}</Chip> : <Text as="span" tone="faint" size="sm">Not assessed</Text>}</td>
                  <td>{row.lifecycleStatus ? <Chip tone={lifecycleToneFor(row.lifecycleStatus) ?? 'neutral'}>{row.lifecycleStatus}</Chip> : <Text as="span" tone="faint" size="sm">—</Text>}</td>
                  <td>
                    <Text as="span" size="sm">
                      {row.capabilities.length === 0 ? '—' : row.capabilities.map((c) => c.capabilityName).join(', ')}
                    </Text>
                  </td>
                  <td>
                    <Text as="span" size="sm">
                      {row.businessOwner?.name ?? 'No business owner'}
                    </Text>
                  </td>
                  <td>
                    <div className={styles.signals}>
                      {row.signals.map((signal) => (
                        <PortfolioSignalChip key={signal.key} signal={signal} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.expandButton}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name}`}
                      onClick={() => { onToggleExpand(row.element.element_id); }}
                    >
                      {expanded ? '▾' : '▸'}
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={COLUMNS.length + 1}>
                      <PortfolioRowDetail row={row} elementHref={elementHref} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
