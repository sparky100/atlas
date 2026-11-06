/**
 * Saved reports, saved copies and dashboards (ADR-027, F14 —
 * `docs/ADR-027-saved-reports.md`,
 * `supabase/migrations/20261106010000_saved_reports.sql`). Thin, typed
 * wrappers over `saved_reports`, `report_snapshots`, `dashboards` and
 * `dashboard_tiles`. Who may do what, the main-only rule for copies and the
 * insert-only rule for copies all live in the database; nothing here
 * re-checks them, same division of labour as `projects.ts`.
 *
 * Every query is scoped by an id the caller owns (a model, a report, a
 * dashboard) — never an `.in()` over a list that grows with the model
 * (CLAUDE.md rule 8). An update or delete that RLS filters to zero rows is a
 * "success" to PostgREST, so those calls `.select('id')` and turn an empty
 * answer into a real error.
 */
import type { Json, UUID } from '../contracts/delta';
import { parseReportSpec, type ReportSpec, type ReportSpecParse, type ReportValue } from '../contracts/reportSpec';
import type { ReportGroup, ReportResult } from '../engine/reportQuery';
import { assertRealId } from './assertRealId';
import type { Client } from './client';
import type { DashboardRow, DashboardTileKind, DashboardTileRow, DashboardTileSize, ReportSnapshotRow, ReportVisibility, SavedReportRow } from './types';

/** A `ReportSpec` (or any JSON-shaped value) as the `Json` the database stores. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------

export interface CreateSavedReportInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  name: string;
  description?: string;
  spec: ReportSpec;
  /** Defaults to private. `organisation` needs an org owner/architect. */
  visibility?: ReportVisibility;
  createdBy: UUID;
}

export async function createSavedReport(supabase: Client, input: CreateSavedReportInput): Promise<SavedReportRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    description: input.description ?? '',
    spec: toJson(input.spec),
    spec_version: input.spec.specVersion,
    visibility: input.visibility ?? 'private',
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('saved_reports').insert(row).select('*').single();
  if (error) throw new Error(`createSavedReport: ${error.message}`);
  return data as SavedReportRow;
}

export async function getSavedReport(supabase: Client, reportId: UUID): Promise<SavedReportRow | null> {
  assertRealId('getSavedReport', 'id', reportId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('saved_reports').select('*').eq('id', reportId).maybeSingle();
  if (error) throw new Error(`getSavedReport: ${error.message}`);
  return data as SavedReportRow | null;
}

/** Every report the caller can see on a model (their own private ones and the organisation's), most recently edited first. */
export async function listSavedReports(supabase: Client, modelId: UUID): Promise<SavedReportRow[]> {
  assertRealId('listSavedReports', 'model_id', modelId);
  const { data, error } = await supabase.from('saved_reports').select('*').eq('model_id', modelId).order('updated_at', { ascending: false });
  if (error) throw new Error(`listSavedReports: ${error.message}`);
  return data as SavedReportRow[];
}

export interface UpdateSavedReportInput {
  name?: string;
  description?: string;
  spec?: ReportSpec;
  visibility?: ReportVisibility;
}

/** Edits a report. Its creator, or an org owner/architect for an organisation report (RLS). */
export async function updateSavedReport(supabase: Client, reportId: UUID, input: UpdateSavedReportInput): Promise<void> {
  assertRealId('updateSavedReport', 'id', reportId);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.spec !== undefined) {
    patch.spec = toJson(input.spec);
    patch.spec_version = input.spec.specVersion;
  }
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  const { data, error } = await supabase.from('saved_reports').update(patch).eq('id', reportId).select('id');
  if (error) throw new Error(`updateSavedReport: ${error.message}`);
  if (data.length === 0) throw new Error('updateSavedReport: you are not allowed to edit this report');
}

/**
 * Deletes a report and its dashboard tiles. Saved copies of it stay (their
 * `report_id` becomes null) — they carry their own name and definition.
 */
export async function deleteSavedReport(supabase: Client, reportId: UUID): Promise<void> {
  assertRealId('deleteSavedReport', 'id', reportId);
  const { data, error } = await supabase.from('saved_reports').delete().eq('id', reportId).select('id');
  if (error) throw new Error(`deleteSavedReport: ${error.message}`);
  if (data.length === 0) throw new Error('deleteSavedReport: you are not allowed to delete this report');
}

/** A stored report's definition, validated: an unknown `specVersion` comes back as a plain message, never a guess. */
export function savedReportSpec(row: Pick<SavedReportRow, 'spec'>): ReportSpecParse {
  return parseReportSpec(row.spec);
}

