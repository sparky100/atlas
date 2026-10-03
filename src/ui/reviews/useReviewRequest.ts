import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import { getSourcesByIds } from '../../db/elements';
import { getProfile, listProfilesByIds } from '../../db/profiles';
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
import type { BranchRow, MergeRequestRow, ProfileRow, ReviewVerdictRow, SourceRow } from '../../db/types';
import { listReviewVerdictsForRequest, setReviewVerdict, setReviewers, type ReviewerInput } from '../../db/reviewVerdicts';
import type { ReviewVerdict } from '../../db/types';
import type { MergeReview } from '../../engine/merge';
import type { FieldConflictChoice, StructuralChoice } from '../../engine/mergeResolution';
import { reportError } from '../errors/errorBannerStore';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/** `StructuralChoice`'s own key: a retraction choice is keyed by its element; a duplicate/cardinality pair choice by its own pair (order-independent — both sides of a pair should key to the same slot). */
function structuralChoiceKey(choice: StructuralChoice): string {
  return choice.class === 'retraction' ? `retraction ${choice.elementId}` : `${choice.class} ${[choice.relationshipId, choice.relatedRelationshipId].sort().join(' ')}`;
}

export interface ReviewRequestData {
  request: MergeRequestRow;
  branch: BranchRow;
  mainHeadCommitId: UUID;
  review: MergeReview;
  sourcesById: Map<UUID, SourceRow>;
  /** S1 item 3: "requester by display name" — `null` only if the profile row itself is somehow missing (never in practice past first membership, `getProfile`'s own comment); the view falls back to a short id fragment in that case rather than erroring. */
  requesterProfile: ProfileRow | null;
  /** F3a: every assigned reviewer's verdict row (empty for a single-approver record/correct request, which never writes them). */
  verdicts: ReviewVerdictRow[];
  /** F3a: each verdict's reviewer profile, keyed by `user_id` (also covers `request.requested_by` when they are themselves a reviewer). */
  reviewerProfiles: Map<UUID, ProfileRow>;
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
  const verdicts = await listReviewVerdictsForRequest(supabase, request.id);
  const reviewerProfiles = await listProfilesByIds(supabase, verdicts.map((v) => v.user_id));

  return {
    status: 'ready',
    request,
    branch,
    mainHeadCommitId: computed.mainHeadCommitId,
    review: computed.review,
    sourcesById,
    requesterProfile,
    verdicts,
    reviewerProfiles: new Map(reviewerProfiles.map((p) => [p.user_id, p])),
  };
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
  const [structuralChoices, setStructuralChoices] = useState<Map<string, StructuralChoice>>(new Map());
  // Optimistic-only additions not yet reflected in `state.request.dismissed_identity_pairs`
  // (the RPC call below is in flight, or its result hasn't triggered a
  // reload yet) — merged with the server-persisted list in
  // `isIdentityPairDismissed` below, never the sole source of truth (SPEC
  // §10.2 P-18: this must survive a reload, which local-only state never
  // did before Sprint C2 step 7).
  const [pendingDismissals, setPendingDismissals] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadReviewRequestData(modelId, mergeRequestId)
      .then((result) => {
        if (cancelled) return;
        setState(result);
        if (result.status === 'ready') {
          setFieldChoices(new Map());
          setStructuralChoices(new Map());
        }
      })
      .catch((e: unknown) => {
        reportError("Couldn't load this review request.", e);
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this review request.' });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, mergeRequestId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
    // F9 step 2: every action on this page (approve, reject, reopen, merge,
    // resubmit) ends here, and any of them can move the review queue's
    // count — the nav badge and the Changes tabs re-read it in place,
    // without waiting for the next page change.
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueueCount(modelId) });
    // Merge and reject end the change, so the open-changes badge moves too.
    void queryClient.invalidateQueries({ queryKey: queryKeys.openChangeCount(modelId) });
  }, [queryClient, modelId]);

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

  const setStructuralChoice = useCallback((choice: StructuralChoice) => {
    setStructuralChoices((prev) => {
      const next = new Map(prev);
      next.set(structuralChoiceKey(choice), choice);
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
        structuralChoices: [...structuralChoices.values()],
      });
      if (!commitResult.ok) {
        setActionError(commitResult.message);
        return;
      }
      // #245: pushRefresh computes its result via a real server-side
      // three-way merge, not a client-side fold, so there's no newHead to
      // seed applyCommitToCache with the way `merge` above does — but it
      // still moves this branch's own head, same as any other
      // commit-producing action, so every other cached read of it needs
      // invalidating too.
      void invalidateModelHead(queryClient, modelId);
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
  }, [state, modelId, userId, fieldChoices, structuralChoices, reload]);

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

  /** F3a: casts (or changes) the caller's own review verdict — `atlas.set_review_verdict`, which recomputes the gate transactionally. */
  const castVerdict = useCallback(
    async (verdict: ReviewVerdict, comment?: string) => {
      if (state.status !== 'ready') return;
      setActionError(null);
      setActionStatus('working');
      try {
        await setReviewVerdict(supabase, state.request.id, verdict, comment);
        reload();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not record your review.');
      } finally {
        setActionStatus('idle');
      }
    },
    [state, reload],
  );

  /** F3a: the proposer (or an owner/architect) replaces the reviewer set while pending — `atlas.set_reviewers`. */
  const updateReviewers = useCallback(
    async (reviewers: readonly ReviewerInput[]) => {
      if (state.status !== 'ready') return;
      setActionError(null);
      setActionStatus('working');
      try {
        await setReviewers(supabase, state.request.id, reviewers);
        reload();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not update reviewers.');
      } finally {
        setActionStatus('idle');
      }
    },
    [state, reload],
  );

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
      // E8 item (3): a successful merge always moves main's own head — seed the cache with the head it already computed.
      else applyCommitToCache(queryClient, modelId, { id: null, kind: 'main' }, result.commitId, result.newHead);
      reload();
      return result;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not merge this request.');
      return null;
    } finally {
      setActionStatus('idle');
    }
  }, [state, modelId, reload, queryClient]);

  const fieldChoiceFor = useMemo(() => (subjectId: UUID, attribute: string) => fieldChoices.get(fieldChoiceKey(subjectId, attribute)), [fieldChoices]);
  const retractionChoiceFor = useMemo(() => (elementId: UUID) => {
    const choice = structuralChoices.get(`retraction ${elementId}`);
    return choice?.class === 'retraction' ? choice : undefined;
  }, [structuralChoices]);
  const pairChoiceFor = useMemo(
    () => (relationshipId: UUID, relatedRelationshipId: UUID, findingClass: 'structural:duplicate-relationship' | 'structural:cardinality') => {
      const cls = findingClass === 'structural:duplicate-relationship' ? 'duplicate-relationship' : 'cardinality';
      const choice = structuralChoices.get(`${cls} ${[relationshipId, relatedRelationshipId].sort().join(' ')}`);
      return choice?.class === cls ? choice : undefined;
    },
    [structuralChoices],
  );

  return {
    state,
    reload,
    actionStatus,
    actionError,
    fieldChoiceFor,
    setFieldChoice,
    clearFieldChoice,
    retractionChoiceFor,
    pairChoiceFor,
    setStructuralChoice,
    stagedChoiceCount: fieldChoices.size + structuralChoices.size,
    isIdentityPairDismissed,
    dismissIdentityPair,
    reopenForEdits,
    pushRefreshAndResubmit,
    approve,
    castVerdict,
    updateReviewers,
    reject,
    merge,
  };
}
