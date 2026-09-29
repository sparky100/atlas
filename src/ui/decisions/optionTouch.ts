/**
 * F6.3 (decision page rework, Part B — rework per the sprint's own final
 * decisions): "what this option itself did," derived from
 * `summarizeOwnDeltas`'s own `ChangeSubjectSummary[]` (`src/db/changeSummary.ts`)
 * — the branch's own deltas since its fork point (`listOwnDeltas`, fork-
 * scoped), never a diff of two arbitrary projected states. This is the one
 * place that reads "touched/removed/replaces" off an option's own deltas;
 * the option summary line, the system/container outcome row, the scoped-
 * boundary-crossing scope, and "Also affected" all consume this shared
 * derivation rather than each re-deriving their own notion of "touched."
 *
 * Why own-deltas, not a version-diff of main vs the option's head: a
 * version-diff conflates the option's own changes with independent main-
 * side drift (main can move after the option forks — see
 * `compareOptions.ts`'s own module comment on fork-point folding). Own
 * deltas are immune to that by construction — they're exactly the
 * commits this branch itself made.
 */
import type { Delta, UUID } from '../../contracts/delta';
import type { ChangeSubjectSummary } from '../../db/changeSummary';

export interface OptionTouch {
  /** Every element subject this option's own deltas name — created, updated, retracted, or restored — removed (retracted) elements included. */
  touchedElementIds: ReadonlySet<UUID>;
  /** Element subjects retracted by one of this option's own deltas. */
  retiredElements: readonly { id: UUID; name: string }[];
  /** Element subjects created by one of this option's own deltas. */
  addedElements: readonly { id: UUID; name: string }[];
  /** `relationship.create` deltas of type `replaces` this option itself introduced — ADR-001's own `from = replacement, to = retiring element` convention. */
  replacesEdges: readonly { fromElementId: UUID; toElementId: UUID }[];
  /** Relationship subjects touched, excluding `replaces` edges (bookkeeping for a retire/add already counted above, not a "connection" of its own) — the option summary line's own "re-points N connections" count. */
  repointedRelationshipCount: number;
}

function findCreateDelta(deltas: readonly Delta[]): Extract<Delta, { kind: 'relationship.create' }> | undefined {
  return deltas.find((d): d is Extract<Delta, { kind: 'relationship.create' }> => d.kind === 'relationship.create');
}

export function deriveOptionTouch(subjects: readonly ChangeSubjectSummary[]): OptionTouch {
  const touchedElementIds = new Set<UUID>();
  const retiredElements: { id: UUID; name: string }[] = [];
  const addedElements: { id: UUID; name: string }[] = [];
  const replacesEdges: { fromElementId: UUID; toElementId: UUID }[] = [];
  let repointedRelationshipCount = 0;

  for (const subject of subjects) {
    if (subject.subjectType === 'element') {
      touchedElementIds.add(subject.subjectId);
      if (subject.deltas.some((d) => d.kind === 'element.retract')) retiredElements.push({ id: subject.subjectId, name: subject.name });
      if (subject.deltas.some((d) => d.kind === 'element.create')) addedElements.push({ id: subject.subjectId, name: subject.name });
      continue;
    }

    if (subject.relationshipType === 'replaces') {
      const createDelta = findCreateDelta(subject.deltas);
      if (createDelta) replacesEdges.push({ fromElementId: createDelta.fromElementId, toElementId: createDelta.toElementId });
      continue;
    }
    repointedRelationshipCount += 1;
  }

  return { touchedElementIds, retiredElements, addedElements, replacesEdges, repointedRelationshipCount };
}
