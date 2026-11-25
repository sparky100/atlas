import { describe, expect, it } from 'vitest';
import { chosenOptionPhrase, decisionOptionState, type OptionStateBranch, type OptionStateDecision } from './decisionOptionState';

const OPTION = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const BASELINE = '00000000-0000-4000-8000-000000000003';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const open: OptionStateDecision = { status: 'proposed', chosen_option_id: null, baseline_option_id: BASELINE };
const chose = (id: string): OptionStateDecision => ({ status: 'accepted', chosen_option_id: id, baseline_option_id: BASELINE });
const cancelledDecision: OptionStateDecision = { status: 'rejected', chosen_option_id: null, baseline_option_id: BASELINE };
const branch = (status: OptionStateBranch['status'], edited: boolean): OptionStateBranch => ({ status, base_commit_id: C1, head_commit_id: edited ? C2 : C1 });

describe('decisionOptionState', () => {
  it('an option on an open decision is a candidate, with or without a change', () => {
    expect(decisionOptionState(open, OPTION, null)).toMatchObject({ key: 'candidate', label: 'Candidate', isChosen: false, sketched: false });
    expect(decisionOptionState(open, OPTION, branch('draft', false))).toMatchObject({ key: 'candidate', label: 'Candidate', sketched: false });
    expect(decisionOptionState(open, OPTION, branch('draft', true))).toMatchObject({ key: 'candidate', label: 'Candidate · change being sketched', sketched: true });
  });

  it('a candidate whose change was cancelled is removed', () => {
    expect(decisionOptionState(open, OPTION, branch('cancelled', false))).toMatchObject({ key: 'removed', label: 'Removed', tone: 'danger' });
  });

  it('once another option is chosen, or the decision is cancelled, the rest are not chosen', () => {
    expect(decisionOptionState(chose(OTHER), OPTION, null)).toMatchObject({ key: 'not_chosen', label: 'Not chosen', isChosen: false });
    expect(decisionOptionState(chose(OTHER), OPTION, branch('cancelled', true))).toMatchObject({ key: 'not_chosen' });
    expect(decisionOptionState(cancelledDecision, OPTION, null)).toMatchObject({ key: 'not_chosen' });
  });

  it('chosen with no change, or an empty change, has not started delivery', () => {
    expect(decisionOptionState(chose(OPTION), OPTION, null)).toMatchObject({ key: 'chosen', label: 'Chosen · delivery not started', isChosen: true });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('draft', false))).toMatchObject({ key: 'chosen', label: 'Chosen · delivery not started' });
  });

  it('chosen "Stay as we are" never reaches delivery', () => {
    expect(decisionOptionState(chose(BASELINE), BASELINE, null)).toMatchObject({ key: 'chosen', label: 'Chosen · no change to the model planned' });
    expect(decisionOptionState(chose(BASELINE), BASELINE, branch('draft', true))).toMatchObject({ key: 'chosen', label: 'Chosen · no change to the model planned' });
  });

  it('follows the delivery change: edits, review, approval, live model, stopped', () => {
    expect(decisionOptionState(chose(OPTION), OPTION, branch('draft', true))).toMatchObject({ key: 'delivery_started', label: 'Delivery started' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('proposed', true))).toMatchObject({ key: 'in_review', label: 'Delivery started · in review' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('in_review', true))).toMatchObject({ key: 'in_review' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('approved', true))).toMatchObject({ key: 'approved', label: 'Approved, not yet in the live model' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('merged', true))).toMatchObject({ key: 'in_live_model', label: 'In the live model' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('cancelled', true))).toMatchObject({ key: 'delivery_stopped', tone: 'warn' });
    expect(decisionOptionState(chose(OPTION), OPTION, branch('rejected', true))).toMatchObject({ key: 'delivery_stopped' });
  });

  it('never says approved or live unless the change is', () => {
    for (const status of ['draft', 'proposed', 'in_review'] as const) {
      const s = decisionOptionState(chose(OPTION), OPTION, branch(status, true));
      expect(s.label).not.toMatch(/approved|live model/i);
    }
  });
});

describe('chosenOptionPhrase', () => {
  it('gives the short phrase Home and the project page add after the title', () => {
    expect(chosenOptionPhrase(decisionOptionState(chose(OPTION), OPTION, null))).toBe('delivery not started');
    expect(chosenOptionPhrase(decisionOptionState(chose(BASELINE), BASELINE, null))).toBe('no change to the model planned');
    expect(chosenOptionPhrase(decisionOptionState(chose(OPTION), OPTION, branch('draft', true)))).toBe('delivery started');
    expect(chosenOptionPhrase(decisionOptionState(chose(OPTION), OPTION, branch('merged', true)))).toBe('in the live model');
  });
});
