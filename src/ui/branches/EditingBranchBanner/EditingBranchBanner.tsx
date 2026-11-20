import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { UUID } from '../../../contracts/delta';
import type { Ref } from '../../../db/ref';
import type { ViewMode } from '../../../db/viewMode';
import { getDecisionForOption } from '../../../db/decisions';
import { Button } from '../../components/Button/Button';
import { LinkButton } from '../../components/Button/LinkButton';
import { Text } from '../../components/Text/Text';
import { ReviewerPicker } from '../../changes/ReviewerPicker';
import { useSubmitForReview } from '../../changes/useSubmitForReview';
import { supabase } from '../../supabaseClient';
import { useEditingBranch } from '../useEditingBranch';
import { useSelectedRef } from '../useSelectedRef';
import styles from './EditingBranchBanner.module.css';

export interface EditingBranchBannerProps {
  activeRef: Ref;
  /** For "Submit for review"'s own commit-review computation and its post-submit navigation to the new request's page — every caller already has these three in scope for its own routing/data needs. */
  modelId: UUID;
  orgSlug: string;
  modelSlug: string;
  /**
   * Whether this page's own `?mode=` (As-is/To-be/Diff, `BranchViewModeControl`)
   * is actually consumed — Landscape/Context/Container/Component all are;
   * CapabilityMapPage, ElementPage and ModelHome are not (no diff
   * highlighting exists on any of them yet). Omitted entirely rather than
   * shown as a shortcut that visibly does nothing, same convention
   * `ElementHeader.tsx`'s own `onEdit`/`rename` props already use.
   * Defaults `true` since most callers do support it.
   */
  showModeShortcuts?: boolean;
  /**
   * `ChangePage.tsx` is the one caller that must opt out: it renders this
   * banner *and* `ChangeView.tsx`'s own, pre-existing "Submit for review"
   * button on the very same page — without this, a change's own page would
   * show the identical action twice (a real strict-mode duplicate this
   * item's own e2e regression sweep caught: `getByRole('button', { name:
   * 'Submit for review' })` resolving to two elements at once). Every other
   * caller has no button of its own to collide with, so this defaults
   * `true`, same convention as `showModeShortcuts` above.
   */
  showSubmitForReview?: boolean;
}

/**
 * Sprint 7i item 2 / S1 item 1 (docs/prompts/atlas-prompt-pack.md): "While
 * a change is selected, every page shows a persistent banner: 'Editing in
 * change: <name>' with To-be/Diff shortcuts and 'Back to the live model'" — S1 item
 * 1 adds the other half of leaving a change: "'Submit for review' (finish;
 * Proposed; ref -> main). Never one button for both." Until now, submitting
 * only existed on the change's own page (`ChangeView.tsx`); a reviewer or
 * proposer working from anywhere else (an element page, the landscape) had
 * no way to finish a change without first navigating back to it.
 *
 * "Leave" vs "finish," same distinction `ChangeView.tsx`'s own module
 * comment already draws for its copy of this action: "Back to the live model" leaves
 * a still-editable Draft in place (nothing changes about the branch
 * itself); "Submit for review" finishes it — the branch goes read-only for
 * the proposer the instant it's Proposed (`canEditBranch`'s own
 * `status === 'draft'` gate) — so, like `ChangeView.tsx`'s own submit
 * handler, this clears the session's active ref only when *this* branch
 * was the one actually selected, and always navigates to the new request's
 * review page on success. Only rendered while the branch is still `draft`
 * (`useEditingBranch`'s own resolution) — once it's Proposed or further,
 * either an open request already exists (nothing left to submit) or this
 * page's own reviewer never had a "submit" action to begin with.
 *
 * Self-contained — one line per route (`<EditingBranchBanner activeRef={ref} modelId={...} orgSlug={...} modelSlug={...} />`,
 * right inside `<main>`, before the breadcrumb) rather than a shared
 * `AppShell` wrapper: no such wrapper exists anywhere in this codebase yet
 * (every route independently renders `AppHeader`/`ModelNav` itself), and
 * introducing one is a structural refactor this feature doesn't need to
 * bundle with.
 *
 * Renders nothing outside a `branch:` ref — "a change is selected" per the
 * prompt's own wording, not "this page happens to support editing it"
 * (`CapabilityMapPage.tsx` can display a branch's own state today without
 * being able to edit into it at all; the banner's job is orientation, not
 * a promise that this exact page is writable).
 */
