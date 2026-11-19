import { describe, expect, it } from 'vitest';
import { changesSummary, decisionsSummary, evidenceSummary, scopeSummary } from './projectStepSummary';

describe('project step summaries', () => {
  it('says what is in each step in a few words', () => {
    expect(scopeSummary(0)).toBe('nothing named yet');
    expect(scopeSummary(1)).toBe('1 item');
    expect(scopeSummary(3)).toBe('3 items');
    expect(changesSummary(0)).toBe('none yet');
    expect(changesSummary(1)).toBe('1 change');
    expect(evidenceSummary(2)).toBe('2 items');
  });

  it('counts proposed and accepted decisions and leaves history out', () => {
    expect(decisionsSummary([])).toBe('none yet');
    expect(decisionsSummary(['proposed'])).toBe('1 proposed');
    expect(decisionsSummary(['proposed', 'accepted', 'accepted', 'rejected'])).toBe('1 proposed, 2 accepted');
    expect(decisionsSummary(['rejected', 'superseded'])).toBe('all closed');
  });
});
