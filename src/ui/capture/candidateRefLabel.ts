import type { UUID } from '../../contracts/delta';
import type { CandidateRef } from '../../contracts/capture';
import type { ElementsHeadRow } from '../../contracts/rows';

/**
 * A parent/endpoint reference as a short breadcrumb-ish label, for a
 * candidate still in draft form (SPEC §10: "with parent breadcrumb").
 * `draftElementById` names this run's own newly-minted elements (keyed by
 * `draftSubjectId`) — a reference to one of them is an `existing`-kind ref
 * whose id is a draft subject, not a main element, so it is resolved here
 * before falling back to main and, finally, to the raw id.
 */
export function candidateRefLabel(ref: CandidateRef | null, mainElementById: ReadonlyMap<UUID, ElementsHeadRow>, draftElementById: ReadonlyMap<UUID, string>): string | null {
  if (ref === null) return null;
  if (ref.kind === 'unresolved') return ref.text;
  if (ref.kind === 'candidate') return '(this document)';
  return draftElementById.get(ref.elementId) ?? mainElementById.get(ref.elementId)?.name ?? ref.elementId;
}
