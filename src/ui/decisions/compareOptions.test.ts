import { describe, expect, it } from 'vitest';
import { hasMainDrifted } from './compareOptions';

// Decision-side-completion Question B: is the "main has moved since this
// option branched" note backed by a real, tested piece of logic? The note
// itself lives in DecisionView.tsx, reading `comparison.mainDriftedByBranchId`
// (compareOptions.ts) — this is the one real comparison (`baseCommitId` vs
// `mainHeadCommitId`) that Set is built from, extracted so it's directly
// unit-testable rather than only provable by exercising the whole
// (Supabase-backed) `compareDecisionOptions`.
describe('hasMainDrifted', () => {
  it('is true when the option forked at a commit that is no longer main\'s current head', () => {
    expect(hasMainDrifted('commit-1', 'commit-2')).toBe(true);
  });

  it('is false when main has not moved since the option forked (its own fork point is still main\'s current head)', () => {
    expect(hasMainDrifted('commit-1', 'commit-1')).toBe(false);
  });
});
