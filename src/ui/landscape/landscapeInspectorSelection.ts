/**
 * The pure data-shaping half of `LandscapeInspectorContent.tsx`'s Selection/
 * Connections sections — split into its own file (not colocated with the
 * component) so it's independently unit-testable and doesn't trip
 * `react-refresh/only-export-components`, same "pure logic, separate file"
 * shape `landscapeFilter.ts` already gives `LandscapeFilterBar.tsx`.
 */
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from '../elements/attributesRecord';
import { INBOUND_VERB, OUTBOUND_VERB } from '../elements/relationshipVerbs';

export interface LandscapeInspectorNeighbour {
  relationshipId: UUID;
  otherId: UUID;
  otherName: string;
  outbound: boolean;
  /** The direction-correct canonical verb (`OUTBOUND_VERB`/`INBOUND_VERB`) — never the edge's own free-text `description`, which is always authored from the edge's `from` side and would read backwards for an inbound neighbour (`RemoveFromModelAction.tsx`'s own reason for the same choice). */
  verb: string;
  /** The `uses`/`flows_to` edge's own verb phrase (`description`), shown alongside `verb` as colour, not a replacement for it — `undefined` for `supports`/`owns` (no such attribute) or when never set. */
  description: string | undefined;
}

export interface LandscapeInspectorSupport {
  capabilityName: string;
  capabilityId: UUID;
  role: string | null;
}

/** `neighbours` for `LandscapeInspectorContent`, computed from the raw `uses`/`flows_to` edges `useLandscape` already loads — the same one-hop shape `LandscapePage.tsx`'s own `focusNeighbourCount` already counts, extended here to the full name/verb/direction list the Inspector's Connections section needs. */
export function landscapeInspectorNeighbours(
  focusedElementId: UUID,
  edges: readonly RelationshipsHeadRow[],
  namesById: ReadonlyMap<UUID, ElementsHeadRow>,
): LandscapeInspectorNeighbour[] {
  const result: LandscapeInspectorNeighbour[] = [];
  for (const edge of edges) {
    const outbound = edge.from_element_id === focusedElementId;
    const inbound = edge.to_element_id === focusedElementId;
    if (!outbound && !inbound) continue;
    const otherId = outbound ? edge.to_element_id : edge.from_element_id;
    const otherName = namesById.get(otherId)?.name ?? otherId;
    const verb = outbound ? OUTBOUND_VERB[edge.relationship_type] : INBOUND_VERB[edge.relationship_type];
    const rawDescription = attributesRecord(edge.attributes).description;
    const description = typeof rawDescription === 'string' && rawDescription.trim().length > 0 ? rawDescription : undefined;
    result.push({ relationshipId: edge.relationship_id, otherId, otherName, outbound, verb, description });
  }
  return result;
}

/**
 * "Supports with roles" for `LandscapeInspectorContent`'s Selection section
 * — every live `supports` edge from `focusedElementId`, named by its
 * level-1 ancestor (`l1AncestorByCapabilityId`, already fetched by
 * `useLandscape`) rather than the exact leaf capability, the same
 * swim-lane-name convention the canvas itself already shows for this edge
 * (a second, leaf-level fetch isn't worth adding just for this one row).
 */
export function landscapeInspectorSupports(
  focusedElementId: UUID,
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
): LandscapeInspectorSupport[] {
  const result: LandscapeInspectorSupport[] = [];
  for (const edge of supportsEdges) {
    if (edge.from_element_id !== focusedElementId) continue;
    const l1 = l1AncestorByCapabilityId.get(edge.to_element_id);
    if (!l1) continue;
    const role = attributesRecord(edge.attributes).role;
    result.push({ capabilityId: l1.element_id, capabilityName: l1.name, role: typeof role === 'string' ? role : null });
  }
  return result;
}
