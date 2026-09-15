/**
 * `sources` repository operations. Thin, typed wrapper — see
 * branches.ts's module comment for the untyped-client `eslint-disable`
 * boundary this follows.
 */
import type { Client } from './client';
import type { SourceRow } from './types';
import type { UUID } from '../contracts/delta';
import { selectAll } from './selectAll';

export interface GetOrCreateManualSourceInput {
  /** Minted by the caller if a new row turns out to be needed. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  userId: UUID;
}

/**
 * The `template`-kind `sources` row `atlas.seed_from_map` created when this
 * model was seeded (SPEC §3.6: `kind = 'template'` iff `capability_map_id`
 * is not null) — read-only lookup, never created here. `sources_insert`'s
 * RLS only allows an authenticated user to record `document`/`spreadsheet`/
 * `interview`/`manual` (`supabase/migrations/20260906071500_sources_and_aliases.sql`);
 * `template` (like `capture_job`) is a service-role-only kind, written
 * once, atomically, by the seed itself. Anything that needs to attribute a
 * fact to "the starter map" after that (Bug A2's sync-descriptions action:
 * src/db/syncDescriptionsFromMap.ts) reuses this same row rather than
 * minting a new one — it's the same source restating a fact it already
 * carried, not a fresh one. A model seeded at most once (SPEC §5.1) means
 * at most one such row per model.
 */
export async function getTemplateSource(supabase: Client, modelId: UUID): Promise<SourceRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').select('*').eq('model_id', modelId).eq('kind', 'template').maybeSingle();
  if (error) throw new Error(`getTemplateSource: ${error.message}`);
  return data as SourceRow | null;
}

/**
 * A person's own manual edits all share one `sources` row per model
 * (`sources_model_id_user_id_manual_idx`, SPEC §3.6 — at most one
 * `kind = 'manual'` source per (model, user)). Editing (Sprint U1 step 5)
 * is this row's first real writer: find it if a previous edit already
 * created it, create it if not.
 */
export async function getOrCreateManualSource(supabase: Client, input: GetOrCreateManualSourceInput): Promise<SourceRow> {
  const existing = await supabase.from('sources').select('*').eq('model_id', input.modelId).eq('user_id', input.userId).eq('kind', 'manual').maybeSingle();
  if (existing.error) throw new Error(`getOrCreateManualSource: ${existing.error.message}`);
  if (existing.data) return existing.data as SourceRow;

  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: 'manual' as const, name: 'Manual entry', user_id: input.userId, created_by: input.userId };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').insert(row).select('*').single();
  if (error) throw new Error(`getOrCreateManualSource: ${error.message}`);
  return data as SourceRow;
}

export interface CreateMergeResolutionSourceInput {
  /** Minted by the caller — a fresh row every refresh, not a per-user singleton like `manual`'s (no unique index backs a "one per user" claim for this kind, and a resolution's provenance is naturally scoped to the one refresh commit it belongs to, not a standing source a reviewer's other actions would also attach to). */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  createdBy: UUID;
  /** Shown in a provenance badge's hover card (§4.3) — name the branch so "where did this come from" reads as a specific event, not just "a merge". */
  branchTitle: string;
}

/** One `merge_resolution` source per refresh commit (SPEC §7.4) — every resolution delta the refresh writes shares it. `sources_insert`'s RLS (20260906162100_merge_resolution_source.sql) requires `user_id` null for this kind, unlike `manual`. */
export async function createMergeResolutionSource(supabase: Client, input: CreateMergeResolutionSourceInput): Promise<SourceRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: 'merge_resolution' as const, name: `Merge resolution — ${input.branchTitle}`, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').insert(row).select('*').single();
  if (error) throw new Error(`createMergeResolutionSource: ${error.message}`);
  return data as SourceRow;
}

/**
 * Every `sources` row for a model — the model-scoped provenance-name lookup
 * an export's "Source" column needs. Deliberately a whole-model `selectAll`
 * (CLAUDE.md rule 8's own shape), not `getSourcesByIds`'s 50-capped `.in()`
 * over a per-element source-id list: an export can name far more than 50
 * sources, and the list grows with the model.
 */
export async function listSourcesForModel(supabase: Client, modelId: UUID): Promise<SourceRow[]> {
  const query = supabase.from('sources').select('*', { count: 'exact' }).eq('model_id', modelId).order('name');
  return selectAll<SourceRow>(query);
}
