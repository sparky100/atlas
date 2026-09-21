import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { dismissIdentityPairOnBranch, getBranch } from '../../db/branches';
import { computeMergeReviewForBranch, pushRefresh } from '../../db/mergeRequests';
import type { BranchRow } from '../../db/types';
import type { MergeReview } from '../../engine/merge';
import type { FieldConflictChoice, StructuralChoice } from '../../engine/mergeResolution';
import { reportError } from '../errors/errorBannerStore';
import { invalidateModelHead } from '../query/invalidateModelHead';
import { supabase } from '../supabaseClient';

/** `StructuralChoice`'s own key: a retraction choice is keyed by its element; a duplicate/cardinality pair choice by its own pair (order-independent — both sides of a pair should key to the same slot). */
function structuralChoiceKey(choice: StructuralChoice): string {
  return choice.class === 'retraction' ? `retraction ${choice.elementId}` : `${choice.class} ${[choice.relationshipId, choice.relatedRelationshipId].sort().join(' ')}`;
}

export interface BranchRebaseData {
  review: MergeReview;
  mainHeadCommitId: UUID;
}

export type BranchRebaseState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & BranchRebaseData);

export type ActionStatus = 'idle' | 'working';

function fieldChoiceKey(subjectId: UUID, attribute: string): string {
  return `${subjectId} ${attribute}`;
}

/**
 * A draft branch's own "rebase on main" (Sprint C1 step 8, the user's
 * brief: "Rebase branch on new main head with conflict surfacing") —
 * everything src/ui/reviews/useReviewRequest.ts's refresh half does, minus
 * the merge_requests bookkeeping: no request exists yet (or, once one
 * does, the review request's own page — not this panel — is the place to
 * refresh from, since it also needs to resubmit the cached classification).
 * See src/ui/changes/ChangeView.tsx's own comment on that division.
 */
export function useBranchRebase(modelId: UUID, branch: BranchRow, userId: UUID | null, onRebased: () => void) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<BranchRebaseState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [actionStatus, setActionStatus] = useState<ActionStatus>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [fieldChoices, setFieldChoices] = useState<Map<string, FieldConflictChoice>>(new Map());
  const [structuralChoices, setStructuralChoices] = useState<Map<string, StructuralChoice>>(new Map());
  // Optimistic-only additions not yet reflected in the `branch` prop's own
  // `dismissed_identity_pairs` (the RPC call is in flight, or the parent
  // hasn't re-fetched the branch since) — same shape as
  // useReviewRequest.ts's own `pendingDismissals`, merged with the
  // server-persisted list in `isIdentityPairDismissed` below, never the
  // sole source of truth.
  const [pendingDismissals, setPendingDismissals] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    computeMergeReviewForBranch(supabase, modelId, branch)
      .then((computed) => {
        if (cancelled) return;
        if (!computed) {
          setState({ status: 'error', message: 'This change has no commits of its own yet — there is nothing to rebase.' });
          return;
        }
        setState({ status: 'ready', review: computed.review, mainHeadCommitId: computed.mainHeadCommitId });
        setFieldChoices(new Map());
        setStructuralChoices(new Map());
      })
      .catch((e: unknown) => {
        reportError("Couldn't compute this rebase.", e);
        if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to compute this rebase.' });
      });
    return () => {
      cancelled = true;
    };
  }, [modelId, branch, reloadToken]);

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

  const setStructuralChoice = useCallback((choice: StructuralChoice) => {
    setStructuralChoices((prev) => {
      const next = new Map(prev);
      next.set(structuralChoiceKey(choice), choice);
      return next;
    });
  }, []);

  const pushRebase = useCallback(async () => {
    if (state.status !== 'ready') return;
    if (!userId) {
      setActionError('You must be signed in to rebase this change.');
      return;
    }
    setActionError(null);
    setActionStatus('working');
    try {
      const result = await pushRefresh(supabase, {
        modelId,
        orgId: branch.org_id,
        userId,
        branch,
        mainHeadCommitId: state.mainHeadCommitId,
        review: state.review,
        choices: [...fieldChoices.values()],
        structuralChoices: [...structuralChoices.values()],
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      // #245: same gap as useReviewRequest.ts's own pushRefreshAndResubmit —
      // pushRefresh moves this branch's own head via a real server-side
      // three-way merge (no newHead to seed applyCommitToCache with), but
      // every other cached read of this branch still needs invalidating.
      void invalidateModelHead(queryClient, modelId);
      const refreshed = await getBranch(supabase, branch.id);
      if (!refreshed) {
        setActionError('The change disappeared while rebasing.');
        return;
      }
      onRebased();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not rebase this change.');
    } finally {
      setActionStatus('idle');
    }
  }, [state, modelId, branch, userId, fieldChoices, structuralChoices, onRebased, queryClient]);

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

  const dismissIdentityPair = useCallback(
    (oid: UUID, tid: UUID) => {
      const pairKey = [oid, tid].sort().join(' ');
      setPendingDismissals((prev) => new Set(prev).add(pairKey));
      void dismissIdentityPairOnBranch(supabase, branch.id, pairKey).catch((e: unknown) => {
        setActionError(e instanceof Error ? e.message : 'Could not dismiss this identity warning.');
      });
    },
    [branch.id],
  );

  const isIdentityPairDismissed = useCallback(
    (oid: UUID, tid: UUID) => {
      const pairKey = [oid, tid].sort().join(' ');
      if (branch.dismissed_identity_pairs.includes(pairKey)) return true;
      return pendingDismissals.has(pairKey);
    },
    [branch.dismissed_identity_pairs, pendingDismissals],
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
    pushRebase,
    dismissIdentityPair,
    isIdentityPairDismissed,
  };
}
