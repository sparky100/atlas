/**
 * The review queue's own "Blocked" filter (`CaptureReviewView.tsx`): every
 * candidate that's decided to be promoted (`accepted`/`merged`/`split`/
 * `edited` — never `rejected`, never still undecided) but references
 * another candidate in this same draft — via a parent, or a relationship
 * endpoint — that itself is *not* going to be promoted (rejected, or
 * simply left undecided). That's exactly the conflict
 * `buildPromotionEnvelope.ts`'s own `resolveRef` only discovers at apply
 * time, one at a time (it throws on the first one it finds) — computed
 * here instead so the reviewer can find and fix every one of them before
 * ever clicking Apply, not one failed attempt per conflict.
 *
 * Deliberately narrower than every failure `buildPromotionEnvelope.ts` can
 * throw: this only catches a *cross-candidate* reference problem, decidable
 * from the candidate list alone. It can never catch a target-branch state
 * conflict (an element retracted on the target since this draft was
 * captured, say) — that needs the target branch's own current head, only
 * knowable at apply time, same as `buildPromotionEnvelope.ts` itself.
 */
import type { CandidateRef, CaptureCandidate } from '../contracts/capture';
import type { UUID } from '../contracts/delta';

const ALREADY_ON_TARGET_CLASSES: ReadonlySet<CaptureCandidate['class']> = new Set(['update', 'confirm', 'conflict']);

function refsOf(candidate: CaptureCandidate): readonly CandidateRef[] {
  if (candidate.proposal.kind === 'element') return candidate.proposal.parent !== null ? [candidate.proposal.parent] : [];
  return [candidate.proposal.from, candidate.proposal.to];
}

export function findBlockedCandidates(candidates: readonly CaptureCandidate[]): ReadonlySet<UUID> {
  const decisionByDraftSubjectId = new Map<UUID, CaptureCandidate['decision']>();
  for (const c of candidates) {
    // A matched element (`update`/`confirm`/`conflict`) is already on the target branch, so a reference to it resolves whatever its own decision is — it can't make anything that points at it fail to apply. Only an element this draft would *create* (or a still-ambiguous one) can leave a dangling reference.
    if (c.draftSubjectId !== null && !ALREADY_ON_TARGET_CLASSES.has(c.class)) decisionByDraftSubjectId.set(c.draftSubjectId, c.decision);
  }

  const blocked = new Set<UUID>();
  for (const c of candidates) {
    if (c.decision === null || c.decision === 'rejected') continue;
    for (const ref of refsOf(c)) {
      if (ref.kind !== 'existing') continue;
      const refDecision = decisionByDraftSubjectId.get(ref.elementId);
      // Not a sibling draft candidate at all — a real, already-existing
      // main/target element — or absent (`undefined`) either way: fine,
      // nothing this function can determine is wrong with it.
      if (refDecision === null || refDecision === 'rejected') {
        blocked.add(c.id);
        break;
      }
    }
  }
  return blocked;
}
