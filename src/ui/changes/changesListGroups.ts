import { OPEN_CHANGE_STATUSES } from '../../db/branches';
import type { BranchIntent, BranchRow } from '../../db/types';
import { INTENT_OPTIONS } from './branchIntent';

const REVIEW_STATUSES: readonly BranchRow['status'][] = ['proposed', 'in_review', 'approved'];

export interface ChangesListGroups {
  /** Changes submitted and waiting for a reviewer (proposed, in review, approved) — the same set the review queue counts. */
  waitingForReview: BranchRow[];
  /** Draft changes (the open ones not yet submitted) by intent, in `INTENT_OPTIONS` order. With `waitingForReview` they make up the Changes nav badge. */
  openByIntent: { intent: BranchIntent; branches: BranchRow[] }[];
  merged: BranchRow[];
  cancelled: BranchRow[];
  /** Rejected or archived — ended without merging, other than by cancelling. */
  closed: BranchRow[];
}

/**
 * The Changes list's sections: open changes grouped by intent (so each
 * group's count adds up to the nav badge), then merged, cancelled and
 * otherwise-closed changes in their own collapsed sections. Pure, so the
 * split is unit-tested on its own.
 */
export function groupChangesList(branches: readonly BranchRow[]): ChangesListGroups {
  const open = branches.filter((b) => OPEN_CHANGE_STATUSES.includes(b.status) && !REVIEW_STATUSES.includes(b.status));
  return {
    waitingForReview: branches.filter((b) => REVIEW_STATUSES.includes(b.status)),
    // `?? 'propose'` covers only a pre-F0 change branch — the same fallback `ChangeView.tsx` uses.
    openByIntent: INTENT_OPTIONS.map((option) => ({ intent: option.value, branches: open.filter((b) => (b.intent ?? 'propose') === option.value) })),
    merged: branches.filter((b) => b.status === 'merged'),
    cancelled: branches.filter((b) => b.status === 'cancelled'),
    closed: branches.filter((b) => b.status === 'rejected' || b.status === 'archived'),
  };
}
