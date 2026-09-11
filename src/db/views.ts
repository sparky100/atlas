/**
 * `views` repository operations (SPEC §3.9, ADR-011): get-or-create the one
 * saved-query row a model/element's view kind hangs off. Thin, typed
 * wrappers.
 *
 * `view_layouts` itself has no repository functions here any more — Sprint
 * U4-2b item 6 removed the landscape's own read/write of it (this module's
 * bottom comment has the full reasoning); the layout *algorithm* remains
 * src/ui/landscape/layout.ts, unrelated to persistence.
 *
 * Same untyped-client caveat as src/db/branches.ts: `data`/`error` come back
 * loosely typed from postgrest-js, asserted to the real row shape at each
 * function's one return point.
 */
import type { Client } from './client';
import type { ViewKind, ViewRow } from './types';
import type { UUID } from '../contracts/delta';

export interface GetOrCreateViewInput {
  /** Minted by the caller if a new row turns out to be needed — see module comment on why this isn't generated here. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  kind: ViewKind;
  name: string;
  createdBy: UUID;
  /**
   * Which branch's folded state this view renders — `null`/omitted means
   * `main` (SPEC §3.9). A branch's own As-is/To-be/Diff selector
   * (UI-principles §6.2) shares *one* view/layout set across all three
   * modes ("positions come from the same view_layouts rows in all three so
   * nothing jumps when toggling") and keeps it separate from main's own —
   * hence keying the get-or-create lookup on `branch_id` too, not folding
   * a branch's layout into main's.
   */
  branchId?: UUID | null;
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
  const branchId = input.branchId ?? null;
  let query = supabase.from('views').select('*').eq('model_id', input.modelId).eq('kind', input.kind).is('scope_element_id', null);
  query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
  const existing = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing.error) throw new Error(`getOrCreateModelView: ${existing.error.message}`);
  if (existing.data) return existing.data as ViewRow;

  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    kind: input.kind,
    scope_element_id: null,
    branch_id: branchId,
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
  const branchId = input.branchId ?? null;
  let query = supabase.from('views').select('*').eq('model_id', input.modelId).eq('kind', input.kind).eq('scope_element_id', input.scopeElementId);
  query = branchId ? query.eq('branch_id', branchId) : query.is('branch_id', null);
  const existing = await query.order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing.error) throw new Error(`getOrCreateScopedView: ${existing.error.message}`);
  if (existing.data) return existing.data as ViewRow;

  const row = {
    id: input.id,
    org_id: input.orgId,
    model_id: input.modelId,
    name: input.name,
    kind: input.kind,
    scope_element_id: input.scopeElementId,
    branch_id: branchId,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('views').insert(row).select('*').single();
  if (error) throw new Error(`getOrCreateScopedView: ${error.message}`);
  return data as ViewRow;
}

// Sprint U4-2b item 6: the landscape was the only view kind that ever read
// or wrote `view_layouts` (Context/Container/Component never have — see
// each of their own hooks' "No view_layouts" comments; the capability map
// never has either — CapabilityMapView.tsx's own layout is plain DOM/CSS).
// It now auto-lays-out on every open instead (`useLandscape.ts`'s own
// comment), so nothing in the app calls `list`/`upsert`/`clearViewLayouts`
// any more — removed rather than left as untested, uncalled exports.
// `view_layouts` itself stays in the schema (ADR-011: a view is a saved
// query; a future feature may yet want per-user saved positions), just
// with nothing currently writing to it.
