import { describe, expect, it } from 'vitest';
import type { DecisionRow, DecisionStatus } from '../../db/types';
import { groupDecisionsList } from './decisionsListGroups';

const d = (id: string, status: DecisionStatus) => ({ id, status }) as DecisionRow;

describe('groupDecisionsList', () => {
  it('puts open ones first and ended ones collapsed, keeping the given order', () => {
    const sections = groupDecisionsList([d('a', 'rejected'), d('b', 'proposed'), d('c', 'accepted'), d('e', 'proposed'), d('f', 'superseded')]);
    expect(sections.map((s) => [s.title, s.defaultOpen, s.decisions.map((x) => x.id)])).toEqual([
      ['Proposed', true, ['b', 'e']],
      ['Accepted', true, ['c']],
      ['Cancelled', false, ['a']],
      ['Superseded', false, ['f']],
    ]);
  });

  it('leaves out empty sections', () => {
    expect(groupDecisionsList([d('a', 'accepted')]).map((s) => s.title)).toEqual(['Accepted']);
    expect(groupDecisionsList([])).toEqual([]);
  });
});
