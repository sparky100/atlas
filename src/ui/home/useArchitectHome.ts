import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch, listChangeBranches } from '../../db/branches';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import type { BranchRow, MergeRequestRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface ArchitectHomeData {
  reviewQueueCount: number;
  oldestReviewItem: MergeRequestRow | null;
  myOpenBranches: BranchRow[];
}

export type ArchitectHomeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ArchitectHomeData };

// "Still open" for the architect's own branch list: anything short of a
// terminal state (merged/rejected/archived) — draft work included, unlike
// the director's "changes in flight" (useDirectorHome.ts's own
// IN_FLIGHT_STATUSES), since this list exists to answer "what do I still
// have to do", not "what would a director recognise as underway".
const MY_OPEN_STATUSES: BranchRow['status'][] = ['draft', 'proposed', 'in_review', 'approved'];

/**
 * The architect door's *critical* data (UI-principles §3.2, built to
 * Handoff 7d's architect-door amendment — `docs/HANDOFF-7d-architect-door.md`):
 * just enough for the door's Review queue and My changes panels to paint.
 *
 * E8 item (4) split this out of what used to be one big hook: Health
 * findings and Recent activity (`useArchitectHomeInsights.ts`) are neither
 * of those two panels, and their own fetch used to sit in the same
 * `Promise.all`/`status` state machine as this — so the whole door,
 * including panels that have nothing to do with either, waited on a dozen
 * queries and a batch of finding computations before painting anything at
 * all. This hook is now just main's id, the review queue, and this user's
 * own open branches — three small queries, not the model's entire
 * capability/system/relationship graph.
 */
export function useArchitectHome(modelId: UUID, userId: UUID | null): ArchitectHomeState {
  const [state, setState] = useState<ArchitectHomeState>({ status: 'loading' });

  useEffect(() => {
    if (!modelId || !userId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        if (!cancelled) setState({ status: 'error', message: 'This model has no main yet.' });
        return;
      }

      const [reviewQueue, changeBranches] = await Promise.all([listOpenMergeRequestsForModel(supabase, modelId), listChangeBranches(supabase, modelId)]);
      const myOpenBranches = changeBranches.filter((b) => b.created_by === userId && MY_OPEN_STATUSES.includes(b.status));

      if (!cancelled) {
        setState({
          status: 'ready',
          data: { reviewQueueCount: reviewQueue.length, oldestReviewItem: reviewQueue[0] ?? null, myOpenBranches },
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the architect view.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the architect view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, userId]);

  return state;
}