// ---------------------------------------------------------------------------
// Saved copies (point-in-time results)
// ---------------------------------------------------------------------------

export interface CreateReportSnapshotInput {
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  /** The report it came from; null for a copy of an unsaved, ad hoc report. */
  reportId: UUID | null;
  name: string;
  /** The definition as it is right now — copied into the row. */
  spec: ReportSpec;
  /** The model's main branch (the database refuses any other — ADR-027 §3). */
  branchId: UUID;
  /** The commit on that branch the result was read at. */
  commitId: UUID;
  /** The result being kept. Refused here if it exceeds the row cap, never truncated. */
  result: ReportResult;
  visibility?: ReportVisibility;
  generatedBy: UUID;
}

/** Keeps a result as a saved copy. It is never updated afterwards. */
export async function createReportSnapshot(supabase: Client, input: CreateReportSnapshotInput): Promise<ReportSnapshotRow> {
  const { result } = input;
  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    report_id: input.reportId,
    name: input.name,
    spec: toJson(input.spec),
    spec_version: input.spec.specVersion,
    branch_id: input.branchId,
    commit_id: input.commitId,
    columns: toJson(result.columns),
    rows: toJson(result.rows),
    groups: toJson(result.groups),
    unknown_fields: toJson(result.unknownFields),
    row_count: result.rowCount,
    truncated: result.truncated,
    visibility: input.visibility ?? 'private',
    generated_by: input.generatedBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('report_snapshots').insert(row).select('*').single();
  if (error) throw new Error(`createReportSnapshot: ${error.message}`);
  return data as ReportSnapshotRow;
}

export async function getReportSnapshot(supabase: Client, snapshotId: UUID): Promise<ReportSnapshotRow | null> {
  assertRealId('getReportSnapshot', 'id', snapshotId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('report_snapshots').select('*').eq('id', snapshotId).maybeSingle();
  if (error) throw new Error(`getReportSnapshot: ${error.message}`);
  return data as ReportSnapshotRow | null;
}

/** The saved copies of one report, newest first. */
export async function listSnapshotsForReport(supabase: Client, reportId: UUID): Promise<ReportSnapshotRow[]> {
  assertRealId('listSnapshotsForReport', 'report_id', reportId);
  const { data, error } = await supabase.from('report_snapshots').select('*').eq('report_id', reportId).order('generated_at', { ascending: false });
  if (error) throw new Error(`listSnapshotsForReport: ${error.message}`);
  return data as ReportSnapshotRow[];
}

/** Every saved copy the caller can see on a model, newest first — includes copies whose report has been deleted. */
export async function listSnapshotsForModel(supabase: Client, modelId: UUID): Promise<ReportSnapshotRow[]> {
  assertRealId('listSnapshotsForModel', 'model_id', modelId);
  const { data, error } = await supabase.from('report_snapshots').select('*').eq('model_id', modelId).order('generated_at', { ascending: false });
  if (error) throw new Error(`listSnapshotsForModel: ${error.message}`);
  return data as ReportSnapshotRow[];
}

/** Deletes a saved copy — its creator, or an org owner/architect for an organisation copy (RLS). The UI confirms first: it cannot be undone. */
export async function deleteReportSnapshot(supabase: Client, snapshotId: UUID): Promise<void> {
  assertRealId('deleteReportSnapshot', 'id', snapshotId);
  const { data, error } = await supabase.from('report_snapshots').delete().eq('id', snapshotId).select('id');
  if (error) throw new Error(`deleteReportSnapshot: ${error.message}`);
  if (data.length === 0) throw new Error('deleteReportSnapshot: you are not allowed to delete this saved copy');
}

/** The stored `ReportResult` of a saved copy — read only from the row, never the live model. */
export function reportResultOfSnapshot(row: ReportSnapshotRow): ReportResult {
  return {
    columns: row.columns as string[],
    rows: row.rows as ReportValue[][],
    rowCount: row.row_count,
    truncated: row.truncated,
    groups: row.groups as unknown as ReportGroup[],
    unknownFields: row.unknown_fields as string[],
  };
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface CreateDashboardInput {
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  name: string;
  visibility?: ReportVisibility;
  createdBy: UUID;
}

export async function createDashboard(supabase: Client, input: CreateDashboardInput): Promise<DashboardRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, name: input.name, visibility: input.visibility ?? 'private', created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('dashboards').insert(row).select('*').single();
  if (error) throw new Error(`createDashboard: ${error.message}`);
  return data as DashboardRow;
}

export async function getDashboard(supabase: Client, dashboardId: UUID): Promise<DashboardRow | null> {
  assertRealId('getDashboard', 'id', dashboardId);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('dashboards').select('*').eq('id', dashboardId).maybeSingle();
  if (error) throw new Error(`getDashboard: ${error.message}`);
  return data as DashboardRow | null;
}

export async function listDashboards(supabase: Client, modelId: UUID): Promise<DashboardRow[]> {
  assertRealId('listDashboards', 'model_id', modelId);
  const { data, error } = await supabase.from('dashboards').select('*').eq('model_id', modelId).order('name', { ascending: true });
  if (error) throw new Error(`listDashboards: ${error.message}`);
  return data as DashboardRow[];
}

export async function updateDashboard(supabase: Client, dashboardId: UUID, input: { name?: string; visibility?: ReportVisibility }): Promise<void> {
  assertRealId('updateDashboard', 'id', dashboardId);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.visibility !== undefined) patch.visibility = input.visibility;
  const { data, error } = await supabase.from('dashboards').update(patch).eq('id', dashboardId).select('id');
  if (error) throw new Error(`updateDashboard: ${error.message}`);
  if (data.length === 0) throw new Error('updateDashboard: you are not allowed to edit this dashboard');
}

