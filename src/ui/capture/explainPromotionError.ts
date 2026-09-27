import type { UUID } from '../../contracts/delta';
import type { CaptureCandidate } from '../../contracts/capture';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BuildPromotionEnvelopeError } from '../../capture/buildPromotionEnvelope';
import { candidateRefLabel } from './candidateRefLabel';

/**
 * A short, human label for a candidate — its own element name, or
 * "type from → to" for a relationship (the same shape `CaptureCandidateRow.tsx`
 * already shows) — so an error message names something the reviewer can
 * find in the list by eye, never the `seq`/raw ids the review UI shows
 * nowhere at all.
 */
function candidateLabel(candidate: CaptureCandidate, mainElementById: ReadonlyMap<UUID, ElementsHeadRow>, draftElementById: ReadonlyMap<UUID, string>): string {
  if (candidate.proposal.kind === 'element') return candidate.proposal.name;
  const from = candidateRefLabel(candidate.proposal.from, mainElementById, draftElementById) ?? 'an unresolved endpoint';
  const to = candidateRefLabel(candidate.proposal.to, mainElementById, draftElementById) ?? 'an unresolved endpoint';
  return `${candidate.proposal.relationshipType} ${from} → ${to}`;
}

/** Every real message here starts `seq {N}: ` (`buildPromotionEnvelope.ts`'s own throw sites) — redundant once the caller already names the offending row by content, and exactly the raw, un-navigable prefix this module exists to get rid of. */
function stripSeqPrefix(message: string, seq: number): string {
  const prefix = `seq ${String(seq)}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

/**
 * Turns a `BuildPromotionEnvelopeError` (`buildPromotionEnvelope.ts`'s own
 * doc comment on the error class explains why it now carries `seq`/
 * `unresolvedRefId` rather than only a message) into something the
 * reviewer can act on. Real capture review, verbatim: "seq 12: to
 * (d4667dbd-…) was not found on the target branch — either it wasn't
 * promoted in this same apply call, or it no longer exists there" — with
 * no way to connect that id back to anything visible in the review list.
 * Root cause there specifically: the reviewer had rejected the capability
 * candidate a `supports` relationship's own `to` end pointed at, then
 * accepted the relationship anyway.
 *
 * Named for the *offending* candidate, and — for the common,
 * reviewer-caused case (`unresolvedRefId` resolving to another candidate
 * in this same draft) — names exactly which other candidate is blocking
 * it and what to do. Falls back to the underlying technical message,
 * still anchored to the offending candidate's own name rather than its
 * `seq`, for the rarer cases this can't explain specifically (an internal
 * invariant, or a target-branch element genuinely retracted elsewhere
 * since this draft was captured).
 */
export function explainPromotionError(
  error: BuildPromotionEnvelopeError,
  candidates: readonly CaptureCandidate[],
  mainElementById: ReadonlyMap<UUID, ElementsHeadRow>,
  draftElementById: ReadonlyMap<UUID, string>,
): string {
  const offending = candidates.find((c) => c.seq === error.seq);
  const offendingLabel = offending ? `"${candidateLabel(offending, mainElementById, draftElementById)}"` : `row ${String(error.seq)}`;

  if (error.unresolvedRefId !== undefined) {
    const refCandidate = candidates.find((c) => c.draftSubjectId === error.unresolvedRefId);
    if (refCandidate) {
      const refLabel = `"${candidateLabel(refCandidate, mainElementById, draftElementById)}"`;
      if (refCandidate.decision === 'rejected') {
        return `${offendingLabel} can't be applied: it depends on ${refLabel}, which you rejected. Accept ${refLabel} instead, or reject ${offendingLabel} too, then try applying again.`;
      }
      if (refCandidate.decision === null) {
        return `${offendingLabel} can't be applied: it depends on ${refLabel}, which hasn't been decided yet. Decide ${refLabel} (accept it) before applying, or reject ${offendingLabel} instead.`;
      }
      // Decided some other way (merged/split/edited/accepted) but still not
      // on the target head — a genuine inconsistency, not a reviewer
      // mistake this can explain; fall through to the generic message.
    } else {
      const mainName = mainElementById.get(error.unresolvedRefId)?.name;
      if (mainName !== undefined) {
        return `${offendingLabel} can't be applied: it references "${mainName}", which no longer exists on the target change (it may have been retracted or removed there since this draft was captured). Reject ${offendingLabel}, or pick a different target change.`;
      }
    }
  }

  return `${offendingLabel} can't be applied: ${stripSeqPrefix(error.message, error.seq)}`;
}
