import type { BranchRow, MergeRequestRow } from '../../db/types';

/**
 * Sprint 7i item 1: "Change page status stepper: Draft → Proposed → In
 * review → Approved → Merged (Rejected as a side exit); current step
 * highlighted; one sentence under it on what happens next and who does it."
 *
 * The five labels map onto two tables' worth of real state
 * (`branches.status` and `merge_requests.status`), not a state machine of
 * their own — verified directly against
 * `supabase/migrations/20260906161000_merge_review_queue.sql`:
 * `submit_merge_request` sets `branches.status='proposed'` and creates the
 * `merge_requests` row (`status='pending'`) atomically in the same
 * transaction, so there is no observable gap between "Proposed" and "In
 * review" in the data — `'in_review'` is never itself written to
 * `branches.status` anywhere in this codebase. `request_changes` sets
 * `merge_requests.status='changes_requested'` **and** `branches.status`
 * back to `'draft'`, also atomically (same file, `atlas.request_changes`).
 *
 * So "Proposed" is real only as a *passed* waypoint (the instant any merge
 * request has ever existed for this attempt), never as the current step —
 * showing it as current would fabricate a state the data never actually
 * sits in. "In review" is current exactly when `merge_requests.status ===
 * 'pending'`; "Approved" exactly when `'approved'`. A request sent back for
 * changes resets the whole stepper to Draft-current rather than showing a
 * confusing "passed, then un-passed" Proposed step — the honest state is
 * "back to the start of this attempt", not "still partway there".
 */
export type ChangeStepKey = 'draft' | 'proposed' | 'in_review' | 'approved' | 'merged';

export const CHANGE_STEPS: readonly { key: ChangeStepKey; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'proposed', label: 'Proposed' },
  { key: 'in_review', label: 'In review' },
  { key: 'approved', label: 'Approved' },
  { key: 'merged', label: 'Merged' },
];

export type ChangeStepState = 'passed' | 'current' | 'upcoming';

export interface DerivedChangeSteps {
  /** One entry per `CHANGE_STEPS` key, in order — `Stepper.tsx` renders these directly. */
  steps: { key: ChangeStepKey; label: string; state: ChangeStepState }[];
  /** Rejected is a side exit (the prompt's own wording), not a position on the five-step line. */
  rejected: boolean;
  /** S1 item 4: cancelled is the other side exit — a proposer's or owner/architect's own deliberate stop, distinct from a reviewer's rejection. */
  cancelled: boolean;
  /** "one sentence under it on what happens next and who does it." */
  sentence: string;
}

function stepsWithStatesUpTo(currentIndex: number | null): { key: ChangeStepKey; label: string; state: ChangeStepState }[] {
  return CHANGE_STEPS.map((step, i) => ({
    ...step,
    state: currentIndex === null ? 'upcoming' : i < currentIndex ? 'passed' : i === currentIndex ? 'current' : 'upcoming',
  }));
}

/**
 * `branch` only needs `status`; `mergeRequest` is the branch's own open
 * request (`useOpenMergeRequest`'s result — `pending`/`changes_requested`/
 * `approved`, per that hook's `OPEN_STATUSES`) or `null` once none is open.
 * Pass `null`, not `undefined`, while a request is still loading — the
 * caller should hold off rendering the stepper until it has resolved, the
 * same convention `ChangeView.tsx` already applies to `openRequest`.
 */
export function deriveChangeStep(branch: Pick<BranchRow, 'status'>, mergeRequest: MergeRequestRow | null): DerivedChangeSteps {
  switch (branch.status) {
    case 'draft': {
      const sentBack = mergeRequest?.status === 'changes_requested';
      return {
        steps: stepsWithStatesUpTo(0),
        rejected: false,
        cancelled: false,
        sentence: sentBack ? 'Sent back for changes by a reviewer. Edit and resubmit when ready.' : 'Not yet submitted. The change owner submits it for review when ready.',
      };
    }
    // 'in_review' is never actually written to `branches.status` (see this
    // module's own comment) — handled the same as 'proposed' so this switch
    // stays total over the type without ever being reachable in practice.
    case 'proposed':
    case 'in_review':
      return {
        steps: stepsWithStatesUpTo(2),
        rejected: false,
        cancelled: false,
        sentence: 'Awaiting review. An owner or architect approves or requests changes.',
      };
    case 'approved':
      return {
        steps: stepsWithStatesUpTo(3),
        rejected: false,
        cancelled: false,
        sentence: 'Approved, not yet merged. An owner or architect merges it into main.',
      };
    case 'merged':
      return {
        steps: stepsWithStatesUpTo(4),
        rejected: false,
        cancelled: false,
        sentence: 'Merged into main.',
      };
    case 'rejected':
      // Draft and Proposed did happen (a request must have existed to be
      // rejected); In review/Approved/Merged never will for this attempt —
      // shown as upcoming rather than passed, since the branch never
      // reached them as a completed state.
      return {
        steps: stepsWithStatesUpTo(2).map((step) => (step.key === 'in_review' ? { ...step, state: 'upcoming' as const } : step)),
        rejected: true,
        cancelled: false,
        sentence: "Rejected. This change wasn't merged — start a new change, or discuss with the reviewer and open a new one.",
      };
    case 'archived':
      // Change branches never reach this status (it's the capture-draft
      // lifecycle's, per `BranchStatus`'s own doc comment) — handled only
      // so this switch is exhaustive over the shared enum.
      return { steps: stepsWithStatesUpTo(null), rejected: false, cancelled: false, sentence: 'Archived.' };
    case 'cancelled': {
      // S1 item 4: the other side exit, alongside rejected — whatever
      // steps had actually passed (Draft always; Proposed too if this was
      // cancelled after submission) stay passed; the step it was cancelled
      // out of is downgraded from "current" to "upcoming" (same trick
      // `rejected` already uses for `in_review`) so nothing on the line
      // reads as current for a closed state.
      const exitKey: ChangeStepKey = mergeRequest ? 'in_review' : 'proposed';
      return {
        steps: stepsWithStatesUpTo(mergeRequest ? 2 : 1).map((step) => (step.key === exitKey ? { ...step, state: 'upcoming' as const } : step)),
        rejected: false,
        cancelled: true,
        sentence: 'Cancelled.',
      };
    }
  }
}
