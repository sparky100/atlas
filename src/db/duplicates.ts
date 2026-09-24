/**
 * F4 (ADR-019 "Amended (F4, ...)"): thin typed wrappers around the
 * duplicates-report schema and RPCs (`20260924010000_duplicates_schema.sql`,
 * `20260924020000_duplicate_check_rpcs.sql`). Untyped client, same as every
 * other src/db repository (branches.ts's own module comment) —
 * `eslint-disable` comments mark exactly that boundary.
 */
import type { ElementsHeadRow } from '../contracts/rows';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import { getElementsByIds } from './elements';
import type { DuplicateCandidateRow, DuplicateCheckRunRow, DuplicateDismissalRow } from './types';

export interface DuplicateCandidatesResult {
  /** Every open candidate pair on this model, highest score first, filtered to pairs whose *both* elements are still live at `commitId` (see this function's own doc comment). */
  candidates: DuplicateCandidateRow[];
  /** Every element named by a returned candidate, resolved once — callers needing a name for a row read this instead of a second `elements_head` round trip. */
  elementsById: Map<UUID, ElementsHeadRow>;
}

/**
 * `duplicate_candidates_select`'s RLS (contributor+), plus the exclusion
 * ADR-019's own "Amended (F4, ...)" paragraph (item 3) promises: "a
 * merged-away or retracted element silently drops its `duplicate_candidates`
 * row out of the report the same way it would out of any other query joined
 * to `elements_head` at main's current head — no cleanup RPC exists or is
 * needed." `atlas.run_duplicate_check` only prunes a stale row on its own
 * *next* run — a merge between checks would otherwise leave a candidate
 * referencing a retracted element visible until someone happens to press
 * "Check now" again. Joined here instead, on every read, via
 * `getElementsByIds` (the same rule-8 "no unbounded `.in()`" reference shape
 * `src/db/elements.ts`'s own module comment names) rather than a second,
 * narrower query — this doubles as the exact id→row lookup a caller needs
 * for display names anyway, so nothing here fetches `elements_head` twice.
 */
export async function listDuplicateCandidates(supabase: Client, modelId: UUID, commitId: UUID): Promise<DuplicateCandidatesResult> {
  const { data, error } = await supabase.from('duplicate_candidates').select('*').eq('model_id', modelId).order('score', { ascending: false });
  if (error) throw new Error(`listDuplicateCandidates: ${error.message}`);
  const rows = (data as DuplicateCandidateRow[] | null) ?? [];
  const ids = [...new Set(rows.flatMap((r) => [r.element_a_id, r.element_b_id]))];
  const elementsById = await getElementsByIds(supabase, commitId, ids);
  const candidates = rows.filter((r) => elementsById.has(r.element_a_id) && elementsById.has(r.element_b_id));
  return { candidates, elementsById };
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
