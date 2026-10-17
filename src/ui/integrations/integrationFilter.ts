import type { UUID } from '../../contracts/delta';
import type { IntegrationRouting, IntegrationRow } from './integrationRows';

export interface IntegrationFilters {
  routing: 'all' | IntegrationRouting;
  /** A platform's element id, or `all`. */
  platform: string;
  /** An interface type's label, or `all`. */
  interfaceType: string;
  /** A protocol label to match on either side, or `all`. */
  protocol: string;
  /** A data classification, or `all`. */
  dataClassification: string;
  /** Only links missing a protocol or a data classification. */
  gapsOnly: boolean;
}

export const DEFAULT_INTEGRATION_FILTERS: IntegrationFilters = { routing: 'all', platform: 'all', interfaceType: 'all', protocol: 'all', dataClassification: 'all', gapsOnly: false };

export function hasActiveIntegrationFilters(filters: IntegrationFilters): boolean {
  return (Object.keys(DEFAULT_INTEGRATION_FILTERS) as (keyof IntegrationFilters)[]).some((key) => filters[key] !== DEFAULT_INTEGRATION_FILTERS[key]);
}

export function filterIntegrationRows(rows: readonly IntegrationRow[], filters: IntegrationFilters): IntegrationRow[] {
  return rows.filter((row) => {
    if (filters.routing !== 'all' && row.routing !== filters.routing) return false;
    if (filters.platform !== 'all' && row.platform?.element_id !== filters.platform) return false;
    if (filters.interfaceType !== 'all' && row.interfaceTypeLabel !== filters.interfaceType) return false;
    if (filters.protocol !== 'all' && !(row.protocol ?? '').includes(filters.protocol)) return false;
    if (filters.dataClassification !== 'all' && row.dataClassification !== filters.dataClassification) return false;
    if (filters.gapsOnly && row.protocol !== null && row.dataClassification !== null) return false;
    return true;
  });
}

export type IntegrationSortKey = 'platform' | 'interface' | 'source' | 'target' | 'linkType' | 'protocol' | 'dataClassification';
export const DEFAULT_INTEGRATION_SORT_KEY: IntegrationSortKey = 'platform';

export const INTEGRATION_SORT_COLUMNS: { key: IntegrationSortKey; label: string }[] = [
  { key: 'platform', label: 'Platform' },
  { key: 'interface', label: 'Interface' },
  { key: 'source', label: 'Source' },
  { key: 'target', label: 'Target' },
  { key: 'linkType', label: 'Link' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'dataClassification', label: 'Data classification' },
];

function sortValue(row: IntegrationRow, key: IntegrationSortKey): string {
  switch (key) {
    case 'platform':
      return row.platform?.name ?? '';
    case 'interface':
      return row.integrationInterface?.name ?? '';
    case 'source':
      return row.sourceName;
    case 'target':
      return row.targetName;
    case 'linkType':
      return row.linkType;
    case 'protocol':
      return row.protocol ?? '';
    case 'dataClassification':
      return row.dataClassification ?? '';
  }
}

/** Sorted by `key` then source, target and relationship id, so ties never reorder between renders. Direct links (no platform) sort after every platform when sorting by platform, in either direction. */
export function sortIntegrationRows(rows: readonly IntegrationRow[], key: IntegrationSortKey, direction: 'asc' | 'desc'): IntegrationRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'platform' && (a.platform === null) !== (b.platform === null)) return a.platform === null ? 1 : -1;
    const primary = sortValue(a, key).localeCompare(sortValue(b, key)) * sign;
    if (primary !== 0) return primary;
    return a.sourceName.localeCompare(b.sourceName) || a.targetName.localeCompare(b.targetName) || a.relationshipId.localeCompare(b.relationshipId);
  });
}

export interface IntegrationGroup {
  /** The platform's element id; `null` for the Direct group. */
  platformId: UUID | null;
  label: string;
  rows: IntegrationRow[];
}

/** Rows grouped by managing platform, in the order platforms first appear in `rows`; the Direct group, if any, last. */
export function groupIntegrationRows(rows: readonly IntegrationRow[]): IntegrationGroup[] {
  const groups = new Map<UUID, IntegrationGroup>();
  const direct: IntegrationRow[] = [];
  for (const row of rows) {
    if (!row.platform) {
      direct.push(row);
      continue;
    }
    const existing = groups.get(row.platform.element_id);
    if (existing) existing.rows.push(row);
    else groups.set(row.platform.element_id, { platformId: row.platform.element_id, label: row.platform.name, rows: [row] });
  }
  const result = [...groups.values()];
  if (direct.length > 0) result.push({ platformId: null, label: 'Direct (no platform)', rows: direct });
  return result;
}
