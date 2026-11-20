import type { RelationshipsHeadRow } from '../../contracts/rows';

/**
 * The role a newly created system gets on the capability it is created for: the capability's first supporter is its main one,
 * so it is `primary` when nothing is primary yet and `secondary` otherwise. Existing links are never touched.
 */
export function roleForNewSupporter(supportsEdges: readonly Pick<RelationshipsHeadRow, 'to_element_id' | 'attributes'>[], capabilityId: string): 'primary' | 'secondary' {
  const hasPrimary = supportsEdges.some((r) => r.to_element_id === capabilityId && (r.attributes as { role?: unknown } | null)?.role === 'primary');
  return hasPrimary ? 'secondary' : 'primary';
}
