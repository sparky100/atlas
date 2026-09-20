import type { UUID } from '../../contracts/delta';
import type { CandidateRef } from '../../contracts/capture';
import type { ElementsHeadRow } from '../../contracts/rows';

/** A parent/endpoint reference as a short breadcrumb-ish label, for a candidate still in draft form (SPEC §10: "with parent breadcrumb"). */
export function candidateRefLabel(ref: CandidateRef | null, mainElementById: ReadonlyMap<UUID, ElementsHeadRow>): string | null {
  if (ref === null) return null;
  if (ref.kind === 'unresolved') return ref.text;
  if (ref.kind === 'candidate') return '(this document)';
  return mainElementById.get(ref.elementId)?.name ?? ref.elementId;
}
