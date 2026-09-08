import { Link } from 'react-router';
import type { ElementType } from '../../../contracts/delta';
import { ELEMENT_TYPE_FILTER_OPTIONS } from '../../../db/elementBrowse';
import { EmptyState } from '../EmptyState/EmptyState';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import type { ElementBrowseSortKey, ElementBrowseState } from '../../elements/useElementBrowse';
import styles from './ElementBrowseTable.module.css';

export interface ElementBrowseTableProps {
  state: ElementBrowseState;
  orgSlug: string;
  modelSlug: string;
}

const COLUMNS: { key: ElementBrowseSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
  { key: 'lifecycle', label: 'Lifecycle' },
];

/** Sprint U3b: "filterable, sortable table of elements by type with owner and lifecycle." A real `<table>` — semantic tabular data, not a design-system gap (native `<table>`/`<th>`/`<td>` is the correct element here, the same way `<ul>`/`<li>` already is for plain lists elsewhere in this app). */
export function ElementBrowseTable({ state, orgSlug, modelSlug }: ElementBrowseTableProps) {
  if (state.status === 'loading') return <Text tone="muted">Loading…</Text>;
  if (state.status === 'error') return <Text as="p">{state.message}</Text>;

  const elementHref = (elementId: string) => `/o/${orgSlug}/m/${modelSlug}/e/${elementId}`;

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.search}
          placeholder="Search by name or owner…"
          value={state.query}
          onChange={(e) => { state.setQuery(e.target.value); }}
        />
        <select
          className={styles.select}
          value={state.typeFilter}
          onChange={(e) => { state.setTypeFilter(e.target.value as ElementType | 'all'); }}
        >
          {ELEMENT_TYPE_FILTER_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 'all' ? 'All types' : option}
            </option>
          ))}
        </select>
      </div>

      {state.rows.length === 0 ? (
        <EmptyState>No elements match this filter.</EmptyState>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.key}>
                    <button type="button" className={styles.sortButton} onClick={() => { state.setSort(column.key); }}>
                      {column.label}
                      {state.sortKey === column.key && (state.sortDirection === 'asc' ? ' ▲' : ' ▼')}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => (
                <tr key={row.element.element_id}>
                  <td>
                    <Link to={elementHref(row.element.element_id)} className={styles.nameCell}>
                      <ElementTypeGlyph type={row.element.element_type} />
                      <Text as="span">{row.element.name}</Text>
                    </Link>
                  </td>
                  <td>
                    <Text as="span" tone="muted" size="sm">
                      {row.element.element_type}
                    </Text>
                  </td>
                  <td>
                    {row.owner ? (
                      <Link to={elementHref(row.owner.element_id)}>
                        <Text as="span" size="sm">
                          {row.owner.name}
                        </Text>
                      </Link>
                    ) : (
                      <Text as="span" tone="faint" size="sm">
                        —
                      </Text>
                    )}
                  </td>
                  <td>
                    {row.lifecycleStatus ? (
                      <Text as="span" size="sm">
                        {row.lifecycleStatus}
                      </Text>
                    ) : (
                      <Text as="span" tone="faint" size="sm">
                        —
                      </Text>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
