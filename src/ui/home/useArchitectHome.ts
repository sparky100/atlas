import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch, listChangeBranches } from '../../db/branches';
import { listDecisionOptionLinksForModel, listDecisionsForModel, type DecisionOptionLink } from '../../db/decisions';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import { getReviewPeriodDays } from '../../db/organisations';
import { isReviewOverdue } from '../../contracts/thresholds';
import { listProjectsForModel } from '../../db/projects';
import type { BranchRow, DecisionRow, MergeRequestRow, ProjectRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { buildMyOwnedWork, type MyOwnedWork } from './whatWeAreDoing';

export interface ArchitectHomeData {
  reviewQueueCount: number;
  oldestReviewItem: MergeRequestRow | null;
  /** Open reviews still waiting on reviewers past the organisation's review period, oldest first. */
  overdueReviews: MergeRequestRow[];
  /** The review period used for `overdueReviews`, in days; `null` when the queue is empty (not read). */
  reviewPeriodDays: number | null;
  myOpenBranches: BranchRow[];
  /** Every open change in the model, to list what sits inside each project. */
  allOpenBranches: BranchRow[];
  /** The option links of the model's decisions — tells a decision's option from a change on its own (`buildMyWorkRows`). */
  optionLinks: DecisionOptionLink[];
  /** The model's decisions and projects, for naming what a change sits under. */
  allDecisions: DecisionRow[];
  allProjects: ProjectRow[];
  /** The open decisions and in-hand projects this user owns (UI-principles §3, 2026-10-04) — `buildMyOwnedWork`. */
  myOwnedWork: MyOwnedWork;
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
 * own open branches, decisions and projects — five small queries, not the model's entire
 * capability/system/relationship graph.
 */
export function useArchitectHome(modelId: UUID, userId: UUID | null): ArchitectHomeState {
  const [state, setState] = useState<ArchitectHomeState>({ status: 'loading' });

  useEffect(() => {
    if (!modelId || !userId) return undefined;
    const viewerId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        if (!cancelled) setState({ status: 'error', message: 'This model has nothing in it yet.' });
        return;
      }

      const [reviewQueue, changeBranches, decisions, projects, optionLinks] = await Promise.all([
        listOpenMergeRequestsForModel(supabase, modelId),
        listChangeBranches(supabase, modelId),
        listDecisionsForModel(supabase, modelId),
        listProjectsForModel(supabase, modelId),
        listDecisionOptionLinksForModel(supabase, modelId),
      ]);
      const allOpenBranches = changeBranches.filter((b) => MY_OPEN_STATUSES.includes(b.status));
      const myOpenBranches = changeBranches.filter((b) => b.created_by === viewerId && MY_OPEN_STATUSES.includes(b.status));
      const myOwnedWork = buildMyOwnedWork(projects, decisions, changeBranches, viewerId, new Date().toISOString().slice(0, 10));

      // Only read the period when something is waiting — an empty queue has nothing to be overdue.
      const first = reviewQueue[0];
      const reviewPeriodDays = first ? await getReviewPeriodDays(supabase, first.org_id) : null;
      const overdueReviews = reviewPeriodDays === null ? [] : reviewQueue.filter((r) => isReviewOverdue(r, reviewPeriodDays));

      if (!cancelled) {
        setState({
          status: 'ready',
          data: { reviewQueueCount: reviewQueue.length, oldestReviewItem: reviewQueue[0] ?? null, overdueReviews, reviewPeriodDays, myOpenBranches, allOpenBranches, optionLinks, allDecisions: decisions, allProjects: projects, myOwnedWork },
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
