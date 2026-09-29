/**
 * F6.3 (decision page rework, Part B), rule 8: "Also affected" — elements
 * an option's own diff touched that aren't among the decision's declared
 * concerns, plus the business/technical/service owners of everything
 * touched (concerns included, since an owner needs to know about a change
 * to their own system even when it's a declared concern). Pure — every
 * input (`diff`, `ownsEdges`, `elementsById`) is already fetched/computed
 * for the rest of the comparison (`compareOptions.ts`'s own
 * `loadProjectionAtCommitCached` result, filtered to `relationship_type
 * === 'owns'`, and `computeVersionDiff`'s own output) — no new query.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { VersionDiff } from '../../engine/versionDiff';
import { ownersByRole } from '../elements/ownersByRole';

export interface AlsoAffectedElement {
  element: ElementsHeadRow;
  ownersByRole: Map<string, ElementsHeadRow[]>;
}

/**
 * @param elementsById Every element either side of the diff could resolve to — the caller merges this option's own `elementsById` with main's (option winning), since a retired element only resolves on main's side and a newly added one only on the option's.
 */
export function computeAlsoAffected(diff: VersionDiff, concernElementIds: ReadonlySet<UUID>, ownsEdges: readonly RelationshipsHeadRow[], elementsById: ReadonlyMap<UUID, ElementsHeadRow>): AlsoAffectedElement[] {
  const touched = diff.elements.filter((e) => e.state !== 'unchanged' && !concernElementIds.has(e.elementId));
  const result: AlsoAffectedElement[] = [];
  for (const t of touched) {
    const element = elementsById.get(t.elementId);
    if (!element) continue;
    result.push({ element, ownersByRole: ownersByRole(t.elementId, ownsEdges, elementsById) });
  }
  return result.sort((a, b) => a.element.name.localeCompare(b.element.name));
}
