import { describe, expect, it } from 'vitest';
import type { DecisionStatus } from '../../db/types';
import { decisionStatusTone } from './decisionStatus';

describe('decisionStatusTone', () => {
  it('maps every decision status value to a tone (never colour-only, §6.3/§8.4/§8.7)', () => {
    const expected: Record<DecisionStatus, string> = {
      proposed: 'neutral',
      accepted: 'ok',
      rejected: 'danger',
      superseded: 'neutral',
    };
    for (const [status, tone] of Object.entries(expected)) {
      expect(decisionStatusTone(status as DecisionStatus)).toBe(tone);
    }
  });
});
