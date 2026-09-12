import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import { getSourcesByIds } from '../../db/elements';
import { getProfile } from '../../db/profiles';
import {
  approveMergeRequest,
  computeMergeReviewForBranch,
  dismissIdentityPair as dismissIdentityPairRpc,
  getMergeRequestById,
  mergeApprovedRequest,
  pushRefresh,
  rejectMergeRequest,
  requestChanges,
  resubmitMergeRequest,
  type MergeApprovedResult,
} from '../../db/mergeRequests';
import type { BranchRow, MergeRequestRow, ProfileRow, SourceRow } from '../../db/types';
import type { MergeReview } from '../../engine/merge';
import type { FieldConflictChoice } from '../../engine/mergeResolution';
import { supabase } from '../supabaseClient';

export interface ReviewRequestData {
  request: MergeRequestRow;
  branch: BranchRow;
  mainHeadCommitId: UUID;
  review: MergeReview;
  sourcesById: Map<UUID, SourceRow>;
  /** S1 item 3: "requester by display name" — `null` only if the profile row itself is somehow missing (never in practice past first membership, `getProfile`'s own comment); the view falls back to a short id fragment in that case rather than erroring. */
  requesterProfile: ProfileRow | null;
}

export type ReviewRequestState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & ReviewRequestData);

export type ActionStatus = 'idle' | 'working';

function fieldChoiceKey(subjectId: UUID, attribute: string): string {
  return `${subjectId} ${attribute}`;
}

async function loadReviewRequestData(modelId: UUID, mergeRequestId: UUID): Promise<ReviewRequestState> {
  const request = await getMergeRequestById(supabase, mergeRequestId);
  if (!request) return { status: 'error', message: 'This review request no longer exists.' };

  const branch = await getBranch(supabase, request.branch_id);
  if (!branch) return { status: 'error', message: 'The change this request is for no longer exists.' };

  const computed = await computeMergeReviewForBranch(supabase, modelId, branch);
  if (!computed) return { status: 'error', message: 'This change has no commits of its own — there is nothing to review.' };

  const sourceIds = new Set<UUID>();
  for (const f of computed.review.threeWay.fields) {
    if (f.base) sourceIds.add(f.base.sourceId);
    if (f.ours) sourceIds.add(f.ours.sourceId);
    if (f.theirs) sourceIds.add(f.theirs.sourceId);
  }
  const sourcesById = await getSourcesByIds(supabase, [...sourceIds]);
  const requesterProfile = await getProfile(supabase, request.requested_by);

  return { status: 'ready', request, branch, mainHeadCommitId: computed.mainHeadCommitId, review: computed.review, sourcesById, requesterProfile };
}

/**
 * A review request's own page (Sprint C1 step 7, SPEC §7.4). Always
 * recomputes the classification live from commits (this hook's own
 * `review` field) rather than trusting `request.classification` — that
 * cache is what the queue *list* shows and what a submit/resubmit call
 * writes, but the page a reviewer is actually looking at has to reflect
 * the current branch and main head, not a snapshot that might already be
 * stale (SPEC §7.4's summary row: "a red 'refresh required' state when
 * mergeBase(B) != main.head").
 */
