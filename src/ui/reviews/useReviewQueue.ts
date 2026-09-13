import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import type { BranchRow, MergeRequestRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
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
        // F0's resolved review-weight decision: record/correct changes
        // never clutter this shared queue — they merge in one click from
        // the change page itself (`useApproveAndMerge.ts`), and still show
        // up in the Changes list per F0's own "groups by intent." The
        // underlying `merge_requests` row still exists either way (same
        // mechanism for every intent); this is a display filter only. A
        // branch that failed to resolve (`null`) is kept, not hidden —
        // failing to fetch it is not the same fact as "this is record/
        // correct," and hiding it here would silently drop a real open
        // request from the one place a reviewer can act on it.
        const rows = requests
          .map((request, i) => ({ request, branch: branches[i] ?? null }))
          .filter(({ branch }) => branch?.intent !== 'record' && branch?.intent !== 'correct');
        setState({ status: 'ready', rows });
      })
      .catch((e: unknown) => {
        reportError("Couldn't load the review queue.", e);
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
