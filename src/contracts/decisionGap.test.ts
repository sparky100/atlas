import { describe, expect, it } from 'vitest';
import { DECISION_GAP_BODY_MAX, decisionGapProblem } from './decisionGap';

describe('decisionGapProblem', () => {
  it('requires a short note', () => {
    expect(decisionGapProblem('   ')).toBe('Write what you could not find.');
  });

  it('accepts a useful note, with line breaks, up to the limit', () => {
    expect(decisionGapProblem('No published source says whether it supports single sign-on.')).toBeNull();
    expect(decisionGapProblem('First line.\nSecond line.')).toBeNull();
    expect(decisionGapProblem('x'.repeat(DECISION_GAP_BODY_MAX))).toBeNull();
  });

  it('refuses a note longer than the saved limit', () => {
    expect(decisionGapProblem('x'.repeat(DECISION_GAP_BODY_MAX + 1))).toContain(String(DECISION_GAP_BODY_MAX));
  });
});
