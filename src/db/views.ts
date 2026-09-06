/**
 * `views`/`view_layouts` repository operations (SPEC §3.9, ADR-011). Thin,
 * typed wrappers — the layout *algorithm* is src/ui/landscape/layout.ts,
 * which these functions hand real rows to and receive positions back from.
 *
 * Same untyped-client caveat as src/db/branches.ts: `data`/`error` come back
 * loosely typed from postgrest-js, asserted to the real row shape at each
 * function's one return point.
 */
import type { Client } from './client';
import type { LayoutSubjectType, ViewKind, ViewLayoutRow, ViewRow } from './types';
import type { UUID } from '../contracts/delta';

export interface GetOrCreateViewInput {
  /** Minted by the caller if a new row turns out to be needed — see module comment on why this isn't generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  kind: ViewKind;
  name: string;
  createdBy: UUID;
}

/**
 * Sprint U1 has exactly one saved view per (model, kind) that's ever
 * created from the UI — there's no "new view" affordance yet, just the one
 * landscape a model home links to. Find it if a previous visit already
 * created it; create it, racing safely with a concurrent first visit, if
 * not (SPEC §3.9 gives `views` no uniqueness constraint on (model_id, kind)
 * to lean on, so a lost race here just leaves an extra, harmless row rather
 * than erroring — acceptable for a get-or-create with no user-visible
 * "which view" choice to make yet).
 */
export async function getOrCreateModelView(supabase: Client, input: GetOrCreateViewInput): Promise<ViewRow> {
  const existing = await supabase
    .from('views')
    .select('*')
    .eq('model_id', input.modelId)
    .eq('kind', input.kind)
    .is('scope_element_id', null)
    .is('branch_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`getOrCreateModelView: ${existing.error.message}`);
  if (existing.data) return existing.data as ViewRow;

  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    kind: input.kind,
    scope_element_id: null,
    branch_id: null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('views').insert(row).select('*').single();
  if (error) throw new Error(`getOrCreateModelView: ${error.message}`);
  return data as ViewRow;
}

export interface GetOrCreateScopedViewInput extends GetOrCreateViewInput {
  /** Required for `context`/`container`/`component` (SPEC §3.9's own check constraint on `views`) — the one System/Container this view is scoped to. */
  scopeElementId: UUID;
}

/**
 * Same get-or-create shape as `getOrCreateModelView`, for the three view
 * kinds that are scoped to one element rather than the whole model
 * (Context/Container/Component, UI-principles §6.1) — a separate function,
 * not an optional parameter on that one, so a landscape/capability_map call
 * site can't accidentally pass a scope that the DB would reject anyway.
 */
export async function getOrCreateScopedView(supabase: Client, input: GetOrCreateScopedViewInput): Promise<ViewRow> {
  const existing = await supabase
    .from('views')
    .select('*')
    .eq('model_id', input.modelId)
    .eq('kind', input.kind)
    .eq('scope_element_id', input.scopeElementId)
    .is('branch_id', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`getOrCreateScopedView: ${existing.error.message}`);
  if (existing.data) return existing.data as ViewRow;

  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    kind: input.kind,
    scope_element_id: input.scopeElementId,
    branch_id: null,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('views').insert(row).select('*').single();
  if (error) throw new Error(`getOrCreateScopedView: ${error.message}`);
  return data as ViewRow;
}

export async function listViewLayouts(supabase: Client, viewId: UUID): Promise<ViewLayoutRow[]> {
  const { data, error } = await supabase.from('view_layouts').select('*').eq('view_id', viewId);
  if (error) throw new Error(`listViewLayouts: ${error.message}`);
  return data as ViewLayoutRow[];
}

export interface UpsertLayoutInput {
  orgId: UUID;
  viewId: UUID;
  subjectType: LayoutSubjectType;
  subjectId: UUID;
  x: number | null;
  y: number | null;
  updatedBy: UUID;
}

/** One round trip for however many positions need saving — a fresh layout run touches every node at once, not one row at a time. */
export async function upsertViewLayouts(supabase: Client, inputs: readonly UpsertLayoutInput[]): Promise<void> {
  if (inputs.length === 0) return;
  const rows = inputs.map((input) => ({
    org_id: input.orgId,
    view_id: input.viewId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    x: input.x,
    y: input.y,
    updated_by: input.updatedBy,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('view_layouts').upsert(rows, { onConflict: 'view_id,subject_id' });
  if (error) throw new Error(`upsertViewLayouts: ${error.message}`);
}

/** "Reset layout" (UI-principles §6.4): delete every position hint for this view. Auto-layout re-runs against whatever's left, computing the same result again — ADR-011's litmus test, exercised for real by the caller re-fetching afterward. */
export async function clearViewLayouts(supabase: Client, viewId: UUID): Promise<void> {
  const { error } = await supabase.from('view_layouts').delete().eq('view_id', viewId);
  if (error) throw new Error(`clearViewLayouts: ${error.message}`);
}