export function useReviewRequest(modelId: UUID, mergeRequestId: UUID, userId: UUID | null) {
  const [state, setState] = useState<ReviewRequestState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [actionStatus, setActionStatus] = useState<ActionStatus>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [fieldChoices, setFieldChoices] = useState<Map<string, FieldConflictChoice>>(new Map());
  // Optimistic-only additions not yet reflected in `state.request.dismissed_identity_pairs`
  // (the RPC call below is in flight, or its result hasn't triggered a
  // reload yet) — merged with the server-persisted list in
  // `isIdentityPairDismissed` below, never the sole source of truth (SPEC
  // §10.2 P-18: this must survive a reload, which local-only state never
  // did before Sprint C2 step 7).
  const [pendingDismissals, setPendingDismissals] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadReviewRequestData(modelId, mergeRequestId)
      .then((result) => {
        if (cancelled) return;
        setState(result);
        if (result.status === 'ready') setFieldChoices(new Map());
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this review request.' });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, mergeRequestId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const setFieldChoice = useCallback((choice: FieldConflictChoice) => {
    setFieldChoices((prev) => {
      const next = new Map(prev);
      next.set(fieldChoiceKey(choice.subjectId, choice.attribute), choice);
      return next;
    });
  }, []);

  const clearFieldChoice = useCallback((subjectId: UUID, attribute: string) => {
    setFieldChoices((prev) => {
      const next = new Map(prev);
      next.delete(fieldChoiceKey(subjectId, attribute));
      return next;
    });
  }, []);

  const dismissIdentityPair = useCallback(
    (oid: UUID, tid: UUID) => {
      if (state.status !== 'ready') return;
      const pairKey = [oid, tid].sort().join(' ');
      setPendingDismissals((prev) => new Set(prev).add(pairKey));
      void dismissIdentityPairRpc(supabase, state.request.id, pairKey)
        .then(() => {
          reload();
        })
        .catch((e: unknown) => {
          setActionError(e instanceof Error ? e.message : 'Could not dismiss this identity warning.');
        });
    },
    [state, reload],
  );

  const isIdentityPairDismissed = useCallback(
    (oid: UUID, tid: UUID) => {
      const pairKey = [oid, tid].sort().join(' ');
      if (state.status === 'ready' && state.request.dismissed_identity_pairs.includes(pairKey)) return true;
      return pendingDismissals.has(pairKey);
    },
    [state, pendingDismissals],
  );

  const reopenForEdits = useCallback(
    async (reviewNotes?: string) => {
      if (state.status !== 'ready') return;
      setActionError(null);
      setActionStatus('working');
      try {
        await requestChanges(supabase, state.request.id, reviewNotes);
        reload();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not reopen this request for edits.');
      } finally {
        setActionStatus('idle');
      }
    },
    [state, reload],
  );

  /** Pushes a refresh commit carrying every staged field-conflict choice (empty is a valid refresh — pulling in main with nothing to resolve), then recomputes and resubmits so the queue's cached classification stays current. Requires the branch to already be `draft` (reopen first if it isn't). */
  const pushRefreshAndResubmit = useCallback(async () => {
    if (state.status !== 'ready') return;
    if (!userId) {
      setActionError('You must be signed in to push a refresh.');
      return;
    }
    const { branch, mainHeadCommitId, review, request } = state;
    setActionError(null);
    setActionStatus('working');
    try {
      const commitResult = await pushRefresh(supabase, {
        modelId,
        orgId: branch.org_id,
        // The acting reviewer, not necessarily `request.requested_by` — a
        // `sources` row's `created_by` must be `auth.uid()` (sources_insert's
        // RLS), so this has to be whoever is actually pushing this refresh.
        userId,
        branch,
        mainHeadCommitId,
        review,
        choices: [...fieldChoices.values()],
      });
      if (!commitResult.ok) {
        setActionError(commitResult.message);
        return;
      }
      const refreshedBranch = await getBranch(supabase, branch.id);
      if (!refreshedBranch) {
        setActionError('The change disappeared while refreshing.');
        return;
      }
      const recomputed = await computeMergeReviewForBranch(supabase, modelId, refreshedBranch);
      if (!recomputed) {
        setActionError('Could not recompute the review after refreshing.');
        return;
      }
      await resubmitMergeRequest(supabase, request.id, recomputed.review);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not push this refresh.');
    } finally {
      setActionStatus('idle');
    }
  }, [state, modelId, userId, fieldChoices, reload]);

  const approve = useCallback(async () => {
    if (state.status !== 'ready') return;
    setActionError(null);
    setActionStatus('working');
    try {
      await approveMergeRequest(supabase, state.request.id);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not approve this request.');
    } finally {
      setActionStatus('idle');
    }
  }, [state, reload]);

  const reject = useCallback(
    async (reviewNotes?: string) => {
      if (state.status !== 'ready') return;
      setActionError(null);
      setActionStatus('working');
      try {
        await rejectMergeRequest(supabase, state.request.id, reviewNotes);
        reload();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not reject this request.');
      } finally {
        setActionStatus('idle');
      }
    },
    [state, reload],
  );

  const merge = useCallback(async (): Promise<MergeApprovedResult | null> => {
    if (state.status !== 'ready') return null;
    setActionError(null);
    setActionStatus('working');
    try {
      const branchTitle = state.branch.title ?? state.branch.name;
      const result = await mergeApprovedRequest(supabase, modelId, state.request.id, state.branch, `Merge: ${branchTitle}`);
      if (!result.ok) setActionError(result.message);
      reload();
      return result;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not merge this request.');
      return null;
    } finally {
      setActionStatus('idle');
    }
  }, [state, modelId, reload]);

  const fieldChoiceFor = useMemo(() => (subjectId: UUID, attribute: string) => fieldChoices.get(fieldChoiceKey(subjectId, attribute)), [fieldChoices]);

  return {
    state,
    reload,
    actionStatus,
    actionError,
    fieldChoiceFor,
    setFieldChoice,
    clearFieldChoice,
    stagedChoiceCount: fieldChoices.size,
    isIdentityPairDismissed,
    dismissIdentityPair,
    reopenForEdits,
    pushRefreshAndResubmit,
    approve,
    reject,
    merge,
  };
}
