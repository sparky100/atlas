/**
 * `useCaptureReviewQueue.ts`'s own `apply()` doc comment: `merged` is only
 * ever attempted for an owner/architect reviewer on a record/correct
 * target (`autoMergeCaptureChange.ts`) — every other reviewer, and every
 * other target intent, still gets today's plain "Applied N candidate(s)."
 * This only adds to it when a merge was actually attempted, and
 * distinguishes "never attempted" (nothing worth saying — that reviewer
 * or that target was never eligible) from "attempted and failed" (worth
 * saying, since the reviewer might otherwise assume it merged when it
 * didn't).
 */
export function applyResultMessage(result: { appliedCount: number; merged: boolean; mergeSkippedReason?: string }): string {
  const base = `Applied ${String(result.appliedCount)} candidate(s).`;
  if (result.merged) return `${base} Merged to main.`;
  if (result.mergeSkippedReason !== undefined && result.mergeSkippedReason !== 'not_eligible_role' && result.mergeSkippedReason !== 'not_eligible_intent') {
    return `${base} Couldn't merge it to main automatically (${result.mergeSkippedReason}) — submit this change for review from its own page instead.`;
  }
  return base;
}
