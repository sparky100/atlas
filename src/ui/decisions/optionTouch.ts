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
 *
 * "Touched at all" (`touchedElementIds`) is read straight off the own-
 * delta subject list — a subject this option's deltas ever named, whatever
 * the net effect. Every other field asks "what does this option's own
 * *final* state actually show," which needs the option's own already-
 * folded head (`optionElementsById`/`optionRelationshipsHead`, correctly
 * resolved by `apply()`'s own fold, C8/C9 included) as the source of
 * truth for "does it still exist" / "is this edge still live" / "what's
 * its current attribute value" — not a second, hand-rolled replay of the
 * delta list, which would have to reinvent the engine's own fold logic and
 * risk disagreeing with it. A subject this option created *and* later
 * retracted itself (a real, if rare, net no-op) reads as neither added nor
 * retired, since the option's own head shows nothing happened to main's
 * state at all.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { Delta, UUID } from '../../contracts/delta';
import type { ChangeSubjectSummary } from '../../db/changeSummary';
import { attributesRecord } from '../elements/attributesRecord';

export interface OptionTouch {
  /** Every element subject this option's own deltas name — created, updated, retracted, or restored — removed (retracted) elements included, whatever the option's own head shows as the final state. */
  touchedElementIds: ReadonlySet<UUID>;
  /** Element subjects this option's own deltas retracted, and that are still absent from the option's own current head — "removed from model" (a real `element.retract`), never a lifecycle-only retirement (which leaves the element in place — see `lifecycleRetiredElementIds`). */
  retiredElements: readonly { id: UUID; name: string }[];
  /** Element subjects created by this option's own deltas, and still present in the option's own current head. */
  addedElements: readonly { id: UUID; name: string }[];
  /** `relationship.create` deltas of type `replaces` this option itself introduced (ADR-001's own `from = replacement, to = retiring element` convention) that are still live in the option's own current head — a `replaces` edge this same option later retracted (e.g. via a subsequent "Remove from model") is excluded, matching `retiredElements`' own "final state, not any occurrence" rule. */
  replacesEdges: readonly { fromElementId: UUID; toElementId: UUID }[];
  /** Element subjects whose `lifecycleStatus` this option's own deltas set (an `element.update` on that attribute), where the option's own current head still reads `'retiring'` or `'retired'` — the "Retire…" action's own delta shape (ADR-000: `useElementRetire.ts` sets `lifecycleStatus` and never retracts). Excludes an element this same option also removed from the model outright — that reads as `retiredElements` instead, never both. */
  lifecycleRetiredElements: readonly { id: UUID; name: string }[];
  /** Relationship subjects touched, excluding `replaces` edges (bookkeeping for a retire/add already counted above, not a "connection" of its own) — the option summary line's own "re-points N connections" count. */
  repointedRelationshipCount: number;
}

function findCreateDelta(deltas: readonly Delta[]): Extract<Delta, { kind: 'relationship.create' }> | undefined {
  return deltas.find((d): d is Extract<Delta, { kind: 'relationship.create' }> => d.kind === 'relationship.create');
}

function isLifecycleStatusUpdate(delta: Delta): boolean {
  return delta.kind === 'element.update' && delta.attribute === 'lifecycleStatus';
}

export function deriveOptionTouch(subjects: readonly ChangeSubjectSummary[], optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>, optionRelationshipsHead: readonly RelationshipsHeadRow[]): OptionTouch {
  const touchedElementIds = new Set<UUID>();
  const retiredElements: { id: UUID; name: string }[] = [];
  const addedElements: { id: UUID; name: string }[] = [];
  const replacesEdges: { fromElementId: UUID; toElementId: UUID }[] = [];
  const lifecycleRetiredElements: { id: UUID; name: string }[] = [];
  let repointedRelationshipCount = 0;

  const liveRelationshipIds = new Set(optionRelationshipsHead.map((r) => r.relationship_id));

  for (const subject of subjects) {
    if (subject.subjectType === 'element') {
      touchedElementIds.add(subject.subjectId);
      const stillExists = optionElementsById.has(subject.subjectId);

      if (!stillExists) {
        // Retracted by this option AND never created by this option — a
        // pre-existing (main-inherited) element this option removed. An
        // element this same option both created and retracted is a real
        // net no-op (main never had it either way), not a removal.
        const createdByThisOption = subject.deltas.some((d) => d.kind === 'element.create');
        if (!createdByThisOption && subject.deltas.some((d) => d.kind === 'element.retract')) retiredElements.push({ id: subject.subjectId, name: subject.name });
        continue;
      }

      if (subject.deltas.some((d) => d.kind === 'element.create')) addedElements.push({ id: subject.subjectId, name: subject.name });

      if (subject.deltas.some(isLifecycleStatusUpdate)) {
        const currentStatus = attributesRecord(optionElementsById.get(subject.subjectId)?.attributes ?? null).lifecycleStatus;
        if (currentStatus === 'retiring' || currentStatus === 'retired') lifecycleRetiredElements.push({ id: subject.subjectId, name: subject.name });
      }
      continue;
    }

    if (subject.relationshipType === 'replaces') {
      if (liveRelationshipIds.has(subject.subjectId)) {
        const createDelta = findCreateDelta(subject.deltas);
        if (createDelta) replacesEdges.push({ fromElementId: createDelta.fromElementId, toElementId: createDelta.toElementId });
      }
      continue;
    }
    repointedRelationshipCount += 1;
  }

  return { touchedElementIds, retiredElements, addedElements, replacesEdges, lifecycleRetiredElements, repointedRelationshipCount };
}
