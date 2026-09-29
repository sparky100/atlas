import { describe, expect, it } from 'vitest';
import { decisionComparisonKey, type DecisionComparisonKeyOption } from './decisionComparisonKey';

function option(branchId: string, baseCommitId: string, headCommitId: string): DecisionComparisonKeyOption {
  return { branchId, baseCommitId, headCommitId };
}

describe('decisionComparisonKey (useDecisionComparison\'s own effect dependency)', () => {
  it('is the same key for fresh-but-equal-content arrays — a ratings change never touches capabilityIds/otherConcernElementIds/options, so a re-render with unrelated state produces an identical key', () => {
    const options = [option('b1', 'base1', 'head1')];
    const a = decisionComparisonKey(['cap1'], ['sys1'], options);
    // Fresh arrays, same content — the same shape a ratings-only re-render would pass.
    const b = decisionComparisonKey([...['cap1']], [...['sys1']], [option('b1', 'base1', 'head1')]);
    expect(a).toBe(b);
  });

  it('changes when an option\'s headCommitId changes (a real commit on the option)', () => {
    const before = decisionComparisonKey(['cap1'], [], [option('b1', 'base1', 'head1')]);
    const after = decisionComparisonKey(['cap1'], [], [option('b1', 'base1', 'head2')]);
    expect(before).not.toBe(after);
  });

  it('changes when an option\'s baseCommitId changes (a rebase that moves the fork point without moving head)', () => {
    const before = decisionComparisonKey(['cap1'], [], [option('b1', 'base1', 'head1')]);
    const after = decisionComparisonKey(['cap1'], [], [option('b1', 'base2', 'head1')]);
    expect(before).not.toBe(after);
  });

  it('changes when the declared capability concerns change', () => {
    const before = decisionComparisonKey(['cap1'], [], [option('b1', 'base1', 'head1')]);
    const after = decisionComparisonKey(['cap1', 'cap2'], [], [option('b1', 'base1', 'head1')]);
    expect(before).not.toBe(after);
  });

  it('changes when the declared system/container concerns change', () => {
    const before = decisionComparisonKey([], ['sys1'], [option('b1', 'base1', 'head1')]);
    const after = decisionComparisonKey([], ['sys1', 'sys2'], [option('b1', 'base1', 'head1')]);
    expect(before).not.toBe(after);
  });

  it('changes when an option is added or removed', () => {
    const before = decisionComparisonKey([], [], [option('b1', 'base1', 'head1')]);
    const after = decisionComparisonKey([], [], [option('b1', 'base1', 'head1'), option('b2', 'base2', 'head2')]);
    expect(before).not.toBe(after);
  });
});
