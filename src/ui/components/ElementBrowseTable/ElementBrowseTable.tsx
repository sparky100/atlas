import { Link } from 'react-router';
import type { ElementType, UUID } from '../../../contracts/delta';
import { ELEMENT_TYPE_FILTER_OPTIONS } from '../../../db/elementBrowse';
import type { BranchRow } from '../../../db/types';
import type { ThreadCount } from '../../comments/useThreadCounts';
import { RelationshipAdd } from '../RelationshipGroup/RelationshipAdd';
import { EmptyState } from '../EmptyState/EmptyState';
import { ElementTypeGlyph } from '../ElementTypeGlyph/ElementTypeGlyph';
import { Text } from '../Text/Text';
import type { ElementBrowseSortKey, ElementBrowseState } from '../../elements/useElementBrowse';
import styles from './ElementBrowseTable.module.css';

/**
 * Sprint U4-1 B3: "the browse table filtered to unlinked systems with the
 * supports picker inline per row." Only ever passed when `?filter=
 * unlinked-systems` is active and the viewer can edit main (ElementsPage.tsx's
 * own gate, `canEditOnMain` — the same role floor every other main write
 * uses, ADR-015) — omitted entirely otherwise, same convention as
 * `CapabilityMapView`'s `reorderCapability`.
 */
export interface ElementBrowseLinkSupportsConfig {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Called after a row's own picker successfully creates its `supports` edge — the caller's job to reload both the branch (a new head_commit_id) and this table's own rows (so the just-linked system drops out of the filter). */
  onLinked: () => void;
}

export interface ElementBrowseTableProps {
  state: ElementBrowseState;
  orgSlug: string;
  modelSlug: string;
  // `| undefined` explicitly, not just `?:` — exactOptionalPropertyTypes
  // treats "optional" and "may be undefined" as different things (same
  // convention `Text.tsx`'s own `className` prop documents).
  linkSupportsInline?: ElementBrowseLinkSupportsConfig | undefined;
  /** M1 close-out item 4: "unresolved counts on the browse table rows" — the caller's own `useThreadCounts` result, keyed by `element_id`. A row absent from the map (or `open === 0`) shows no badge at all; this is a count, not the hollow/ink marker distinction the landscape/capability map draw (a table row already reads as text, nothing there for a marker to compete with). */
  unresolvedCounts?: ReadonlyMap<UUID, ThreadCount> | undefined;
}

const COLUMNS: { key: ElementBrowseSortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'owner', label: 'Owner' },
  { key: 'lifecycle', label: 'Lifecycle' },
];

/**
 * A system's own "+ Add supports" (RelationshipsSection.tsx's own control,
 * reused verbatim), pre-wired for exactly this table's row shape: every row
 * it's rendered on is by definition a system with zero existing `supports`
 * edges (that's the `unlinked-systems` filter itself), so `existingRows: []`
 * and `relationshipFacts: new Map()` are always correct here — B4's
 * "primary?" prompt only fires once a system already has one, which by
 * construction none of these do yet (the very-first-link path, always
 * `role: 'secondary'`, exactly matches what a from-scratch link should be).
 */
function InlineSupportsPicker({ system, config, searchCommitId }: { system: { elementId: UUID; name: string }; config: ElementBrowseLinkSupportsConfig; searchCommitId: UUID }) {
  return (
    <RelationshipAdd
      slot={{ relationshipType: 'supports', targetTypes: ['capability'] }}
      direction="outbound"
      elementId={system.elementId}
      elementType="system"
      elementName={system.name}
      existingRows={[]}
      relationshipFacts={new Map()}
      modelId={config.modelId}
      orgId={config.orgId}
      userId={config.userId}
      searchCommitId={searchCommitId}
      branch={config.branch}
      expectedHeadCommitId={config.expectedHeadCommitId}
      onCreated={config.onLinked}
    />
  );
}

/** Sprint U3b: "filterable, sortable table of elements by type with owner and lifecycle." A real `<table>` — semantic tabular data, not a design-system gap (native `<table>`/`<th>`/`<td>` is the correct element here, the same way `<ul>`/`<li>` already is for plain lists elsewhere in this app). */
export function ElementBrowseTable({ state, orgSlug, modelSlug, linkSupportsInline, unresolvedCounts }: ElementBrowseTableProps) {
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
                <th>Comments</th>
                {linkSupportsInline && <th>Link to a capability</th>}
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => {
                const unresolvedCount = unresolvedCounts?.get(row.element.element_id)?.open ?? 0;
                return (
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
                  <td>
                    {unresolvedCount > 0 ? (
                      <Text as="span" size="sm" className={styles.unresolvedBadge}>
                        💬 {unresolvedCount}
                      </Text>
                    ) : (
                      <Text as="span" tone="faint" size="sm">
                        —
                      </Text>
                    )}
                  </td>
                  {linkSupportsInline && (
                    <td>
                      {row.element.element_type === 'system' && (
                        <InlineSupportsPicker system={{ elementId: row.element.element_id, name: row.element.name }} config={linkSupportsInline} searchCommitId={state.commitId} />
                      )}
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
