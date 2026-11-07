/**
 * ADR-027 (F14 step 6b): the pure rules for dashboard tiles. A tile re-shapes
 * how a saved report is shown (a big number, a bar, a stacked bar, a donut, a
 * short table); it never changes what the report asks, so the report's own
 * filters always apply. Position and size are display hints (rule 3).
 */
import type { UUID } from '../../contracts/delta';
import type { ReportRow, ReportSpec } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import type { DashboardRow, DashboardTileKind, DashboardTileRow, MemberRole, ReportVisibility } from '../../db/types';

export const TILE_KIND_LABEL: Record<DashboardTileKind, string> = {
  kpi: 'Big number',
  bar: 'Bar chart',
  stackedBar: 'Stacked bar chart',
  donut: 'Donut',
  table: 'Table',
};

export const DEFAULT_TABLE_TILE_ROWS = 5;

/** Which tile kinds can show this report. A bar or donut needs a grouping; a stacked bar needs a second grouping too. */
export function tileKindsFor(spec: ReportSpec): DashboardTileKind[] {
  const kinds: DashboardTileKind[] = ['kpi'];
  if (spec.groupBy !== undefined) kinds.push('bar', 'donut');
  if (spec.groupBy !== undefined && spec.splitBy !== undefined) kinds.push('stackedBar');
  kinds.push('table');
  return kinds;
}

/** The kind a report most naturally suggests when someone adds it to a dashboard. */
export function suggestedTileKind(spec: ReportSpec): DashboardTileKind {
  if (spec.groupBy !== undefined && spec.splitBy !== undefined) return 'stackedBar';
  if (spec.groupBy !== undefined) return spec.presentation.kind === 'donut' ? 'donut' : 'bar';
  return spec.presentation.kind === 'count' ? 'kpi' : 'table';
}

/** The report as this tile runs it: same source, filters, columns, sort and grouping; only the presentation follows the tile. A kind the report cannot show falls back to a big number. */
export function specForTile(spec: ReportSpec, kind: DashboardTileKind, rowLimit: number | null): ReportSpec {
  const withoutSplit: ReportSpec = { ...spec };
  delete withoutSplit.splitBy;
  const usable = tileKindsFor(spec).includes(kind) ? kind : 'kpi';
  switch (usable) {
    case 'kpi':
      return { ...withoutSplit, presentation: { kind: 'count' } };
    case 'bar':
      return { ...withoutSplit, presentation: { kind: 'barByField' } };
    case 'donut':
      return { ...withoutSplit, presentation: { kind: 'donut' } };
    case 'stackedBar':
      return { ...spec, presentation: { kind: 'barByField' } };
    case 'table':
      return { ...withoutSplit, presentation: { kind: 'table', limit: rowLimit ?? DEFAULT_TABLE_TILE_ROWS } };
  }
}

/** The next free position at the end of a dashboard. */
export function nextTilePosition(tiles: readonly Pick<DashboardTileRow, 'position'>[]): number {
  return tiles.reduce((max, t) => Math.max(max, t.position + 1), 0);
}

export interface PositionUpdate {
  id: UUID;
  position: number;
}

/**
 * The position updates that swap a tile with its neighbour, in the order to
 * apply them. The database refuses two tiles at one position, and each update
 * is its own request, so a swap goes through a spare position: A to spare, B
 * to A's old place, A to B's old place. Empty when the tile is already at that
 * end or is not on the dashboard.
 */
export function swapTilePositions(tiles: readonly Pick<DashboardTileRow, 'id' | 'position'>[], tileId: UUID, direction: 'earlier' | 'later'): PositionUpdate[] {
  const ordered = [...tiles].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((t) => t.id === tileId);
  const neighbour = ordered[direction === 'earlier' ? index - 1 : index + 1];
  const tile = ordered[index];
  if (index < 0 || !tile || !neighbour) return [];
  const spare = nextTilePosition(ordered);
  return [
    { id: tile.id, position: spare },
    { id: neighbour.id, position: tile.position },
    { id: tile.id, position: neighbour.position },
  ];
}

/** A dashboard shared with the organisation can only show reports shared too (the database refuses otherwise); this keeps the picker from offering what it would refuse. */
export function reportsOfferableTo<T extends { visibility: ReportVisibility }>(reports: readonly T[], dashboardVisibility: ReportVisibility): T[] {
  return dashboardVisibility === 'organisation' ? reports.filter((r) => r.visibility === 'organisation') : [...reports];
}

/** CSS grid span for a tile size, out of a three-column desktop grid. */
export function tileColumnSpan(size: 'one' | 'two' | 'full'): number {
  return size === 'one' ? 1 : size === 'two' ? 2 : 3;
}

/** Who may edit a dashboard: its creator, or an organisation owner or architect for a shared one. Mirrors the database's rule so nobody is offered what it would refuse. */
export function canEditDashboard(dashboard: Pick<DashboardRow, 'created_by' | 'visibility'>, userId: UUID | null, role: MemberRole | null): boolean {
  if (userId === null) return false;
  if (dashboard.created_by === userId) return true;
  return dashboard.visibility === 'organisation' && (role === 'owner' || role === 'architect');
}

/** The fields that say *what kind of thing* a report counts (systems, applications), as opposed to which of them. */
const SCOPE_FIELDS: ReadonlySet<string> = new Set(['elementType', 'type']);

/**
 * What a big number is a share of: the same kind of thing the report counts,
 * before its other filters ("6 of 34 applications", not "of 39 portfolio
 * rows including modules"). Pure.
 */
export function kpiBaseline(spec: ReportSpec, rows: readonly ReportRow[]): { total: number; noun: string } {
  const scope = spec.filters.filter((f) => SCOPE_FIELDS.has(f.field));
  const total = runReport(rows, { ...spec, filters: scope, presentation: { kind: 'count' } }).rowCount;
  const typeEq = scope.find((f) => f.field === 'type' && f.operator === 'eq' && typeof f.value === 'string');
  let noun = spec.source === 'portfolio' ? 'portfolio items' : 'elements';
  if (spec.source === 'portfolio' && scope.some((f) => f.field === 'elementType' && f.operator === 'neq' && f.value === 'container')) noun = 'applications';
  else if (typeEq !== undefined) noun = `${String(typeEq.value).replace(/_/g, ' ')}s`;
  return { total, noun };
}
