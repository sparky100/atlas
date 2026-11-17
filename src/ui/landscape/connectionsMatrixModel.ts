/**
 * The Landscape's Connections view: which capability areas send data to, or
 * rely on, which others, counted from the links already recorded. A pure view
 * over the Landscape's own groups and links — nothing is stored and there is no
 * layout of its own (a fixed grid in the Landscape's lane order).
 *
 * An area is a Landscape lane (a level 1 capability a system mainly supports,
 * plus the OT, platforms, unassigned and external lanes) and, for internal
 * actors, an "Actors" area. A system sits in exactly one area (its lane), so
 * every link between two placed ends lands in exactly one cell. A link routed
 * through an integration platform is still one link between its two real ends
 * (the platform is only its `via`), so it counts once.
 */
import type { UUID } from '../../contracts/delta';
import type { RelationshipsHeadRow } from '../../contracts/rows';
import type { LandscapeGroup } from './landscapeGroups';

export const ACTORS_AREA_KEY = '$actors';

/** `flows_to`: "A sends data to B". `uses`: "A relies on B". Never mixed. */
export type ConnectionKind = 'flows_to' | 'uses';

export interface ConnectionArea {
  key: string;
  label: string;
}

export interface ConnectionsMatrix {
  areas: ConnectionArea[];
  /** Links by `${fromAreaKey}|${toAreaKey}`. */
  cells: Map<string, RelationshipsHeadRow[]>;
  /** Links of this kind with an end that is not on the view (filtered out, or not a system or actor in an area). */
  unplaced: number;
}

export function connectionCellKey(fromAreaKey: string, toAreaKey: string): string {
  return `${fromAreaKey}|${toAreaKey}`;
}

export function buildConnectionsMatrix(groups: readonly Pick<LandscapeGroup, 'key' | 'label' | 'members'>[], internalActorIds: readonly UUID[], edges: readonly RelationshipsHeadRow[], kind: ConnectionKind): ConnectionsMatrix {
  const areas: ConnectionArea[] = [];
  const areaOf = new Map<UUID, string>();
  for (const group of groups) {
    if (group.members.length === 0) continue;
    areas.push({ key: group.key, label: group.label });
    for (const member of group.members) areaOf.set(member.system.element_id, group.key);
  }
  if (internalActorIds.length > 0) {
    areas.push({ key: ACTORS_AREA_KEY, label: 'Actors' });
    for (const id of internalActorIds) if (!areaOf.has(id)) areaOf.set(id, ACTORS_AREA_KEY);
  }
  const cells = new Map<string, RelationshipsHeadRow[]>();
  let unplaced = 0;
  for (const edge of edges) {
    if (edge.relationship_type !== kind) continue;
    const from = areaOf.get(edge.from_element_id);
    const to = areaOf.get(edge.to_element_id);
    if (from === undefined || to === undefined) {
      unplaced += 1;
      continue;
    }
    const key = connectionCellKey(from, to);
    const list = cells.get(key) ?? [];
    list.push(edge);
    cells.set(key, list);
  }
  return { areas, cells, unplaced };
}

/** Links of this kind between two ends on the view, plus those with an end that isn't — equals every link of the kind. */
export function connectionLinkCount(matrix: ConnectionsMatrix): number {
  let n = matrix.unplaced;
  for (const list of matrix.cells.values()) n += list.length;
  return n;
}
