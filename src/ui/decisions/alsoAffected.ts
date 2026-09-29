/**
 * F6.3 (decision page rework, Part B), rule 8: "Also affected" — elements
 * an option's own deltas touched that aren't among the decision's declared
 * concerns, plus the business/technical/service owners of everything
 * touched. Pure — `touch` (`optionTouch.ts`, own-deltas-derived) and every
 * `ownsEdges`/`elementsById` input are already fetched/computed for the
 * rest of the comparison (`compareOptions.ts`'s own projections, filtered
 * to `relationship_type === 'owns'`) — no new query.
 *
 * A removed (retired) element no longer exists in the option's own head
 * projection, so both its own row and its owners are read from *main's*
 * projection instead — main still has it (concerns are declared against
 * main, and a decision's own options only ever retire something main
 * still has). An added or changed element is read from the *option's*
 * own projection, since that's the side that actually has it.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { ownersByRole } from '../elements/ownersByRole';
import type { OptionTouch } from './optionTouch';

export interface AlsoAffectedElement {
  element: ElementsHeadRow;
  ownersByRole: Map<string, ElementsHeadRow[]>;
}

export function computeAlsoAffected(
  touch: OptionTouch,
  concernElementIds: ReadonlySet<UUID>,
  mainOwnsEdges: readonly RelationshipsHeadRow[],
  mainElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
  optionOwnsEdges: readonly RelationshipsHeadRow[],
  optionElementsById: ReadonlyMap<UUID, ElementsHeadRow>,
): AlsoAffectedElement[] {
  const retiredIds = new Set(touch.retiredElements.map((e) => e.id));
  const result: AlsoAffectedElement[] = [];
  for (const id of touch.touchedElementIds) {
    if (concernElementIds.has(id)) continue;
    const removed = retiredIds.has(id);
    const elementsById = removed ? mainElementsById : optionElementsById;
    const ownsEdges = removed ? mainOwnsEdges : optionOwnsEdges;
    const element = elementsById.get(id);
    if (!element) continue;
    result.push({ element, ownersByRole: ownersByRole(id, ownsEdges, elementsById) });
  }
  return result.sort((a, b) => a.element.name.localeCompare(b.element.name));
}
