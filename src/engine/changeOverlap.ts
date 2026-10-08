/**
 * Which elements a change touches, and which of them it shares with
 * another open change (ADR-024 §9, "Other open changes touching the same
 * elements"). A change touches an element when it edits the element
 * itself, or adds, changes or removes a relationship with the element at
 * either end — both ends, unlike change impact (§8): the question here is
 * "might these two changes collide?", and two changes both integrating
 * with the same system is exactly that.
 *
 * Pure: the caller (`src/db/elements.ts`'s `listOpenChangesSharingElements`)
 * reads the delta rows; this only folds them into sets and compares them.
 */
import type { UUID } from '../contracts/delta';

export interface DeltaTouchRow {
  branchId: UUID;
  subjectType: 'element' | 'relationship';
  subjectId: UUID;
}

/** A relationship's own two ends, from its `relationship.create` delta — an update or retract delta carries only the relationship's id. */
export type RelationshipEnds = ReadonlyMap<UUID, { fromElementId: UUID; toElementId: UUID }>;

export function touchedElementsByBranch(rows: Iterable<DeltaTouchRow>, relationshipEnds: RelationshipEnds): Map<UUID, Set<UUID>> {
  const result = new Map<UUID, Set<UUID>>();
  for (const row of rows) {
    const touched = result.get(row.branchId) ?? new Set<UUID>();
    if (row.subjectType === 'element') {
      touched.add(row.subjectId);
    } else {
      const ends = relationshipEnds.get(row.subjectId);
      if (ends) {
        touched.add(ends.fromElementId);
        touched.add(ends.toElementId);
      }
    }
    result.set(row.branchId, touched);
  }
  return result;
}

/**
 * The elements two changes share, sorted for a stable display order: every
 * element both touch, plus a platform one change touches directly while the
 * other touches one of its modules (`parentOf` returns a module's own
 * platform, `null` for anything else). Two *sibling* modules of the same
 * platform don't overlap — editing SAP · PM and SAP · FI is not a collision.
 */
export function sharedElements(own: ReadonlySet<UUID>, other: ReadonlySet<UUID>, parentOf: (elementId: UUID) => UUID | null): UUID[] {
  const shared = new Set<UUID>();
  for (const id of own) if (other.has(id)) shared.add(id);
  for (const id of own) {
    const parent = parentOf(id);
    if (parent !== null && other.has(parent)) shared.add(parent);
  }
  for (const id of other) {
    const parent = parentOf(id);
    if (parent !== null && own.has(parent)) shared.add(parent);
  }
  return [...shared].sort();
}
