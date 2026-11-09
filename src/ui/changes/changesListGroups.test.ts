import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import { groupChangesList } from './changesListGroups';

const b = (id: string, status: BranchRow['status'], intent: BranchRow['intent']) => ({ id, status, intent }) as BranchRow;

describe('groupChangesList', () => {
  const branches = [
    b('rec-draft', 'draft', 'record'),
    b('prop-merged', 'merged', 'propose'),
    b('prop-review', 'in_review', 'propose'),
    b('exp-draft', 'draft', 'explore'),
    b('exp-approved', 'approved', 'explore'),
    b('cancelled', 'cancelled', 'explore'),
    b('rejected', 'rejected', 'propose'),
    b('archived', 'archived', 'record'),
    b('proposed', 'proposed', 'correct'),
  ];

  it('lists submitted changes (proposed, in review, approved) as waiting for review', () => {
    expect(groupChangesList(branches).waitingForReview.map((x) => x.id)).toEqual(['prop-review', 'exp-approved', 'proposed']);
  });

  it('groups only drafts by intent, in intent order', () => {
    const { openByIntent } = groupChangesList(branches);
    expect(openByIntent.map((g) => [g.intent, g.branches.map((x) => x.id)])).toEqual([
      ['record', ['rec-draft']],
      ['propose', []],
      ['correct', []],
      ['explore', ['exp-draft']],
    ]);
  });

  it('puts merged, cancelled and rejected/archived changes in their own groups', () => {
    const { merged, cancelled, closed } = groupChangesList(branches);
    expect(merged.map((x) => x.id)).toEqual(['prop-merged']);
    expect(cancelled.map((x) => x.id)).toEqual(['cancelled']);
    expect(closed.map((x) => x.id)).toEqual(['rejected', 'archived']);
  });

  it('accounts for every change exactly once', () => {
    const g = groupChangesList(branches);
    const all = [...g.waitingForReview, ...g.openByIntent.flatMap((x) => x.branches), ...g.merged, ...g.cancelled, ...g.closed];
    expect(all).toHaveLength(branches.length);
  });
});
