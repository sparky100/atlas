import { describe, expect, it } from 'vitest';
import { isRoadmapEligibleBranch } from './roadmapEligibility';

describe('isRoadmapEligibleBranch', () => {
  it('excludes a correct-intent branch (no roadmap-meaningful date)', () => {
    expect(isRoadmapEligibleBranch({ intent: 'correct', status: 'merged', target_date: null }, 'asIs')).toBe(false);
  });

  it('excludes an explore-intent branch even with a status/date that would otherwise qualify', () => {
    expect(isRoadmapEligibleBranch({ intent: 'explore', status: 'merged', target_date: '2026-06-01' }, 'toBe')).toBe(false);
  });

  it('excludes a record/propose branch with no target date', () => {
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'merged', target_date: null }, 'asIs')).toBe(false);
  });

  it('includes a merged record/propose branch under both as-is and to-be', () => {
    expect(isRoadmapEligibleBranch({ intent: 'record', status: 'merged', target_date: '2026-03-01' }, 'asIs')).toBe(true);
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'merged', target_date: '2026-03-01' }, 'toBe')).toBe(true);
  });

  it('excludes an open (not yet merged) branch under as-is', () => {
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'in_review', target_date: '2026-09-01' }, 'asIs')).toBe(false);
  });

  it('includes an open branch under to-be', () => {
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'in_review', target_date: '2026-09-01' }, 'toBe')).toBe(true);
  });

  it('excludes a rejected/cancelled/archived branch under either mode', () => {
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'rejected', target_date: '2026-09-01' }, 'toBe')).toBe(false);
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'cancelled', target_date: '2026-09-01' }, 'toBe')).toBe(false);
    expect(isRoadmapEligibleBranch({ intent: 'propose', status: 'archived', target_date: '2026-09-01' }, 'toBe')).toBe(false);
  });
});
