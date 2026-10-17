import type { CaptureCandidate } from '../contracts/capture';

/**
 * SPEC-capture.md §8.2 (amended): whether a capture review can be closed
 * with `atlas.finish_capture_review` — no target change, no commit —
 * rather than `apply_capture_decisions`. The client-side mirror of that
 * RPC's own gate: no candidate undecided, and every
 * candidate not yet promoted is `rejected` (§8.2's table: `rejected`
 * promotes nothing). An all-rejected review, or one whose accepted
 * candidates were all already applied in an earlier session, qualifies —
 * as does a draft with no candidates at all, which has nothing to apply;
 * anything still waiting to be promoted does not.
 */
export function finishableWithoutApply(candidates: readonly Pick<CaptureCandidate, 'decision' | 'promotedCommitId'>[]): boolean {
  return candidates.every((c) => c.decision !== null && (c.decision === 'rejected' || c.promotedCommitId !== null));
}
