/**
 * Sprint U4-2b item 13: "Landscape on mobile (<768px): render a list, not
 * the canvas." A grouping, not a diagram — the same classification
 * `layout.ts`'s `computeLandscapeLayout` uses to decide which lane a
 * system's tile belongs in (`groupSystemsByLane`, shared with this module
 * rather than duplicated), minus every pixel concern that function also
 * has: no `x`/`y`, no row-wrapping, no worker. `useIsNarrowViewport(768)`
 * (the same hook `LandscapePage.tsx`'s own "+ Add" disclosure already
 * uses) decides which of this or `LandscapeCanvas` actually mounts —
 * desktop's canvas is unchanged, this is a second renderer for the same
 * data, not a replacement.
 *
 * Ordering (item 13's own words): "actors first ... Unassigned last."
 * Actors aren't a *lane* at all on the canvas (`layout.ts`'s own top
 * comment — they get their own row above every lane, boundary included),
 * so here they're their own leading group, structurally distinct from
 * `LandscapeGroup` (no lane key, no capability). External isn't named in
 * item 13's own ordering at all; placed last of all — after Unassigned,
 * never inside it — matching the one placement rule the item *does* leave
 * unambiguous by extension: the desktop canvas already puts External
 * outside (visually below) everything Unassigned sits inside of (the
 * enterprise boundary), so "even later than last" is the one reading
 * consistent with that existing rule, not an arbitrary tie-break.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';
import { EXTERNAL_LANE_KEY, groupSystemsByLane, OT_ZONE_LANE_KEY, PLATFORM_BAND_KEY, UNASSIGNED_LANE_KEY, type LandscapeLaneRegion } from './layout';

export interface LandscapeGroupMember {
  system: ElementsHeadRow;
  /** Same "+N" fallback-placement marker `layout.ts`'s own nodes carry — item 13's own "'+N' chip" on a system row. Never set on a secondary-supporter member (below) — "+N" marks a *primary* placement that fell back to "most recently added," which doesn't apply to a system merely also-supporting this lane. */
  extraLaneCount?: number;
  /** Outbound `uses`/`flows_to` edge count — item 13's "uses N". */
  usesCount: number;
  /** Inbound `uses`/`flows_to` edge count — item 13's "used by N". */
  usedByCount: number;
  /**
   * Secondary-supporter wording: "expanded groups list every supporting
   * system with a role tag." `undefined` only for the four non-capability
   * lanes (Unassigned/External/OT/Platforms) — a system lands there by
   * placement fallback, not because of a specific `supports` edge into
   * *that* lane, so "primary"/"secondary" has no real edge to name. Every
   * genuine capability lane's members always get one: `'primary'` for the
   * anchored member (matching whichever edge actually holds
   * `role: 'primary'` for it, or — the "most recently added" fallback
   * `layout.ts`'s own module comment describes — the one edge assigning it
   * here at all when none is), `'secondary'` for every system merged in
   * from `referencedBy` below (an edge into a lane that isn't a system's
   * own anchor is never the anchor `role: 'primary'` edge, so this is
   * always correct without a second lookup).
   */
  role?: 'primary' | 'secondary';
}

export interface LandscapeGroup {
  key: string;
  label: string;
  region: LandscapeLaneRegion;
  members: LandscapeGroupMember[];
  /** Item 13's "shared-system chips": the *other* systems that reference into this lane without a tile of their own here (`layout.ts`'s own `referenceMarkers`, resolved to real rows) — real content this list would otherwise drop on the floor relative to the desktop canvas, which shows them as chips at the band's own right edge. */
  referencedBy: ElementsHeadRow[];
}

