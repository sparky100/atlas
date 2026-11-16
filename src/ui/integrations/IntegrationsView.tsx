import { Plug } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { AiAgentTag } from '../components/AiAgentTag/AiAgentTag';
import { aiAutonomyOf } from '../../engine/elementRead/aiAgent';
import { Chip } from '../components/Chip/Chip';
import { EmptyState } from '../components/EmptyState/EmptyState';
import { Text } from '../components/Text/Text';
import { useIsNarrowViewport } from '../landscape/useIsNarrowViewport';
import {
  DEFAULT_INTEGRATION_FILTERS,
  DEFAULT_INTEGRATION_SORT_KEY,
  INTEGRATION_SORT_COLUMNS,
  filterIntegrationRows,
  groupIntegrationRows,
  hasActiveIntegrationFilters,
  sortIntegrationRows,
  type IntegrationFilters,
  type IntegrationSortKey,
} from './integrationFilter';
import type { IntegrationRow } from './integrationRows';
import type { IntegrationsData } from './useIntegrations';
import styles from './IntegrationsView.module.css';

export interface IntegrationsViewProps {
  data: IntegrationsData;
  elementHref: (elementId: UUID) => string;
}

/** Same breakpoint every other table → mobile-card swap in this app uses. */
const MOBILE_BREAKPOINT_PX = 768;

const ROUTING_OPTIONS: { value: IntegrationFilters['routing']; label: string }[] = [
  { value: 'all', label: 'All routing' },
  { value: 'direct', label: 'Direct' },
  { value: 'platform', label: 'Via platform' },
  { value: 'interface', label: 'Via interface' },
];

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b));
}

/**
 * The Integrations page's chrome: toolbar, then rows grouped under the
 * platform that manages them (or a flat list), as a table or — on a phone
 * — cards. UI-only state (sort, filters, grouping, the one expanded row),
 * all client-side over `useIntegrations.ts`'s already-loaded rows, the same
 * shape `PortfolioView.tsx` has. The managing platform is the first thing
 * on every row; a direct link says so in that same place.
 */
