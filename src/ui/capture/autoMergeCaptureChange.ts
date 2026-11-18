import type { QueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import type { Client } from '../../db/client';
import { approveMergeRequest, computeMergeReviewForBranch, getOpenMergeRequestForBranch, mergeApprovedRequest, submitMergeRequest } from '../../db/mergeRequests';
import type { MemberRole } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';

export type AutoMergeResult = { merged: true } | { merged: false; reason: string };

/**
 * Real capture review: a reviewer who is already `owner`/`architect` — the
 * same authority that "Submit for review" → "Approve & merge" on the
 * change page already lets them exercise single-handed for a `record`/
 * `correct` change (`changeStepper.ts`'s own "a single owner or architect
 * approves and merges it directly, no shared review queue") — had to leave
 * the capture review screen, find the change page, and click through that
 * exact sequence themselves right after having just individually decided
 * every candidate. Deciding each candidate isn't itself an approval (it
 * only builds the commit), but for this specific reviewer the follow-up
 * approval is never anything other than them re-confirming their own
 * decision a second time — so `apply()` (`useCaptureReviewQueue.ts`) calls
 * this immediately after a successful `applyCaptureDecisions`, running the
 * same `submit → approve → merge` sequence `useSubmitForReview.ts`/
 * `useApproveAndMerge.ts` already use, so the reviewer never has to leave
 * this screen at all.
 *
 * Never attempted for `propose`/`explore` — those need a real, separate
 * reviewer set (F3a) regardless of who's asking, the actual governance
 * boundary this shortcut must never cross. A `contributor` review (also
 * allowed by `canRunCapture`) is left entirely alone: the change page's
 * ordinary one-click "Approve & merge" is the real check there, by
 * someone with more authority than the reviewer had.
 *
 * Best-effort past the eligibility gate: the promotion commit this is
 * called after has already landed on the target branch regardless of
 * whether this succeeds — a failure here (a blocking conflict, main
 * having moved on since the branch forked) never undoes it, it just
 * leaves the branch in its ordinary draft-with-commits state for the
 * reviewer to submit by hand, same as before this existed.
 *
 * A successful merge moves main's head, so — exactly as `useApproveAndMerge.ts`
 * does after the same `mergeApprovedRequest` — the new head is seeded into the
 * query cache; without it the Elements list and every other main view keep
 * showing the pre-import head until a full reload.
 */
export async function autoMergeCaptureChange(supabase: Client, queryClient: QueryClient, modelId: UUID, role: MemberRole | null, targetBranchId: UUID): Promise<AutoMergeResult> {
  if (role !== 'owner' && role !== 'architect') return { merged: false, reason: 'not_eligible_role' };

  const branch = await getBranch(supabase, targetBranchId);
  if (!branch) return { merged: false, reason: 'branch_not_found' };
  if (branch.intent !== 'record' && branch.intent !== 'correct') return { merged: false, reason: 'not_eligible_intent' };

  try {
    let request = await getOpenMergeRequestForBranch(supabase, targetBranchId);
    if (!request) {
      const reviewResult = await computeMergeReviewForBranch(supabase, modelId, branch);
      if (!reviewResult) return { merged: false, reason: 'no_main_commit' };
      request = await submitMergeRequest(supabase, crypto.randomUUID(), targetBranchId, reviewResult.review, null);
    }
    if (request.status === 'pending') request = await approveMergeRequest(supabase, request.id);
    if (request.status !== 'approved') return { merged: false, reason: `request_status_${request.status}` };

    const result = await mergeApprovedRequest(supabase, modelId, request.id, branch, `Merge: ${branch.title ?? branch.name}`);
    if (!result.ok) return { merged: false, reason: result.message };
    applyCommitToCache(queryClient, modelId, { id: null, kind: 'main' }, result.commitId, result.newHead);
    return { merged: true };
  } catch (e) {
    return { merged: false, reason: e instanceof Error ? e.message : 'Could not automatically merge this change.' };
  }
}
