/**
 * Sprint U4-2a item 4's "search/filter" — a plain substring match across
 * everything the picker card itself shows on its face (title, sector,
 * version, summary), not `sourceDescription` (provenance, hidden behind
 * the card's info affordance — searching it would surface a match a
 * person can't see why they got without opening that disclosure first).
 * A blank query matches everything, unchanged order.
 */
import type { CapabilityMapRow } from '../../db/capabilityMapTemplates';

export function matchesCapabilityMapQuery(map: CapabilityMapRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return true;
  const haystack = [map.title, map.sector, `v${String(map.version)}`, map.summary].filter((v): v is string => v !== null).join(' ').toLowerCase();
  return haystack.includes(trimmed);
}

export function filterCapabilityMaps(maps: readonly CapabilityMapRow[], query: string): CapabilityMapRow[] {
  return maps.filter((map) => matchesCapabilityMapQuery(map, query));
}