/** Deletes a dashboard and its tiles. The reports it showed are untouched. */
export async function deleteDashboard(supabase: Client, dashboardId: UUID): Promise<void> {
  assertRealId('deleteDashboard', 'id', dashboardId);
  const { data, error } = await supabase.from('dashboards').delete().eq('id', dashboardId).select('id');
  if (error) throw new Error(`deleteDashboard: ${error.message}`);
  if (data.length === 0) throw new Error('deleteDashboard: you are not allowed to delete this dashboard');
}

// ---------------------------------------------------------------------------
// Dashboard tiles
// ---------------------------------------------------------------------------

export interface AddDashboardTileInput {
  id: UUID;
  dashboardId: UUID;
  reportId: UUID;
  position: number;
  kind: DashboardTileKind;
  size?: DashboardTileSize;
  /** Top N rows, for a table tile (1 to 50). */
  rowLimit?: number | null;
}

export async function addDashboardTile(supabase: Client, input: AddDashboardTileInput): Promise<DashboardTileRow> {
  const row = {
    id: input.id,
    dashboard_id: input.dashboardId,
    report_id: input.reportId,
    position: input.position,
    kind: input.kind,
    size: input.size ?? 'one',
    row_limit: input.rowLimit ?? null,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('dashboard_tiles').insert(row).select('*').single();
  if (error) throw new Error(`addDashboardTile: ${error.message}`);
  return data as DashboardTileRow;
}

/** A dashboard's tiles in display order. */
export async function listDashboardTiles(supabase: Client, dashboardId: UUID): Promise<DashboardTileRow[]> {
  assertRealId('listDashboardTiles', 'dashboard_id', dashboardId);
  const { data, error } = await supabase.from('dashboard_tiles').select('*').eq('dashboard_id', dashboardId).order('position', { ascending: true });
  if (error) throw new Error(`listDashboardTiles: ${error.message}`);
  return data as DashboardTileRow[];
}

export async function updateDashboardTile(
  supabase: Client,
  tileId: UUID,
  input: { position?: number; kind?: DashboardTileKind; size?: DashboardTileSize; rowLimit?: number | null },
): Promise<void> {
  assertRealId('updateDashboardTile', 'id', tileId);
  const patch: Record<string, unknown> = {};
  if (input.position !== undefined) patch.position = input.position;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.size !== undefined) patch.size = input.size;
  if (input.rowLimit !== undefined) patch.row_limit = input.rowLimit;
  const { data, error } = await supabase.from('dashboard_tiles').update(patch).eq('id', tileId).select('id');
  if (error) throw new Error(`updateDashboardTile: ${error.message}`);
  if (data.length === 0) throw new Error('updateDashboardTile: you are not allowed to edit this dashboard');
}

export async function removeDashboardTile(supabase: Client, tileId: UUID): Promise<void> {
  assertRealId('removeDashboardTile', 'id', tileId);
  const { data, error } = await supabase.from('dashboard_tiles').delete().eq('id', tileId).select('id');
  if (error) throw new Error(`removeDashboardTile: ${error.message}`);
  if (data.length === 0) throw new Error('removeDashboardTile: you are not allowed to edit this dashboard');
}
