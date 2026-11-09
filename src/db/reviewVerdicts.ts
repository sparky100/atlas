/**
 * F3a: the review-verdict data layer. `review_verdicts` queries and thin
 * wrappers over the two new atlas.* lifecycle functions
 * (`set_review_verdict`, `set_reviewers`) — the submit side (writing the
 * initial pending set) lives in `src/db/mergeRequests.ts`'s
 * `submitMergeRequest`, since it rides the existing submit RPC.
 *
 * `ReviewerInput` is the shared shape a caller uses to name a reviewer and
 * whether their approval is required; the RPC wire shape (`user_id`/
 * `required`) is mapped here, not leaked into callers.
 */
import { sendReviewEmail } from './reviewEmail';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { MergeRequestRow, ReviewVerdict, ReviewVerdictRow } from './types';

/** One reviewer in a submit/set-reviews call — `required` means their approval gates the merge. */
export interface ReviewerInput {
  userId: UUID;
  required: boolean;
}

/** Maps a `ReviewerInput[]` to the `{user_id, required}` jsonb the RPCs expect. */
export function toReviewerWire(reviewers: readonly ReviewerInput[]): { user_id: UUID; required: boolean }[] {
  return reviewers.map((r) => ({ user_id: r.userId, required: r.required }));
}

export async function listReviewVerdictsForRequest(supabase: Client, mergeRequestId: UUID): Promise<ReviewVerdictRow[]> {
  const { data, error } = await supabase.from('review_verdicts').select('*').eq('merge_request_id', mergeRequestId).order('created_at');
  if (error) throw new Error(`listReviewVerdictsForRequest: ${error.message}`);
  return (data as ReviewVerdictRow[] | null) ?? [];
}

/** A reviewer casts (or changes) their own verdict — `atlas.set_review_verdict`. Returns the request, whose status the RPC may have advanced. */
export async function setReviewVerdict(supabase: Client, mergeRequestId: UUID, verdict: ReviewVerdict, comment?: string): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_review_verdict', { p_merge_request_id: mergeRequestId, p_verdict: verdict, p_comment: comment ?? null });
  if (error) throw new Error(`setReviewVerdict: ${error.message}`);
  return data as MergeRequestRow;
}

/** The proposer (or an owner/architect) replaces the reviewer set — `atlas.set_reviewers`. */
export async function setReviewers(supabase: Client, mergeRequestId: UUID, reviewers: readonly ReviewerInput[]): Promise<MergeRequestRow> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').rpc('set_reviewers', { p_merge_request_id: mergeRequestId, p_reviewers: toReviewerWire(reviewers) });
  if (error) throw new Error(`setReviewers: ${error.message}`);
  const row = data as MergeRequestRow;
  // Newly added reviewers just got their assignment — email them (best-effort, never throws; already-emailed ones are skipped).
  await sendReviewEmail(supabase, row.id);
  return row;
}
