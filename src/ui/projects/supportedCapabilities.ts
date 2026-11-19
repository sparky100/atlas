import type { UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';

/** The capabilities a system supports, from its `supports` links (the system is the source of its own edge). Order of first appearance; each once. */
export function capabilityIdsSupportedBy(edges: readonly Pick<RelationshipsHeadRow, 'relationship_type' | 'from_element_id' | 'to_element_id'>[], systemId: UUID): UUID[] {
  const ids: UUID[] = [];
  for (const edge of edges) {
    if (edge.relationship_type === 'supports' && edge.from_element_id === systemId && !ids.includes(edge.to_element_id)) ids.push(edge.to_element_id);
  }
  return ids;
}

/** One sentence for the form, saying what was filled in (or why nothing was). No capability link recorded is not the same as no business use found. */
export function supportedCapabilitiesNotice(systemName: string, capabilityNames: readonly string[]): string {
  if (capabilityNames.length === 0) {
    return `${systemName} has no capability link recorded, so none could be filled in. Name a capability this project serves, or link the system to one first. No business use has been ruled in or out.`;
  }
  return `Added ${capabilityNames.length === 1 ? 'the capability' : 'the capabilities'} ${systemName} supports: ${capabilityNames.join(', ')}. Remove any this project does not serve.`;
}
