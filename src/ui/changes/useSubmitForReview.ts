import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { computeMergeReviewForBranch, getOpenMergeRequestForBranch, submitMergeRequest } from '../../db/mergeRequests';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type SubmitForReviewStatus = 'idle' | 'submitting';

export interface UseSubmitForReviewResult {
  status: SubmitForReviewStatus;
  error: string | null;
  /** Computes this branch's merge review and opens a request for it (SPEC §3.4's `draft -> proposed`, `atlas.submit_merge_request`). Resolves to the new request's id on success, so the caller can navigate to its review page. */
  submit: () => Promise<UUID | null>;
}

/**
 * The change page's "Submit for review" action (Sprint C1 step 7) —
 * computes the branch's own `MergeReview` (src/engine/merge.ts's
 * `computeMergeReview`) and opens a `merge_requests` row for it. `branch`
 * is `null` while the change page is still loading its own branch row —
 * this hook is still called unconditionally (React's rules of hooks), it
 * just refuses to submit until there's a real branch to submit.
 */
export function useSubmitForReview(modelId: UUID, branch: BranchRow | null): UseSubmitForReviewResult {
  const [status, setStatus] = useState<SubmitForReviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (): Promise<UUID | null> => {
    if (!branch) return null;
    setError(null);
    setStatus('submitting');
    try {
      // A stale open request (e.g. from a browser tab reload) is reused rather than colliding with `merge_requests_one_open_per_branch_idx`.
      const existing = await getOpenMergeRequestForBranch(supabase, branch.id);
      if (existing) {
        setStatus('idle');
        return existing.id;
      }
      const result = await computeMergeReviewForBranch(supabase, modelId, branch);
      if (!result) {
        setStatus('idle');
        setError('This change has no commits of its own yet — there is nothing to submit.');
        return null;
      }
      const request = await submitMergeRequest(supabase, crypto.randomUUID(), branch.id, result.review);
      setStatus('idle');
      return request.id;
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not submit this change for review.');
      return null;
    }
  }, [modelId, branch]);

  return { status, error, submit };
}
