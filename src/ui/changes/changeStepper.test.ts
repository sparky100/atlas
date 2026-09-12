import { describe, expect, it } from 'vitest';
import type { MergeRequestRow } from '../../db/types';
import { deriveChangeStep } from './changeStepper';

function mergeRequest(status: MergeRequestRow['status']): MergeRequestRow {
  return {
    id: 'req-1',
    org_id: 'org-1',
    model_id: 'model-1',
    branch_id: 'branch-1',
    requested_head_commit_id: 'commit-1',
    main_head_commit_id: 'commit-0',
    status,
    requested_by: 'user-1',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    merge_commit_id: null,
    classification: {},
  } as unknown as MergeRequestRow;
}

function stateOf(steps: ReturnType<typeof deriveChangeStep>['steps'], key: string): string {
  const step = steps.find((s) => s.key === key);
  if (!step) throw new Error(`no step ${key}`);
  return step.state;
}

describe('deriveChangeStep', () => {
  it('draft with no open request: Draft is current, everything else upcoming', () => {
    const result = deriveChangeStep({ status: 'draft' }, null);
    expect(stateOf(result.steps, 'draft')).toBe('current');
    expect(stateOf(result.steps, 'proposed')).toBe('upcoming');
    expect(stateOf(result.steps, 'in_review')).toBe('upcoming');
    expect(result.rejected).toBe(false);
    expect(result.sentence).toMatch(/not yet submitted/i);
  });

  it('draft after changes requested: Draft is current with the "sent back" sentence', () => {
    const result = deriveChangeStep({ status: 'draft' }, mergeRequest('changes_requested'));
    expect(stateOf(result.steps, 'draft')).toBe('current');
    expect(stateOf(result.steps, 'proposed')).toBe('upcoming');
    expect(result.sentence).toMatch(/sent back for changes/i);
  });

  it('proposed: Draft and Proposed passed, In review current', () => {
    const result = deriveChangeStep({ status: 'proposed' }, mergeRequest('pending'));
    expect(stateOf(result.steps, 'draft')).toBe('passed');
    expect(stateOf(result.steps, 'proposed')).toBe('passed');
    expect(stateOf(result.steps, 'in_review')).toBe('current');
    expect(stateOf(result.steps, 'approved')).toBe('upcoming');
    expect(result.sentence).toMatch(/awaiting review/i);
  });

  it('approved: Draft/Proposed/In review passed, Approved current', () => {
    const result = deriveChangeStep({ status: 'approved' }, mergeRequest('approved'));
    expect(stateOf(result.steps, 'in_review')).toBe('passed');
    expect(stateOf(result.steps, 'approved')).toBe('current');
    expect(stateOf(result.steps, 'merged')).toBe('upcoming');
    expect(result.sentence).toMatch(/approved, not yet merged/i);
  });

  it('merged: every step passed or current, Merged is the last', () => {
    const result = deriveChangeStep({ status: 'merged' }, null);
    expect(stateOf(result.steps, 'approved')).toBe('passed');
    expect(stateOf(result.steps, 'merged')).toBe('current');
    expect(result.rejected).toBe(false);
  });

  it('rejected: Draft/Proposed passed, In review/Approved/Merged upcoming, rejected flag set, nothing on the line is current', () => {
    const result = deriveChangeStep({ status: 'rejected' }, null);
    expect(stateOf(result.steps, 'draft')).toBe('passed');
    expect(stateOf(result.steps, 'proposed')).toBe('passed');
    expect(stateOf(result.steps, 'in_review')).toBe('upcoming');
    expect(stateOf(result.steps, 'approved')).toBe('upcoming');
    expect(stateOf(result.steps, 'merged')).toBe('upcoming');
    expect(result.steps.some((s) => s.state === 'current')).toBe(false);
    expect(result.rejected).toBe(true);
  });

  it('cancelled from draft (never submitted): only Draft passed, cancelled flag set, nothing current', () => {
    const result = deriveChangeStep({ status: 'cancelled' }, null);
    expect(stateOf(result.steps, 'draft')).toBe('passed');
    expect(stateOf(result.steps, 'proposed')).toBe('upcoming');
    expect(result.steps.some((s) => s.state === 'current')).toBe(false);
    expect(result.rejected).toBe(false);
    expect(result.cancelled).toBe(true);
  });

  it('cancelled after submission: Draft/Proposed passed too', () => {
    const result = deriveChangeStep({ status: 'cancelled' }, mergeRequest('pending'));
    expect(stateOf(result.steps, 'draft')).toBe('passed');
    expect(stateOf(result.steps, 'proposed')).toBe('passed');
    expect(stateOf(result.steps, 'in_review')).toBe('upcoming');
    expect(result.cancelled).toBe(true);
  });

  it('in_review (defensive — never actually written) maps the same as proposed', () => {
    const result = deriveChangeStep({ status: 'in_review' }, mergeRequest('pending'));
    expect(stateOf(result.steps, 'in_review')).toBe('current');
  });
});
