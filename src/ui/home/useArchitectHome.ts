import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { CommitRow } from '../../contracts/rows';
import { getMainBranch, listChangeBranches } from '../../db/branches';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import { listRecentCommits } from '../../db/modelHome';
import type { BranchRow, MergeRequestRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export interface ArchitectHomeData {
  recentCommits: CommitRow[];
  reviewQueueCount: number;
  oldestReviewItem: MergeRequestRow | null;
  myOpenBranches: BranchRow[];
  /** ADR-019 rule 3: named for Q1, not built — the standing duplicates report this door will eventually surface a count from. Always 0 until then, shown plainly rather than hidden (CLAUDE.md rule 7). */
  duplicatesCount: 0;
}

export type ArchitectHomeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ArchitectHomeData };

// "Still open" for the architect's own branch list: anything short of a
// terminal state (merged/rejected/archived) — draft work included, unlike
// the director's "changes in flight" (useDirectorHome.ts's own
// IN_FLIGHT_STATUSES), since this list exists to answer "what do I still
// have to do", not "what would a director recognise as underway".
const MY_OPEN_STATUSES: BranchRow['status'][] = ['draft', 'proposed', 'in_review', 'approved'];

/**
 * The architect door's data (Sprint U3b, scoped down from UI-principles
 * §3.2 — see src/db/modelHome.ts's own module comment for what's
 * deferred: no validation-status-per-item, no "behind main by N commits",
 * no mentions-float-to-top, no capability map below the fold).
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
        if (!cancelled) setState({ status: 'error', message: 'This model has no main branch.' });
        return;
      }

      const [recentCommits, reviewQueue, changeBranches] = await Promise.all([
        listRecentCommits(supabase, main.id, 10),
        listOpenMergeRequestsForModel(supabase, modelId),
        listChangeBranches(supabase, modelId),
      ]);

      const myOpenBranches = changeBranches.filter((b) => b.created_by === userId && MY_OPEN_STATUSES.includes(b.status));

      if (!cancelled) {
        setState({
          status: 'ready',
          data: {
            recentCommits,
            reviewQueueCount: reviewQueue.length,
            oldestReviewItem: reviewQueue[0] ?? null,
            myOpenBranches,
            duplicatesCount: 0,
          },
        });
      }
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the architect view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, userId]);

  return state;
}
