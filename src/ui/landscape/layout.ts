/**
 * The landscape's layout algorithm (UI-principles.md §6.1/§6.4): systems in
 * swim-lanes by the capability they `support`, externals in a bottom lane,
 * positions within a lane are hints. Pure and deterministic — CLAUDE.md
 * rule 6 ("no Math.random in anything deterministic") — the same inputs
 * always produce the same output, with no seed to thread through, because
 * nothing here is random to begin with: grouping and ordering are total
 * orders over real data (capability name/id, system name/id), not a
 * randomised placement.
 *
 * Sprint U1 step 4a runs this synchronously on the main thread; moving it
 * into a Web Worker (UI-principles §8.6) is step 4b's job and does not
 * change this function's signature or behaviour, only where it's called
 * from.
 *
 * Sprint U4-1 B4: lanes are level-1 capabilities only, never a leaf
 * sub-capability — every `supports` edge rolls up to its level-1 ancestor
 * (`src/ui/elements/capabilityDepth.ts`'s `l1AncestorOf`, walked by the
 * caller and handed in here already resolved, per capability id). A
 * system's own tile still appears exactly once, in its *primary* lane
 * (`SupportsAttributes.role`); every other level-1 lane it also supports
 * gets a reference marker instead of a second tile — `referenceMarkers`
 * below, rendered by `LandscapeCanvas.tsx` as a small linked chip, never a
 * duplicate node. With no `role: 'primary'` edge at all, the most recently
 * added edge decides (delta ids are UUID v7 — chronologically sortable as
 * plain strings, so no extra timestamp lookup is needed) — and picking a
 * lane that way, rather than a person choosing it, is itself worth a
 * visible hint: `extraLaneCount` on that node marks it "+N" that placement
 * was default, not deliberate.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export const EXTERNAL_LANE_KEY = '$external';
export const UNASSIGNED_LANE_KEY = '$unassigned';

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 48;
const NODE_GUTTER_X = 24;
const LANE_GUTTER_Y = 32;
const LANE_LABEL_HEIGHT = 28;
const PADDING = 32;

export interface LandscapeNodePosition {
  elementId: UUID;
  x: number;
  y: number;
  /** Set only when this lane was picked by the "no primary -> most recently added" fallback and the system also touches other level-1 lanes — the count of those other lanes (B4's "+N chip listing the rest"). `undefined` for a system with an explicit primary, or with nothing else to reference. */
  extraLaneCount?: number;
}

/** A system's own reference into a level-1 lane it supports but isn't placed in (B4: "other lanes show a linked reference chip, never a duplicate tile") — one entry per (system, other lane), rendered small and non-duplicative alongside that lane's real tiles. */
export interface LandscapeReferenceMarker {
  elementId: UUID;
  laneKey: string;
}

export interface LandscapeLane {
  key: string;
  label: string;
  y: number;
  height: number;
}

export interface LandscapeLayout {
  nodes: LandscapeNodePosition[];
  lanes: LandscapeLane[];
  referenceMarkers: LandscapeReferenceMarker[];
  width: number;
  height: number;
}

function isExternal(system: ElementsHeadRow): boolean {
  return attributesRecord(system.attributes).isExternal === true;
}

function isPrimary(edge: RelationshipsHeadRow): boolean {
  return attributesRecord(edge.attributes).role === 'primary';
}

interface ResolvedEdge {
  edge: RelationshipsHeadRow;
  /** The level-1 ancestor's own element id — the actual lane key. */
  laneKey: UUID;
}

interface LanePlacement {
  primaryLaneKey: string;
  /** Every other level-1 lane this system's edges also resolve to, distinct, excluding `primaryLaneKey`. */
  otherLaneKeys: UUID[];
  /** True only when `primaryLaneKey` was picked by recency, not by an explicit `role: 'primary'` edge. */
  isFallback: boolean;
}

/**
 * One system's lane placement (B4's whole placement rule, see this
 * module's own top comment). `l1AncestorByCapabilityId` maps a supported
 * capability's id — leaf, mid, or root — to its own level-1 ancestor row;
 * an edge whose target isn't in that map (capability not found, or its
 * chain doesn't resolve within 3 levels) is dropped rather than crashing,
 * the same "shown as a gap" stance `capabilityDepth.ts` takes throughout.
 */
function placementFor(system: ElementsHeadRow, supportsEdges: readonly RelationshipsHeadRow[], l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>): LanePlacement {
  if (isExternal(system)) return { primaryLaneKey: EXTERNAL_LANE_KEY, otherLaneKeys: [], isFallback: false };

  const resolved: ResolvedEdge[] = [];
  for (const edge of supportsEdges) {
    const l1 = l1AncestorByCapabilityId.get(edge.to_element_id);
    if (l1) resolved.push({ edge, laneKey: l1.element_id });
  }
  if (resolved.length === 0) return { primaryLaneKey: UNASSIGNED_LANE_KEY, otherLaneKeys: [], isFallback: false };

  const distinctLaneKeys = [...new Set(resolved.map((r) => r.laneKey))];
  const primaryEdge = resolved.find((r) => isPrimary(r.edge));

  let primaryLaneKey: UUID;
  let isFallback: boolean;
  if (primaryEdge) {
    primaryLaneKey = primaryEdge.laneKey;
    isFallback = false;
  } else {
    // UUID v7 delta ids sort chronologically as plain strings — "most
    // recently added" needs no extra timestamp lookup.
    const mostRecent = resolved.reduce((latest, r) => (r.edge.exists_delta_id > latest.edge.exists_delta_id ? r : latest));
    primaryLaneKey = mostRecent.laneKey;
    isFallback = distinctLaneKeys.length > 1;
  }

  return { primaryLaneKey, otherLaneKeys: distinctLaneKeys.filter((k) => k !== primaryLaneKey), isFallback };
}

