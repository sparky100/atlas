import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { approveMergeRequest, mergeApprovedRequest } from '../../db/mergeRequests';
import type { BranchRow, MergeRequestRow } from '../../db/types';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { supabase } from '../supabaseClient';

export type ApproveAndMergeStatus = 'idle' | 'working';

export interface UseApproveAndMergeResult {
  status: ApproveAndMergeStatus;
  error: string | null;
  /**
   * F0's resolved review-weight decision: `record`/`correct` branches get
   * this one-click action instead of the shared review queue's separate
   * Approve/Merge buttons — but it calls the exact same two RPCs
   * (`atlas.approve_merge_request` then `atlas.merge_branch`, via the same
   * `src/db/mergeRequests.ts` functions `ReviewRequestView.tsx`'s own
   * `approve`/`merge` call) in sequence, not a new fused RPC. `request`
   * must be `pending` or `approved` (mirroring `ReviewRequestView.tsx`'s
   * own `canApproveOrMerge` gates on those two statuses) — `pending` does
   * both steps, `approved` (a prior attempt's approve succeeded but its
   * merge didn't) does the merge alone rather than re-approving. Resolves
   * `true` only once the merge itself actually lands.
   */
  approveAndMerge: (request: MergeRequestRow, branch: BranchRow) => Promise<boolean>;
}

export function useApproveAndMerge(modelId: UUID): UseApproveAndMergeResult {
  const [status, setStatus] = useState<ApproveAndMergeStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const approveAndMerge = useCallback(
    async (request: MergeRequestRow, branch: BranchRow): Promise<boolean> => {
      setError(null);
      setStatus('working');
      try {
        let current = request;
        if (current.status === 'pending') {
          current = await approveMergeRequest(supabase, current.id);
        }
        if (current.status !== 'approved') {
          // The same server-side refusal `ReviewRequestView.tsx`'s disabled
          // "Approve" button pre-empts with its own `canApproveNow` check
          // (a blocking conflict, or main having moved on) — this surfaces
          // as `approveMergeRequest`'s own thrown error before ever
          // reaching here in the ordinary case, so this branch is really
          // only for an unexpected non-`approved` status this hook itself
          // didn't cause.
          setError('This request could not be approved.');
          return false;
        }
        const branchTitle = branch.title ?? branch.name;
        const result = await mergeApprovedRequest(supabase, modelId, current.id, branch, `Merge: ${branchTitle}`);
        if (!result.ok) {
          setError(result.message);
          return false;
        }
        // E8 item (1): a merge always moves main's own head.
        void invalidateModelHead(queryClient, modelId);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not approve and merge this change.');
        return false;
      } finally {
        setStatus('idle');
      }
    },
    [modelId, queryClient],
  );

  return { status, error, approveAndMerge };
}
