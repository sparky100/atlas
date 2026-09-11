/**
 * Model repository operations. Thin, typed wrappers — see
 * branches.ts/tags.ts's module comment for the untyped-client
 * `eslint-disable` boundary this follows.
 */
import type { Client } from './client';
import type { ModelRow } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateModelInput {
  /** Minted by the caller (S-1) — never generated here. */
  id: UUID;
  orgId: UUID;
  name: string;
  slug: string;
  description?: string;
  createdBy: UUID;
}

export async function createModel(supabase: Client, input: CreateModelInput): Promise<ModelRow> {
  const row = {
    id: input.id,
    org_id: input.orgId,
    name: input.name,
    slug: input.slug,
    description: input.description ?? null,
    // The model's own schema_version, not the delta wire format's — always
    // 1 for a model created today (SPEC §3.2); a template-seeded model may
    // bump this later, which is out of this sprint's scope.
    schema_version: 1,
    created_by: input.createdBy,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').insert(row).select('*').single();
  if (error) throw new Error(`createModel: ${error.message}`);
  return data as ModelRow;
}

/**
 * Every model in the org, archived included — deliberately unfiltered.
 * "Hidden from lists and search" (item 1) is a *display* concern for the
 * one place that renders an unscoped list of models (`OrgHome.tsx`'s own
 * split into the ordinary list plus a collapsed "Archived" section, both
 * from this single fetch) — every model-scoped *route* (`ModelHome.tsx`,
 * `ElementPage.tsx`, every canvas view…) resolves its own `model` from
 * this same list by slug, and an archived model must still resolve there
 * (item 1's own "read-only when opened" requirement) even though it's
 * absent from `OrgHome`'s main list. Filtering `archived_at` out at the
 * query level, tried first, broke exactly that: a direct link to an
 * archived model became unreachable everywhere, not just hidden from one
 * list — corrected before it shipped.
 */
export async function listModelsForOrg(supabase: Client, orgId: UUID): Promise<ModelRow[]> {
  const { data, error } = await supabase.from('models').select('*').eq('org_id', orgId).order('name');
  if (error) throw new Error(`listModelsForOrg: ${error.message}`);
  return data as ModelRow[];
}

export async function getModelBySlug(supabase: Client, orgId: UUID, slug: string): Promise<ModelRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').select('*').eq('org_id', orgId).eq('slug', slug).maybeSingle();
  if (error) throw new Error(`getModelBySlug: ${error.message}`);
  return data as ModelRow | null;
}

/** By id, not slug — `scripts/backfillCapabilityOrder.ts` is the first caller: it only has a model id (a CLI argument), no org slug to resolve through first. */
export async function getModelById(supabase: Client, id: UUID): Promise<ModelRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`getModelById: ${error.message}`);
  return data as ModelRow | null;
}

export interface UpdateModelInput {
  name?: string;
  slug?: string;
  description?: string | null;
}

/** Sprint 7j item 1: rename/slug/description — a plain client update, gated by `models_update`'s own RLS (owner/architect) and the column-restricted grant the archive migration adds (name/slug/description only — `archived_at` is never reachable this way). */
export async function updateModel(supabase: Client, id: UUID, input: UpdateModelInput): Promise<ModelRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('models').update(input).eq('id', id).select('*').single();
  if (error) throw new Error(`updateModel: ${error.message}`);
  return data as ModelRow;
}

/** Owner/architect (`atlas.archive_model`'s own role check — see that migration). */
export async function archiveModel(supabase: Client, id: UUID): Promise<ModelRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('archive_model', { p_model_id: id });
  if (error) throw new Error(`archiveModel: ${error.message}`);
  return data as ModelRow;
}

/** Owner only — narrower than archive (`atlas.restore_model`'s own role check). */
export async function restoreModel(supabase: Client, id: UUID): Promise<ModelRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('restore_model', { p_model_id: id });
  if (error) throw new Error(`restoreModel: ${error.message}`);
  return data as ModelRow;
}

export type DeleteModelResult = { status: 'deleted' } | { status: 'not_archived' } | { status: 'not_found' };

/** Owner only, only when archived (`atlas.delete_model`'s own module comment has the full cascade-ordering reasoning) — `jsonb` status, not a thrown exception, for the two expected non-success outcomes (SPEC's own "RPCs that signal an outcome return jsonb with an explicit status" convention); a real failure (role denial, a database error) still throws. */
export async function deleteModel(supabase: Client, id: UUID): Promise<DeleteModelResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.schema('atlas').rpc('delete_model', { p_model_id: id });
  if (error) throw new Error(`deleteModel: ${error.message}`);
  return data as DeleteModelResult;
}