function byNameThenId(a: ElementsHeadRow, b: ElementsHeadRow): number {
  return a.name.localeCompare(b.name) || a.element_id.localeCompare(b.element_id);
}

function laneSortKey(key: string, l1CapabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): [number, string] {
  // Capability lanes first (ordered by name), then unassigned, then
  // external always last — §6.1's "externals in a bottom lane" is literal.
  if (key === EXTERNAL_LANE_KEY) return [2, ''];
  if (key === UNASSIGNED_LANE_KEY) return [1, ''];
  return [0, l1CapabilitiesById.get(key)?.name ?? key];
}

/**
 * @param systems Landscape nodes (src/db/landscape.ts's `listSystemsForLandscape`).
 * @param supportsEdges `supports` relationships from a system to a capability (`listSupportsEdgesForSystems`) — used only for lane assignment, never rendered as edges themselves (§6.1: landscape edges are `uses`/`flows_to` only).
 * @param l1AncestorByCapabilityId Every capability actually named by `supportsEdges`' targets, mapped to its own level-1 ancestor row (itself, if it already is one) — `src/ui/elements/capabilityDepth.ts`'s `l1AncestorOf`, resolved by the caller for each distinct target id. Lane labels come from these ancestor rows' own names, never a leaf sub-capability's.
 */
export function computeLandscapeLayout(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
): LandscapeLayout {
  const supportsBySystem = new Map<UUID, RelationshipsHeadRow[]>();
  for (const edge of supportsEdges) {
    const list = supportsBySystem.get(edge.from_element_id) ?? [];
    list.push(edge);
    supportsBySystem.set(edge.from_element_id, list);
  }

  const l1CapabilitiesById = new Map<UUID, ElementsHeadRow>();
  for (const capability of l1AncestorByCapabilityId.values()) l1CapabilitiesById.set(capability.element_id, capability);

  const byLane = new Map<string, ElementsHeadRow[]>();
  const referenceMarkers: LandscapeReferenceMarker[] = [];
  const extraLaneCountByElementId = new Map<UUID, number>();

  for (const system of systems) {
    const placement = placementFor(system, supportsBySystem.get(system.element_id) ?? [], l1AncestorByCapabilityId);
    const members = byLane.get(placement.primaryLaneKey) ?? [];
    members.push(system);
    byLane.set(placement.primaryLaneKey, members);

    for (const otherLaneKey of placement.otherLaneKeys) {
      referenceMarkers.push({ elementId: system.element_id, laneKey: otherLaneKey });
      if (!byLane.has(otherLaneKey)) byLane.set(otherLaneKey, []);
    }
    if (placement.isFallback && placement.otherLaneKeys.length > 0) extraLaneCountByElementId.set(system.element_id, placement.otherLaneKeys.length);
  }

  const laneKeys = [...byLane.keys()].sort((a, b) => {
    const [ra, na] = laneSortKey(a, l1CapabilitiesById);
    const [rb, nb] = laneSortKey(b, l1CapabilitiesById);
    return ra - rb || na.localeCompare(nb) || a.localeCompare(b);
  });

  const nodes: LandscapeNodePosition[] = [];
  const lanes: LandscapeLane[] = [];
  let y = PADDING;
  let maxWidth = 0;

  for (const key of laneKeys) {
    const members = [...(byLane.get(key) ?? [])].sort(byNameThenId);
    const label = key === EXTERNAL_LANE_KEY ? 'External' : key === UNASSIGNED_LANE_KEY ? 'Unassigned' : (l1CapabilitiesById.get(key)?.name ?? 'Unassigned');
    const laneHeight = LANE_LABEL_HEIGHT + NODE_HEIGHT + LANE_GUTTER_Y;
    lanes.push({ key, label, y, height: laneHeight });

    members.forEach((system, index) => {
      const x = PADDING + index * (NODE_WIDTH + NODE_GUTTER_X);
      const extraLaneCount = extraLaneCountByElementId.get(system.element_id);
      nodes.push(extraLaneCount === undefined ? { elementId: system.element_id, x, y: y + LANE_LABEL_HEIGHT } : { elementId: system.element_id, x, y: y + LANE_LABEL_HEIGHT, extraLaneCount });
      maxWidth = Math.max(maxWidth, x + NODE_WIDTH + PADDING);
    });
    if (members.length === 0) maxWidth = Math.max(maxWidth, PADDING * 2);

    y += laneHeight;
  }

  return { nodes, lanes, referenceMarkers, width: maxWidth, height: y + PADDING };
}
