/**
 * Which capabilities a decision concerns, decided from structured links only.
 *
 * The decision page records concerns as `decision_links` rows. A capability
 * linked directly is a concern. A system, container or module linked directly
 * brings the capabilities it `supports` at main's head. Nothing is inferred
 * from the decision's words: a link that wasn't recorded is not guessed.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { DecisionLinkRow } from '../../db/types';

export interface CapabilityConcern {
  id: UUID;
  name: string;
}

/** A linked element whose `supports` edges name the capabilities it serves. */
const SUPPORTING_TYPES = new Set(['system', 'container', 'module']);

function linkedElements(
  links: readonly DecisionLinkRow[],
  elements: ReadonlyMap<UUID, ElementsHeadRow>,
): { capabilities: CapabilityConcern[]; supportingIds: UUID[] } {
  const capabilities: CapabilityConcern[] = [];
  const supportingIds: UUID[] = [];
  for (const link of links) {
    if (link.linked_type !== 'element') continue;
    const element = elements.get(link.linked_id);
    if (element === undefined) continue;
    if (element.element_type === 'capability') capabilities.push({ id: element.element_id, name: element.name });
    else if (SUPPORTING_TYPES.has(element.element_type)) supportingIds.push(element.element_id);
  }
  return { capabilities, supportingIds };
}

/** Capabilities linked directly as concerns, in the decision's own link order. */
export function directlyLinkedCapabilities(
  links: readonly DecisionLinkRow[],
  elements: ReadonlyMap<UUID, ElementsHeadRow>,
): CapabilityConcern[] {
  return linkedElements(links, elements).capabilities;
}

/** Linked systems, containers and modules whose supported capabilities are also concerns. */
export function linkedSupportingSystemIds(
  links: readonly DecisionLinkRow[],
  elements: ReadonlyMap<UUID, ElementsHeadRow>,
): UUID[] {
  return [...new Set(linkedElements(links, elements).supportingIds)];
}

/** The `supports` targets of the given systems, in edge order, deduplicated. */
export function supportedCapabilityIds(systemIds: readonly UUID[], edges: readonly RelationshipsHeadRow[]): UUID[] {
  if (systemIds.length === 0) return [];
  const sources = new Set(systemIds);
  const ids: UUID[] = [];
  const seen = new Set<UUID>();
  for (const edge of edges) {
    if (edge.relationship_type !== 'supports') continue;
    if (!sources.has(edge.from_element_id)) continue;
    if (seen.has(edge.to_element_id)) continue;
    seen.add(edge.to_element_id);
    ids.push(edge.to_element_id);
  }
  return ids;
}

/** Merge direct and supported capabilities, keeping direct ones first. */
export function mergeCapabilityConcerns(
  direct: readonly CapabilityConcern[],
  supported: readonly CapabilityConcern[],
): CapabilityConcern[] {
  const out: CapabilityConcern[] = [];
  const seen = new Set<string>();
  for (const concern of [...direct, ...supported]) {
    if (concern.name.trim() === '') continue;
    const key = concern.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(concern);
  }
  return out;
}
