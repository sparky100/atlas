import { describe, expect, it } from 'vitest';
import type { BranchStatus } from '../../db/types';
import { branchStatusTone } from './branchStatus';

describe('branchStatusTone', () => {
  it('maps every branch_status value to a tone (never colour-only, §6.3/§8.4/§8.7)', () => {
    const expected: Record<BranchStatus, string> = {
      draft: 'neutral',
      proposed: 'info',
      in_review: 'info',
      approved: 'ok',
      merged: 'ok',
      rejected: 'danger',
      archived: 'neutral',
      cancelled: 'neutral',
    };
    for (const [status, tone] of Object.entries(expected)) {
      expect(branchStatusTone(status as BranchStatus)).toBe(tone);
    }
  });
});
