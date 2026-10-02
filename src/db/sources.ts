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

export interface CreateAttestationSourceInput {
  /** Minted by the caller — one row per confirmation, like `merge_resolution`'s per-refresh row. */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  createdBy: UUID;
  /** What was confirmed — shown in a provenance badge's hover card, e.g. "Confirmed still accurate — Payroll". */
  elementName: string;
  /** The confirmation's date (`YYYY-MM-DD`) — `sources.captured_at`. */
  confirmedOn: string;
}

/** ADR-025: one `attestation` source per "Still accurate" — every delta re-asserting that element's facts shares it. `sources_insert` (20261004020000) requires `user_id` null for this kind; the confirming person is the commit's author. */
export async function createAttestationSource(supabase: Client, input: CreateAttestationSourceInput): Promise<SourceRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: 'attestation' as const, name: `Confirmed still accurate — ${input.elementName}`, captured_at: input.confirmedOn, created_by: input.createdBy };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').insert(row).select('*').single();
  if (error) throw new Error(`createAttestationSource: ${error.message}`);
  return data as SourceRow;
}

export interface CreateSpreadsheetSourceInput {
  /** Minted by the caller — a fresh row every import run, not a per-user singleton (an import's provenance is naturally scoped to the one file it came from, same reasoning `createMergeResolutionSource`'s own doc comment gives for its own per-refresh row). */
  id: UUID;
  orgId: UUID;
  modelId: UUID;
  createdBy: UUID;
  /** The imported file's own name — shown in a provenance badge's hover card the same way `createMergeResolutionSource`'s branch title is, so "where did this come from" names the actual file, not just "a spreadsheet". */
  fileName: string;
  /** F2-lite: every element id this run's rows matched or created — `sources.import_touched_element_ids`, required for this kind. Lets a change page recompute "not in file" at any later time, not just while the file is still in memory. */
  touchedElementIds: readonly UUID[];
  /** F2-lite import close-out: every confirmed same-as pick's own alias, awaiting this change's own merge — `sources.pending_aliases`, applied by `mergeApprovedRequest`, never written here. */
  pendingAliases: readonly { elementId: UUID; aliasValue: string }[];
}

/**
 * One `spreadsheet` source per import run (F2-lite, reconciliation-style
 * import superseding F2 Phase 1/2's narrower matching) — every delta that
 * run's own commit writes shares it. `sources_insert`'s RLS already allows
 * an ordinary contributor+ to insert `kind: 'spreadsheet'`
 * (`supabase/migrations/20260906071500_sources_and_aliases.sql`) — no RLS
 * change needed for this function, only the `import_touched_element_ids`
 * column `20260918010000_import_touched_element_ids.sql` added.
 */
export async function createSpreadsheetSource(supabase: Client, input: CreateSpreadsheetSourceInput): Promise<SourceRow> {
  const row = { id: input.id, org_id: input.orgId, model_id: input.modelId, kind: 'spreadsheet' as const, name: input.fileName, created_by: input.createdBy, import_touched_element_ids: [...input.touchedElementIds], pending_aliases: input.pendingAliases.map((a) => ({ elementId: a.elementId, aliasValue: a.aliasValue })) };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('sources').insert(row).select('*').single();
  if (error) throw new Error(`createSpreadsheetSource: ${error.message}`);
  return data as SourceRow;
}

/** F2-lite import close-out: marks a spreadsheet source's pending aliases as applied, once `mergeApprovedRequest` has written each one as a real `aliases` row — idempotent (an empty array clears cleanly again) so a re-run after a partial failure never double-writes. */
export async function clearPendingAliases(supabase: Client, sourceId: UUID): Promise<void> {
  const { error } = await supabase.from('sources').update({ pending_aliases: [] }).eq('id', sourceId);
  if (error) throw new Error(`clearPendingAliases: ${error.message}`);
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