export function IntegrationsView({ data, elementHref }: IntegrationsViewProps) {
  const [filters, setFilters] = useState<IntegrationFilters>(DEFAULT_INTEGRATION_FILTERS);
  const [sortKey, setSortKey] = useState<IntegrationSortKey>(DEFAULT_INTEGRATION_SORT_KEY);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [grouped, setGrouped] = useState(true);
  const [expandedId, setExpandedId] = useState<UUID | null>(null);
  const narrow = useIsNarrowViewport(MOBILE_BREAKPOINT_PX);

  const platforms = useMemo(() => {
    const byId = new Map<UUID, string>();
    for (const row of data.rows) if (row.platform) byId.set(row.platform.element_id, row.platform.name);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data.rows]);
  const interfaceTypes = useMemo(() => uniqueSorted(data.rows.map((r) => r.interfaceTypeLabel)), [data.rows]);
  const classifications = useMemo(() => uniqueSorted(data.rows.map((r) => r.dataClassification)), [data.rows]);

  const rows = useMemo(() => sortIntegrationRows(filterIntegrationRows(data.rows, filters), sortKey, sortDirection), [data.rows, filters, sortKey, sortDirection]);
  const groups = useMemo(() => (grouped ? groupIntegrationRows(rows) : [{ platformId: null, label: '', rows }]), [grouped, rows]);

  function handleSort(key: IntegrationSortKey): void {
    if (key === sortKey) setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }
  const toggleExpand = (id: UUID): void => {
    setExpandedId((current) => (current === id ? null : id));
  };
  const select = (label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[]) => (
    <label className={styles.field}>
      <span>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div>
      <div className={styles.toolbar}>
        {select('Platform', filters.platform, (v) => { setFilters({ ...filters, platform: v }); }, [{ value: 'all', label: 'All platforms' }, ...platforms.map(([id, name]) => ({ value: id, label: name }))])}
        {select('Routing', filters.routing, (v) => { setFilters({ ...filters, routing: v as IntegrationFilters['routing'] }); }, ROUTING_OPTIONS)}
        {select('Interface type', filters.interfaceType, (v) => { setFilters({ ...filters, interfaceType: v }); }, [{ value: 'all', label: 'All interface types' }, ...interfaceTypes.map((t) => ({ value: t, label: t }))])}
        {select('Data classification', filters.dataClassification, (v) => { setFilters({ ...filters, dataClassification: v }); }, [{ value: 'all', label: 'All classifications' }, ...classifications.map((c) => ({ value: c, label: c }))])}
        {select('Sort by', sortKey, (v) => { handleSort(v as IntegrationSortKey); }, INTEGRATION_SORT_COLUMNS.map((c) => ({ value: c.key, label: c.label })))}
        <button type="button" className={styles.directionButton} aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`} onClick={() => { handleSort(sortKey); }}>
          {sortDirection === 'asc' ? '▲' : '▼'}
        </button>
        {hasActiveIntegrationFilters(filters) && (
          <button type="button" className={styles.clearButton} onClick={() => { setFilters(DEFAULT_INTEGRATION_FILTERS); }}>
            Clear filters
          </button>
        )}
        <label className={styles.toggle}>
          <input type="checkbox" checked={filters.gapsOnly} onChange={(e) => { setFilters({ ...filters, gapsOnly: e.target.checked }); }} />
          <span>Missing protocol or classification</span>
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={grouped} onChange={(e) => { setGrouped(e.target.checked); }} />
          <span>Group by platform</span>
        </label>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState>No system-to-system links in this model yet.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>No integrations match this filter.</EmptyState>
      ) : narrow ? (
        <ul className={styles.cards}>
          {groups.map((group) => (
            <Fragment key={group.platformId ?? 'direct'}>
              {grouped && <GroupHeading label={group.label} count={group.rows.length} platformId={group.platformId} elementHref={elementHref} as="li" />}
              {group.rows.map((row) => (
                <li key={row.relationshipId} className={styles.card}>
                  <button type="button" className={styles.cardButton} aria-expanded={expandedId === row.relationshipId} aria-label={`${expandedId === row.relationshipId ? 'Collapse' : 'Expand'} ${row.sourceName} to ${row.targetName}`} onClick={() => { toggleExpand(row.relationshipId); }}>
                    <PlatformCell row={row} elementHref={elementHref} asText />
                    <Text as="span" className={styles.endpoints}>
                      {row.sourceName} → {row.targetName}
                    </Text>
                    <Text as="span" size="sm" tone="muted">
                      {[row.integrationInterface?.name, row.protocol].filter(Boolean).join(' · ')}
                    </Text>
                  </button>
                  {expandedId === row.relationshipId && <RowDetail row={row} elementHref={elementHref} />}
                </li>
              ))}
            </Fragment>
          ))}
        </ul>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {INTEGRATION_SORT_COLUMNS.map((column) => (
                  <th key={column.key}>
                    <button type="button" className={styles.sortButton} onClick={() => { handleSort(column.key); }}>
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
              {groups.map((group) => (
                <Fragment key={group.platformId ?? 'direct'}>
                  {grouped && (
                    <tr>
                      <td colSpan={INTEGRATION_SORT_COLUMNS.length + 1} className={styles.groupCell}>
                        <GroupHeading label={group.label} count={group.rows.length} platformId={group.platformId} elementHref={elementHref} as="div" />
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row) => {
                    const expanded = expandedId === row.relationshipId;
                    return (
                      <Fragment key={row.relationshipId}>
                        <tr>
                          <td><PlatformCell row={row} elementHref={elementHref} /></td>
                          <td>{row.integrationInterface ? <Link to={elementHref(row.integrationInterface.element_id)}>{row.integrationInterface.name}</Link> : row.platform ? <Text as="span" tone="faint" size="sm">No interface named</Text> : <Text as="span" tone="faint" size="sm">—</Text>}</td>
                          <td><Link to={elementHref(row.source.element_id)}>{row.sourceName}</Link> <AgentTagFor element={row.source} /></td>
                          <td><Link to={elementHref(row.target.element_id)}>{row.targetName}</Link> <AgentTagFor element={row.target} /></td>
                          <td><Text as="span" size="sm" tone="muted">{row.linkType === 'uses' ? 'uses' : 'flows to'}</Text></td>
                          <td>{row.protocol ? <Text as="span" size="sm">{row.protocol}</Text> : <Text as="span" tone="faint" size="sm">Not recorded</Text>}</td>
                          <td>{row.dataClassification ? <Chip tone="neutral">{row.dataClassification}</Chip> : <Text as="span" tone="faint" size="sm">—</Text>}</td>
                          <td>
                            <button type="button" className={styles.expandButton} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.sourceName} to ${row.targetName}`} onClick={() => { toggleExpand(row.relationshipId); }}>
                              {expanded ? '▾' : '▸'}
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={INTEGRATION_SORT_COLUMNS.length + 1}>
                              <RowDetail row={row} elementHref={elementHref} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The managing platform, bold with its icon; a direct link says so here too. */
function PlatformCell({ row, elementHref, asText = false }: { row: IntegrationRow; elementHref: (id: UUID) => string; asText?: boolean }) {
  if (!row.platform) {
    return (
      <Text as="span" tone="muted" size="sm">
        Direct (no platform)
      </Text>
    );
  }
  const content = (
    <>
      <Plug size={14} aria-hidden="true" /> {row.platform.name}
    </>
  );
  return asText ? <span className={styles.platform}>{content}</span> : <Link to={elementHref(row.platform.element_id)} className={styles.platform}>{content}</Link>;
}

function GroupHeading({ label, count, platformId, elementHref, as: Tag }: { label: string; count: number; platformId: UUID | null; elementHref: (id: UUID) => string; as: 'li' | 'div' }) {
  const text = `${String(count)} ${count === 1 ? 'integration' : 'integrations'}`;
  return (
    <Tag className={styles.groupHeading}>
      {platformId ? (
        <Link to={elementHref(platformId)} className={styles.platform}>
          <Plug size={14} aria-hidden="true" /> {label}
        </Link>
      ) : (
        <Text as="span" tone="muted">{label}</Text>
      )}
      <Text as="span" size="sm" tone="muted"> · {text}</Text>
    </Tag>
  );
}

function RowDetail({ row, elementHref }: { row: IntegrationRow; elementHref: (id: UUID) => string }) {
  return (
    <div className={styles.detail}>
      {row.description && <Text as="p" size="sm">“{row.description}”</Text>}
      {row.integrationInterface && (
        <Text as="p" size="sm">
          Interface <Link to={elementHref(row.integrationInterface.element_id)}>{row.integrationInterface.name}</Link>
          {row.interfaceTypeLabel ? ` (${row.interfaceTypeLabel})` : ''}
          {row.transformation ? ` — ${row.transformation}` : ''}
        </Text>
      )}
      {!row.platform && <Text as="p" size="sm" tone="muted">This link goes directly between the two systems, with no integration platform managing it.</Text>}
      {!row.description && !row.integrationInterface && row.platform && <Text as="p" size="sm" tone="muted">Goes through the platform; no interface or description recorded.</Text>}
    </div>
  );
}

/** The plain "AI" tag after an endpoint that is an AI agent; nothing for any other element. */
function AgentTagFor({ element }: { element: IntegrationRow['source'] }) {
  const autonomy = element.element_type === 'system' ? aiAutonomyOf(element) : null;
  return autonomy === null ? null : <AiAgentTag autonomy={autonomy} />;
}
