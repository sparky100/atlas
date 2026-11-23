import { describe, expect, it } from 'vitest';
import { decisionGapFromRow } from './decisionGaps';

describe('decisionGapFromRow', () => {
  it('maps a saved gap to the view shape without changing its words', () => {
    expect(decisionGapFromRow({
      id: 'gap-1',
      decision_id: 'decision-1',
      branch_id: 'branch-1',
      option_id: 'option-1',
      origin: 'research',
      body: 'No published source says whether the vendor supports single sign-on.',
      created_by: 'user-1',
      created_at: '2026-11-23T10:00:00Z',
    })).toEqual({
      id: 'gap-1',
      decisionId: 'decision-1',
      branchId: 'branch-1',
      optionId: 'option-1',
      origin: 'research',
      body: 'No published source says whether the vendor supports single sign-on.',
      createdBy: 'user-1',
      createdAt: '2026-11-23T10:00:00Z',
    });
  });

  it('keeps a decision-level gap unlinked from any option', () => {
    const gap = decisionGapFromRow({
      id: 'gap-2',
      decision_id: 'decision-1',
      branch_id: null,
      option_id: null,
      origin: 'manual',
      body: 'Nobody has recorded the current licence end date.',
      created_by: 'user-1',
      created_at: '2026-11-23T10:00:00Z',
    });
    expect(gap.branchId).toBeNull();
    expect(gap.optionId).toBeNull();
  });
});