export interface LandscapeGroups {
  actors: ElementsHeadRow[];
  /** Capability lanes (by name), then Unassigned, then External last — see this module's own top comment for why External sits outside this ordering's own explicit words. */
  groups: LandscapeGroup[];
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

/**
 * @param systems Landscape nodes (src/db/landscape.ts's `listSystemsForLandscape`).
 * @param supportsEdges `supports` relationships from a system to a capability — the exact same input `computeLandscapeLayout` takes, for the exact same lane assignment.
 * @param l1AncestorByCapabilityId Every capability actually named by `supportsEdges`' targets, mapped to its own level-1 ancestor row — same shape `computeLandscapeLayout` takes.
 * @param actors Actors — item 13's own leading group.
 * @param edges `uses`/`flows_to` relationships between systems (`listLandscapeEdges`) — the same edges the desktop canvas draws, read here only to count each system's own "uses N · used by N", never rendered as a line (this is a list, not a diagram).
 */
export function computeLandscapeGroups(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
  actors: readonly ElementsHeadRow[],
  edges: readonly RelationshipsHeadRow[],
): LandscapeGroups {
  const { boundaryKeys, hasExternalLane, byLane, l1CapabilitiesById, extraLaneCountByElementId, referenceTargets } = groupSystemsByLane(systems, supportsEdges, l1AncestorByCapabilityId);

  // Secondary-supporter wording: this file's own copy of `layout.ts`'s
  // identical grouping (that module's `supportsBySystem` is private to its
  // own `groupSystemsByLane`) — `role` below is the only thing that needs
  // it here.
  const supportsBySystem = new Map<UUID, RelationshipsHeadRow[]>();
  for (const edge of supportsEdges) {
    const list = supportsBySystem.get(edge.from_element_id) ?? [];
    list.push(edge);
    supportsBySystem.set(edge.from_element_id, list);
  }

  const usesCountByElementId = new Map<UUID, number>();
  const usedByCountByElementId = new Map<UUID, number>();
  for (const edge of edges) {
    usesCountByElementId.set(edge.from_element_id, (usesCountByElementId.get(edge.from_element_id) ?? 0) + 1);
    usedByCountByElementId.set(edge.to_element_id, (usedByCountByElementId.get(edge.to_element_id) ?? 0) + 1);
  }

  const systemsById = new Map(systems.map((s) => [s.element_id, s]));
  const referencedByLaneKey = new Map<string, ElementsHeadRow[]>();
  for (const ref of referenceTargets) {
    const referrer = systemsById.get(ref.elementId);
    if (!referrer) continue;
    const list = referencedByLaneKey.get(ref.laneKey) ?? [];
    list.push(referrer);
    referencedByLaneKey.set(ref.laneKey, list);
  }

  function buildGroup(key: string, region: LandscapeLaneRegion): LandscapeGroup {
    const label = key === EXTERNAL_LANE_KEY ? 'External' : key === OT_ZONE_LANE_KEY ? 'OT' : key === PLATFORM_BAND_KEY ? 'Platforms' : key === UNASSIGNED_LANE_KEY ? 'Unassigned' : (l1CapabilitiesById.get(key)?.name ?? 'Unassigned');
    // A genuine capability lane's own key is that capability's element id
    // (`l1CapabilitiesById.has(key)`) — the four special lanes never have a
    // real `supports` edge naming them, so `role` stays `undefined` there
    // (this member interface's own doc comment explains why).
    const isCapabilityLane = l1CapabilitiesById.has(key);
    function roleFor(systemId: UUID): 'primary' | 'secondary' | undefined {
      if (!isCapabilityLane) return undefined;
      const ownEdges = (supportsBySystem.get(systemId) ?? []).filter((e) => e.to_element_id === key);
      return ownEdges.some((e) => attributesRecord(e.attributes).role === 'primary') ? 'primary' : 'secondary';
    }
    const anchoredMembers: LandscapeGroupMember[] = (byLane.get(key) ?? []).map((system) => {
      const extraLaneCount = extraLaneCountByElementId.get(system.element_id);
      const usesCount = usesCountByElementId.get(system.element_id) ?? 0;
      const usedByCount = usedByCountByElementId.get(system.element_id) ?? 0;
      const role = roleFor(system.element_id);
      return { system, usesCount, usedByCount, ...(extraLaneCount === undefined ? {} : { extraLaneCount }), ...(role === undefined ? {} : { role }) };
    });
    const referencedBy = [...(referencedByLaneKey.get(key) ?? [])].sort(byNameThenId);
    // Secondary-supporter wording: merged into `members` too — every
    // referencing system is, by construction, a `secondary` supporter of
    // this lane (see this member field's own doc comment for why no
    // lookup is needed to know that).
    const referencedMembers: LandscapeGroupMember[] = referencedBy.map((system) => ({
      system,
      usesCount: usesCountByElementId.get(system.element_id) ?? 0,
      usedByCount: usedByCountByElementId.get(system.element_id) ?? 0,
      role: 'secondary',
    }));
    const members = [...anchoredMembers, ...referencedMembers];
    return { key, label, region, members, referencedBy };
  }

  const groups: LandscapeGroup[] = boundaryKeys.map((key) => buildGroup(key, key === UNASSIGNED_LANE_KEY ? 'unassigned' : key === OT_ZONE_LANE_KEY ? 'ot' : key === PLATFORM_BAND_KEY ? 'platform' : 'capability'));
  if (hasExternalLane) groups.push(buildGroup(EXTERNAL_LANE_KEY, 'external'));

  return { actors: [...actors].sort(byNameThenId), groups };
}
