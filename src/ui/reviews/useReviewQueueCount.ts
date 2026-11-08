import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { countCaptureDraftsAwaitingReview } from '../../db/captureJobs';
import { countReviewQueueMergeRequests } from '../../db/mergeRequests';
import { reportError } from '../errors/errorBannerStore';
import { useAfterFirstPaint } from '../perf/useAfterFirstPaint';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * F9 step 2 (UI-principles §2.0): how many items the review queue holds —
 * the same two things `ReviewQueueView` lists (open merge requests other
 * than record/correct changes, and capture drafts waiting), counted rather
 * than fetched. Read by the Changes nav item's badge and the Changes page's
 * "Review queue" tab, so both always show the same number.
 *
 * `staleTime: 0`, unlike the shared client's 30-second default: the count
 * moves whenever anyone submits, approves or merges, and every page mount
 * re-checks it. The cached value still paints immediately while the
 * re-check runs, so a page never waits on it. `null` until known — the
 * badge shows nothing rather than a guessed zero.
 */
export function useReviewQueueCount(modelId: UUID | null): number | null {
  const afterFirstPaint = useAfterFirstPaint();
  const { data } = useQuery({
    queryKey: queryKeys.reviewQueueCount(modelId),
    queryFn: async () => {
      if (!modelId) return 0;
      try {
        const [mergeRequests, captureDrafts] = await Promise.all([countReviewQueueMergeRequests(supabase, modelId), countCaptureDraftsAwaitingReview(supabase, modelId)]);
        return mergeRequests + captureDrafts;
      } catch (e) {
        reportError("Couldn't load the review queue count.", e);
        throw e;
      }
    },
    enabled: modelId !== null && afterFirstPaint,
    staleTime: 0,
  });
  return data ?? null;
}
