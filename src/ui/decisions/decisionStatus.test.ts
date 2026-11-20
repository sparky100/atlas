import { describe, expect, it } from 'vitest';
import type { DecisionStatus } from '../../db/types';
import { decisionStatusLabel, decisionStatusMeaning, decisionStatusTone } from './decisionStatus';

describe('decisionStatusTone', () => {
  it('maps every decision status value to a tone (never colour-only, §6.3/§8.4/§8.7)', () => {
    const expected: Record<DecisionStatus, string> = {
      proposed: 'neutral',
      accepted: 'ok',
      rejected: 'neutral',
      superseded: 'neutral',
    };
    for (const [status, tone] of Object.entries(expected)) {
      expect(decisionStatusTone(status as DecisionStatus)).toBe(tone);
    }
  });
});

describe('decisionStatusLabel', () => {
  it('shows a cancelled decision (stored as rejected) as "cancelled", and every other status as stored', () => {
    expect(decisionStatusLabel('rejected')).toBe('cancelled');
    expect(decisionStatusLabel('proposed')).toBe('proposed');
    expect(decisionStatusLabel('accepted')).toBe('accepted');
    expect(decisionStatusLabel('superseded')).toBe('superseded');
  });
});

describe('decisionStatusMeaning', () => {
  it('says in a sentence what each status means', () => {
    expect(decisionStatusMeaning('rejected')).toMatch(/^Cancelled/);
    expect(decisionStatusMeaning('proposed')).toMatch(/no option has been chosen/);
  });
});
