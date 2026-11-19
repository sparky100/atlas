import type { Delta, RelationshipType, UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';
import { INBOUND_VERB } from './relationshipVerbs';

/**
 * Which of a retiring element's links a replacement can take over, and how.
 * Two kinds, both copies (the old element keeps its own until it ends):
 * capability links (`supports`, always copied as `secondary`, so they never
 * clash with a primary link the replacement already has) and interfaces
 * (`uses`, `flows_to`, either direction, attributes kept). `owns`, `replaces`
 * and `enables` are not about what a system does or connects to, so they stay.
 */
export interface CopyableEdge {
  relationshipId: UUID;
  type: 'supports' | 'uses' | 'flows_to';
  kind: 'capability' | 'interface';
  /** The element at the other end of the link. */
  otherId: UUID;
  /** True when the retiring element is the `from` end. */
  outbound: boolean;
  /** "Supports Housing Repairs", "Sends data to Billing Gateway" — the other end named in plain words. */
  label: string;
}

const COPYABLE: ReadonlySet<RelationshipType> = new Set<RelationshipType>(['supports', 'uses', 'flows_to']);

export function listCopyableEdges(elementId: UUID, relationships: readonly RelationshipsHeadRow[], nameOf: (id: UUID) => string | undefined): CopyableEdge[] {
  const out: CopyableEdge[] = [];
  for (const edge of relationships) {
    if (!COPYABLE.has(edge.relationship_type)) continue;
    const outbound = edge.from_element_id === elementId;
    if (!outbound && edge.to_element_id !== elementId) continue;
    // `supports` always runs system → capability, so only the outbound side counts.
    if (edge.relationship_type === 'supports' && !outbound) continue;
    const otherId = outbound ? edge.to_element_id : edge.from_element_id;
    // A link to itself has nothing to copy.
    if (otherId === elementId) continue;
    const type = edge.relationship_type as CopyableEdge['type'];
    const verb = type === 'flows_to' ? (outbound ? 'Sends data to' : 'Receives data from') : outbound ? (type === 'supports' ? 'Supports' : 'Uses') : INBOUND_VERB[type].replace(/^./, (c) => c.toUpperCase());
    const name = nameOf(otherId) ?? 'an element not named here';
    out.push({
      relationshipId: edge.relationship_id,
      type,
      kind: type === 'supports' ? 'capability' : 'interface',
      otherId,
      outbound,
      label: `${verb.trim()} ${name}`,
    });
  }
  return out;
}

/**
 * Deltas that copy the chosen links from `oldId` onto `newId`. `chosen`
 * absent means every copyable link. `alreadyThere` holds `type|from|to` keys
 * the new element has already, so nothing is duplicated.
 */
export function buildCopiedEdgeDeltas(input: {
  oldId: UUID;
  newId: UUID;
  relationships: readonly RelationshipsHeadRow[];
  chosen?: ReadonlySet<UUID> | undefined;
  alreadyThere?: ReadonlySet<string> | undefined;
  sourceId: UUID;
}): Delta[] {
  const { oldId, newId, relationships, chosen, alreadyThere, sourceId } = input;
  const deltas: Delta[] = [];
  const byId = new Map(relationships.map((r) => [r.relationship_id, r]));
  for (const copy of listCopyableEdges(oldId, relationships, () => undefined)) {
    if (chosen && !chosen.has(copy.relationshipId)) continue;
    const edge = byId.get(copy.relationshipId);
    if (!edge) continue;
    // The other end is the new element itself (A used B): that would be a link to itself.
    if (copy.otherId === newId) continue;
    const from = copy.outbound ? newId : copy.otherId;
    const to = copy.outbound ? copy.otherId : newId;
    if (alreadyThere?.has(`${copy.type}|${from}|${to}`)) continue;
    let attributes: Record<string, unknown>;
    if (copy.type === 'supports') {
      const description = attributesRecord(edge.attributes).description;
      attributes = typeof description === 'string' && description.trim() !== '' ? { role: 'secondary', description } : { role: 'secondary' };
    } else {
      attributes = { ...attributesRecord(edge.attributes) };
      // A route through the retiring platform itself would point at something going away.
      if (attributes.via === oldId) delete attributes.via;
    }
    deltas.push({
      kind: 'relationship.create',
      id: crypto.randomUUID(),
      relationshipId: crypto.randomUUID(),
      relationshipType: copy.type,
      fromElementId: from,
      toElementId: to,
      attributes,
      sourceId,
      confidence: 1,
    } as Delta);
  }
  return deltas;
}
