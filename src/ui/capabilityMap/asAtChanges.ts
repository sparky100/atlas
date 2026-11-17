import type { UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';

/**
 * Capabilities whose picture differs between today and a future date: one that
 * only exists by then, or whose set of supporting systems is not the same.
 * (A capability that goes away by the date is not on the map, so it is not listed.)
 * Both edge lists are the "supports" links in force on their own day.
 */
export function capabilitiesChangedByDate(
  todayCapabilityIds: ReadonlySet<UUID>,
  futureCapabilityIds: ReadonlySet<UUID>,
  todaySupports: readonly RelationshipsHeadRow[],
  futureSupports: readonly RelationshipsHeadRow[],
): Set<UUID> {
  const supportersOf = (edges: readonly RelationshipsHeadRow[]): Map<UUID, Set<UUID>> => {
    const byCapability = new Map<UUID, Set<UUID>>();
    for (const edge of edges) {
      if (edge.relationship_type !== 'supports') continue;
      const set = byCapability.get(edge.to_element_id) ?? new Set<UUID>();
      set.add(edge.from_element_id);
      byCapability.set(edge.to_element_id, set);
    }
    return byCapability;
  };
  const today = supportersOf(todaySupports);
  const future = supportersOf(futureSupports);
  const changed = new Set<UUID>();
  for (const id of futureCapabilityIds) {
    if (!todayCapabilityIds.has(id)) {
      changed.add(id);
      continue;
    }
    const a = today.get(id) ?? new Set<UUID>();
    const b = future.get(id) ?? new Set<UUID>();
    if (a.size !== b.size || [...a].some((s) => !b.has(s))) changed.add(id);
  }
  return changed;
}
