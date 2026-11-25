/**
 * One truthful state for a decision's option (item 5 of the 25 Nov review,
 * proposals/PROPOSAL-truthful-option-states.md). Every screen that shows an
 * option's state reads it from here, so the decision, the project page, Home
 * and the pack use the same words (UX rule 7: never imply a step that has not
 * happened).
 *
 * Worked out from data already stored: the decision (status, chosen option,
 * baseline), the option, and the option's change if it has one. Nothing new
 * is stored.
 */
import type { UUID } from '../contracts/delta';
import type { BranchStatus } from '../db/types';

export type OptionStateKey =
  | 'candidate'
  | 'not_chosen'
  | 'removed'
  | 'chosen'
  | 'delivery_started'
  | 'in_review'
  | 'approved'
  | 'in_live_model'
  | 'delivery_stopped';

export interface OptionState {
  key: OptionStateKey;
  /** The plain words shown on the option, without names or dates. */
  label: string;
  tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger';
  /** True once the option was chosen, whatever happened next. */
  isChosen: boolean;
  /** Candidate only: someone has started sketching its change, but nothing is chosen. */
  sketched: boolean;
}

export interface OptionStateDecision {
  status: string;
  chosen_option_id: UUID | null;
  baseline_option_id: UUID | null;
}

export interface OptionStateBranch {
  status: BranchStatus;
  base_commit_id: UUID | null;
  head_commit_id: UUID | null;
}

/** A change has edits once its head has moved past the commit it forked from. */
export function branchHasEdits(branch: OptionStateBranch): boolean {
  return branch.head_commit_id !== null && branch.head_commit_id !== branch.base_commit_id;
}

const STOPPED: ReadonlySet<BranchStatus> = new Set<BranchStatus>(['cancelled', 'rejected', 'archived']);

function state(key: OptionStateKey, label: string, tone: OptionState['tone'], isChosen: boolean, sketched = false): OptionState {
  return { key, label, tone, isChosen, sketched };
}

export function decisionOptionState(decision: OptionStateDecision, optionId: UUID, branch: OptionStateBranch | null): OptionState {
  const isChosen = decision.status === 'accepted' && decision.chosen_option_id === optionId;

  if (!isChosen) {
    if (decision.status === 'proposed') {
      if (branch !== null && STOPPED.has(branch.status)) return state('removed', 'Removed', 'danger', false);
      const sketched = branch !== null && branchHasEdits(branch);
      return state('candidate', sketched ? 'Candidate · change being sketched' : 'Candidate', 'neutral', false, sketched);
    }
    return state('not_chosen', 'Not chosen', 'neutral', false);
  }

  if (optionId === decision.baseline_option_id) return state('chosen', 'Chosen · no change to the model planned', 'ok', true);
  if (branch === null) return state('chosen', 'Chosen · delivery not started', 'ok', true);

  switch (branch.status) {
    case 'merged':
      return state('in_live_model', 'In the live model', 'ok', true);
    case 'approved':
      return state('approved', 'Approved, not yet in the live model', 'info', true);
    case 'proposed':
    case 'in_review':
      return state('in_review', 'Delivery started · in review', 'info', true);
    case 'draft':
      return branchHasEdits(branch) ? state('delivery_started', 'Delivery started', 'info', true) : state('chosen', 'Chosen · delivery not started', 'ok', true);
    default:
      return state('delivery_stopped', 'Delivery stopped', 'warn', true);
  }
}

/** The short phrase Home and the project page add after the chosen option's title. */
export function chosenOptionPhrase(s: OptionState): string {
  switch (s.key) {
    case 'chosen':
      return s.label.includes('no change') ? 'no change to the model planned' : 'delivery not started';
    case 'delivery_started':
      return 'delivery started';
    case 'in_review':
      return 'delivery started, in review';
    case 'approved':
      return 'approved, not yet in the live model';
    case 'in_live_model':
      return 'in the live model';
    case 'delivery_stopped':
      return 'delivery stopped';
    default:
      return s.label.toLowerCase();
  }
}