export function EditingBranchBanner({ activeRef, modelId, orgSlug, modelSlug, showModeShortcuts = true, showSubmitForReview = true }: EditingBranchBannerProps) {
  const [, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { ref, clearRef } = useSelectedRef();
  // `useEditingBranch` gives the full row (title, status), not just a
  // label — this banner needs `status` too, to know whether "Submit for
  // review" applies at all, and folds `useBranchLabel`'s own job into the
  // same fetch rather than a second one.
  const { branch } = useEditingBranch(activeRef.kind === 'branch' ? modelId : null, activeRef);
  const submission = useSubmitForReview(modelId, branch);
  const [pickingReviewers, setPickingReviewers] = useState(false);
  // F3a: propose/explore carry a reviewer set at submit; record/correct
  // stay on the single-approver path (no picker) — the exact same split
  // `ChangeView.tsx`'s own copy of this button already makes; this one
  // used to skip it entirely and always submit with no reviewers, which
  // made submitting a propose/explore change from anywhere but the
  // change's own page fail outright ("this change needs a reviewer set").
  const isMultiReviewerIntent = branch !== null && (branch.intent === 'propose' || branch.intent === 'explore');

  // An option is finished from its decision, not submitted on its own: offer the way back to the decision instead of Submit.
  const isOption = branch !== null && branch.intent === 'explore';
  const { data: optionDecision } = useQuery({
    queryKey: ['bannerOptionDecision', branch?.id ?? null],
    enabled: isOption,
    queryFn: () => (branch === null ? null : getDecisionForOption(supabase, branch.id)),
  });

  if (activeRef.kind !== 'branch') return null;
  const backToDecision = isOption && optionDecision ? optionDecision : null;

  const setMode = (mode: ViewMode) => {
    setSearchParams((prev) => {
      const updated = new URLSearchParams(prev);
      updated.set('mode', mode);
      return updated;
    });
  };

  // Bug fix: this used to only strip `?ref=`/`?mode=` from the URL directly
  // via this component's own `setSearchParams` — but `SelectedRefProvider`'s
  // own reconciliation (its module comment's "URL is silent" branch) treats
  // an absent `?ref=` as "nothing said otherwise, restore this session's
  // remembered choice for this model," and that choice was never touched,
  // so it immediately read the still-stored branch back out of
  // `sessionStorage` and wrote `?ref=branch:…` right back into the URL —
  // "Back to the live model" appeared to do nothing (or flash and revert). `clearRef()`
  // (`useSelectedRef`) is the one function that clears the *stored*
  // selection and the URL together (and, since it clears `mode` too —
  // `SelectedRefProvider.setRef`'s own comment — there is nothing left for
  // this component to strip itself); going through it, not `setSearchParams`
  // directly, is what makes this a real exit rather than a value the
  // provider's own effect immediately restores.
  const backToMain = () => {
    clearRef();
  };

  const afterSubmitted = (mergeRequestId: UUID) => {
    // Only clear the session's own selection if this branch was actually
    // it — a reviewer or bystander submitting from a change page they
    // weren't editing in has nothing of their own to reset.
    if (ref.kind === 'branch' && ref.branchId === activeRef.branchId) clearRef();
    void navigate(`/o/${orgSlug}/m/${modelSlug}/review/${mergeRequestId}`);
  };

  const submitForReview = () => {
    if (isMultiReviewerIntent) {
      setPickingReviewers(true);
      return;
    }
    void submission.submit().then((mergeRequestId) => {
      if (!mergeRequestId) return;
      afterSubmitted(mergeRequestId);
    });
  };

  return (
    <div className={styles.banner} role="status">
      <Text as="span" size="sm">
        Editing in change: {branch?.title ?? branch?.name ?? activeRef.branchId.slice(0, 8)}
      </Text>
      {showModeShortcuts && (
        <div className={styles.shortcuts}>
          <button type="button" className={styles.link} onClick={() => { setMode('toBe'); }}>
            To-be
          </button>
          <button type="button" className={styles.link} onClick={() => { setMode('diff'); }}>
            Diff
          </button>
        </div>
      )}
      {backToDecision !== null && (
        <LinkButton to={`/o/${orgSlug}/m/${modelSlug}/decisions/${backToDecision.id}`} variant="primary">
          Back to the decision
        </LinkButton>
      )}
      {showSubmitForReview && backToDecision === null && branch?.status === 'draft' && (
        <Button variant="primary" onClick={submitForReview} disabled={submission.status === 'submitting'}>
          {submission.status === 'submitting' ? 'Submitting…' : 'Submit for review'}
        </Button>
      )}
      <button type="button" className={[styles.link, styles.backToMain].join(' ')} onClick={backToMain}>
        Back to the live model
      </button>
      {showSubmitForReview && submission.error !== null && (
        <Text as="p" size="sm">
          {submission.error}
        </Text>
      )}
      {showSubmitForReview && pickingReviewers && branch !== null && (
        <ReviewerPicker
          orgId={branch.org_id}
          modelId={modelId}
          branch={branch}
          submitting={submission.status === 'submitting'}
          onCancel={() => {
            setPickingReviewers(false);
          }}
          onSubmit={(reviewers) => {
            void submission.submit(reviewers).then((mergeRequestId) => {
              if (!mergeRequestId) return;
              setPickingReviewers(false);
              afterSubmitted(mergeRequestId);
            });
          }}
        />
      )}
    </div>
  );
}
