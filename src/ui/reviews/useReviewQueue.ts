import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import type { BranchRow, MergeRequestRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export interface ReviewQueueRow {
  request: MergeRequestRow;
  branch: BranchRow | null;
}

export type ReviewQueueState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: ReviewQueueRow[] };

/** The review queue's list (UI-principles §2.4's `/review` route, SPEC §7.4) — every open merge request on this model, oldest first. */
export function useReviewQueue(modelId: UUID): ReviewQueueState & { reload: () => void } {
  const [state, setState] = useState<ReviewQueueState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listOpenMergeRequestsForModel(supabase, modelId)
      .then(async (requests) => {
        const branches = await Promise.all(requests.map((r) => getBranch(supabase, r.branch_id)));
        if (cancelled) return;
        setState({ status: 'ready', rows: requests.map((request, i) => ({ request, branch: branches[i] ?? null })) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the review queue.' });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  return { ...state, reload };
}
