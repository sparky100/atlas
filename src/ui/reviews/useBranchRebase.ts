import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch } from '../../db/branches';
import { computeMergeReviewForBranch, pushRefresh } from '../../db/mergeRequests';
import type { BranchRow } from '../../db/types';
import type { MergeReview } from '../../engine/merge';
import type { FieldConflictChoice } from '../../engine/mergeResolution';
import { supabase } from '../supabaseClient';

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
  const [state, setState] = useState<BranchRebaseState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [actionStatus, setActionStatus] = useState<ActionStatus>('idle');
  const [actionError, setActionError] = useState<string | null>(null);
  const [fieldChoices, setFieldChoices] = useState<Map<string, FieldConflictChoice>>(new Map());

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
      })
      .catch((e: unknown) => {
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
      });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      const refreshed = await getBranch(supabase, branch.id);
      if (!refreshed) {
        setActionError('The branch disappeared while rebasing.');
        return;
      }
      onRebased();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not rebase this change.');
    } finally {
      setActionStatus('idle');
    }
  }, [state, modelId, branch, userId, fieldChoices, onRebased]);

  const fieldChoiceFor = useMemo(() => (subjectId: UUID, attribute: string) => fieldChoices.get(fieldChoiceKey(subjectId, attribute)), [fieldChoices]);

  return { state, reload, actionStatus, actionError, fieldChoiceFor, setFieldChoice, clearFieldChoice, stagedChoiceCount: fieldChoices.size, pushRebase };
}
