import { describe, expect, it } from 'vitest';
import type { DecisionOptionMark } from '../../contracts/decisionOptionMark';
import { optionProvenance } from './optionProvenance';

const mark: DecisionOptionMark = { decisionId: 'd', branchId: 'b', agent: 'designer', draftedAt: 't', draftRunId: null, suggestedTitle: 'A', suggestedSummary: 's', editedBy: null, editedAt: null };

describe('optionProvenance', () => {
  it('is nothing for an option added by hand', () => {
    expect(optionProvenance(undefined, () => 'x')).toBeNull();
  });
  it('says the Designer suggested it, and names who edited it first', () => {
    expect(optionProvenance(mark, () => 'x')).toBe('Suggested by the Designer');
    expect(optionProvenance({ ...mark, editedBy: 'u1', editedAt: 't' }, () => 'Priya')).toBe('Suggested by the Designer, edited by Priya before it was added');
  });
});
