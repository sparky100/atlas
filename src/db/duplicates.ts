/**
 * F4 (ADR-019 "Amended (F4, ...)"): thin typed wrappers around the
 * duplicates-report schema and RPCs (`20260924010000_duplicates_schema.sql`,
 * `20260924020000_duplicate_check_rpcs.sql`). Untyped client, same as every
 * other src/db repository (branches.ts's own module comment) —
 * `eslint-disable` comments mark exactly that boundary.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { DuplicateCandidateRow, DuplicateCheckRunRow, DuplicateDismissalRow } from './types';

/** Every open candidate pair on this model, highest score first — `duplicate_candidates_select`'s RLS (contributor+). A merged-away or retracted element's row is pruned by `run_duplicate_check` itself (never a stale row this read has to filter out). */
export async function listDuplicateCandidates(supabase: Client, modelId: UUID): Promise<DuplicateCandidateRow[]> {
  const { data, error } = await supabase.from('duplicate_candidates').select('*').eq('model_id', modelId).order('score', { ascending: false });
  if (error) throw new Error(`listDuplicateCandidates: ${error.message}`);
  return (data as DuplicateCandidateRow[] | null) ?? [];
}

/** The most recent check run on this model, or `null` if none has ever run — the report page's own "last checked" line. */
export async function getLatestDuplicateCheckRun(supabase: Client, modelId: UUID): Promise<DuplicateCheckRunRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase
    .from('duplicate_check_runs')
    .select('*')
    .eq('model_id', modelId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getLatestDuplicateCheckRun: ${error.message}`);
  return data as DuplicateCheckRunRow | null;
}

/** Invokes `atlas.run_duplicate_check` (contributor+ when called by a real signed-in user) — synchronous: by the time this resolves, the run has already reached `succeeded`/`failed`, so the caller doesn't need to poll for completion, only reload the candidate list. */
export async function runDuplicateCheck(supabase: Client, modelId: UUID): Promise<DuplicateCheckRunRow> {
  const { data, error } = await supabase.schema('atlas').rpc('run_duplicate_check', { p_model_id: modelId }).single();
  if (error) throw new Error(`runDuplicateCheck: ${error.message}`);
  return data as DuplicateCheckRunRow;
}

/** Invokes `atlas.dismiss_duplicate_pair` (contributor+) — idempotent, and removes the matching `duplicate_candidates` row so a subsequent `listDuplicateCandidates` reflects it immediately, without waiting for the next check run. */
export async function dismissDuplicatePair(supabase: Client, modelId: UUID, elementAId: UUID, elementBId: UUID): Promise<DuplicateDismissalRow> {
  const { data, error } = await supabase.schema('atlas').rpc('dismiss_duplicate_pair', { p_model_id: modelId, p_element_a_id: elementAId, p_element_b_id: elementBId }).single();
  if (error) throw new Error(`dismissDuplicatePair: ${error.message}`);
  return data as DuplicateDismissalRow;
}

/** Flips the per-model nightly-sweep toggle (`models.duplicates_check_enabled`, a plain column grant — `models_update`'s existing RLS, owner/architect, already gates it correctly). The manual "Check now" path (`runDuplicateCheck`) works regardless of this setting. */
export async function setDuplicatesCheckEnabled(supabase: Client, modelId: UUID, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('models').update({ duplicates_check_enabled: enabled }).eq('id', modelId);
  if (error) throw new Error(`setDuplicatesCheckEnabled: ${error.message}`);
}
