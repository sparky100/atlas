/**
 * The landscape's layout algorithm (UI-principles.md §6.1/§6.4): systems in
 * swim-lanes by the level-1 capability they `support`, actors above the
 * top band, an enterprise boundary around the internal lanes, externals
 * outside it. Pure and deterministic — CLAUDE.md rule 6 ("no Math.random in
 * anything deterministic") — the same inputs always produce the same
 * output: grouping and ordering are total orders over real data (capability
 * name/id, system/actor name/id), never a randomised placement, and
 * wrapping/band height are computed against `LAYOUT_WIDTH`, a fixed design
 * width, not a live viewport size — the canvas fits *that* to whatever
 * on-screen size it actually has (`LandscapeCanvas.tsx`'s own fit-to-view),
 * the same way this always has for zoom; a saved `view_layouts` position
 * hint would otherwise go stale every time a window resized.
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
 * below, rendered by `LandscapeCanvas.tsx` as a small chip at the band's
 * own right edge, never inline in the lane's header text and never a
 * duplicate node. With no `role: 'primary'` edge at all, the most recently
 * added edge decides (delta ids are UUID v7 — chronologically sortable as
 * plain strings, so no extra timestamp lookup is needed) — and picking a
 * lane that way, rather than a person choosing it, is itself worth a
 * visible hint: `extraLaneCount` on that node marks it "+N" that placement
 * was default, not deliberate.
 *
 * Landscape canvas, structural (this pass): lanes now span `LAYOUT_WIDTH`
 * in full regardless of member count (item 2's "each level-1 lane spans
 * the canvas width"); a lane's members wrap left-to-right into rows within
 * that width rather than growing an ever-wider single row, so band height
 * genuinely "fits content" — one row's height for a handful of systems,
 * more for a crowded lane. A lane with no primary members (whether it has
 * never had one, or exists only because another lane's system references
 * it) collapses to its header line's own height, no reserved empty row.
 * Lane order is capability lanes by name, then Unassigned last — External
 * is no longer part of that ordered, boundary-enclosed list at all: every
 * `isExternal` system instead lands in its own band, placed *after* a gap
 * below the enterprise boundary (`boundary`, the y-range the boundary-
 * enclosed lanes span) rather than being one more lane inside it, matching
 * the C4 landscape convention item 3 asked for. Actors (both external and
 * internal) get their own wrapped row above everything, including the
 * boundary — `actorNodes`, laid out the same way a lane's members are, just
 * with no lane of their own to belong to.
 */
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { attributesRecord } from '../elements/attributesRecord';

export const EXTERNAL_LANE_KEY = '$external';
export const UNASSIGNED_LANE_KEY = '$unassigned';

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 48;
const NODE_GUTTER_X = 24;
const NODE_GUTTER_Y = 16;
const LANE_GUTTER_Y = 32;
/** A collapsed (member-less) lane's own trailing gap — far smaller than a populated lane's, since there's no content row to separate from the next lane, only the header line itself (item 2's "empty lanes collapse to a header line"). */
const EMPTY_LANE_GUTTER_Y = 8;
const LANE_LABEL_HEIGHT = 28;
const PADDING = 32;
/** Between the actor row and the enterprise boundary's own top edge. */
const ACTOR_GUTTER_Y = 24;
/** Between the enterprise boundary's own bottom edge and the external band below it — the visual separation that *is* "externals outside it" (item 3). */
const EXTERNAL_GUTTER_Y = 32;
/** Margin the boundary rectangle is drawn outside the lanes it encloses. */
const BOUNDARY_MARGIN = 8;

/** The fixed design width every band spans (item 2: "each level-1 lane spans the canvas width") — independent of the live viewport; `LandscapeCanvas.tsx`'s fit-to-view scales this to whatever on-screen size the canvas actually has, the same way it already does for zoom. Also how many systems/actors fit per wrapped row is computed. */
export const LAYOUT_WIDTH = 1280;
const AVAILABLE_ROW_WIDTH = LAYOUT_WIDTH - 2 * PADDING;
const ITEMS_PER_ROW = Math.max(1, Math.floor((AVAILABLE_ROW_WIDTH + NODE_GUTTER_X) / (NODE_WIDTH + NODE_GUTTER_X)));

const REFERENCE_CHIP_WIDTH = 108;
const REFERENCE_CHIP_HEIGHT = 18;
const REFERENCE_CHIP_GUTTER = 6;

export interface LandscapeNodePosition {
  elementId: UUID;
  x: number;
  y: number;
  /** Set only when this lane was picked by the "no primary -> most recently added" fallback and the system also touches other level-1 lanes — the count of those other lanes (B4's "+N chip listing the rest"). `undefined` for a system with an explicit primary, or with nothing else to reference. */
  extraLaneCount?: number;
}

/** A system's own reference into a level-1 lane it supports but isn't placed in (B4: "other lanes show a linked chip, never a duplicate tile") — one entry per (system, other lane), positioned (item 2) as a small chip at that lane's own right edge, never text folded into the lane's own label. */
export interface LandscapeReferenceMarker {
  elementId: UUID;
  laneKey: string;
  x: number;
  y: number;
}

export type LandscapeLaneRegion = 'capability' | 'unassigned' | 'external';

export interface LandscapeLane {
  key: string;
  label: string;
  /** `'external'` lanes sit outside the enterprise boundary (`boundary`, below); `'capability'`/`'unassigned'` are what the boundary actually encloses. */
  region: LandscapeLaneRegion;
  y: number;
  height: number;
}

/** The enterprise boundary's own y-range (item 3) — spans every `'capability'`/`'unassigned'` lane, never an `'external'` one or the actor row above it. `LandscapeCanvas.tsx` draws the rectangle `BOUNDARY_MARGIN` outside this range; `top === bottom` for a model with no internal lanes at all (nothing to draw). */
export interface LandscapeBoundary {
  top: number;
  bottom: number;
}

export interface LandscapeLayout {
  nodes: LandscapeNodePosition[];
  /** Actors (item 3), above the top band — laid out the same wrapped-row shape as a lane's own members, just with no lane to belong to. */
  actorNodes: LandscapeNodePosition[];
  lanes: LandscapeLane[];
  referenceMarkers: LandscapeReferenceMarker[];
  boundary: LandscapeBoundary;
  width: number;
  height: number;
}

function isExternal(element: ElementsHeadRow): boolean {
  return attributesRecord(element.attributes).isExternal === true;
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

/** Capability lanes first (by name), Unassigned last (item 2) — External isn't part of this ordering at all any more, see this module's own top comment. */
function laneSortKey(key: string, l1CapabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): [number, string] {
  if (key === UNASSIGNED_LANE_KEY) return [1, ''];
  return [0, l1CapabilitiesById.get(key)?.name ?? key];
}

/** One row-wrapped block of members (a lane's systems, or the actor row) — left to right, wrapping at `ITEMS_PER_ROW`, top-anchored at `top`. `height` is exactly as tall as the rows actually used, `0` for an empty list. */
function layoutRow(members: readonly ElementsHeadRow[], top: number): { nodes: LandscapeNodePosition[]; height: number } {
  if (members.length === 0) return { nodes: [], height: 0 };
  const nodes = members.map((member, index) => {
    const row = Math.floor(index / ITEMS_PER_ROW);
    const col = index % ITEMS_PER_ROW;
    return { elementId: member.element_id, x: PADDING + col * (NODE_WIDTH + NODE_GUTTER_X), y: top + row * (NODE_HEIGHT + NODE_GUTTER_Y) };
  });
  const rows = Math.ceil(members.length / ITEMS_PER_ROW);
  const height = rows * NODE_HEIGHT + (rows - 1) * NODE_GUTTER_Y;
  return { nodes, height };
}

/**
 * @param systems Landscape nodes (src/db/landscape.ts's `listSystemsForLandscape`).
 * @param supportsEdges `supports` relationships from a system to a capability (`listSupportsEdgesForSystems`) — used only for lane assignment, never rendered as edges themselves (§6.1: landscape edges are `uses`/`flows_to` only).
 * @param l1AncestorByCapabilityId Every capability actually named by `supportsEdges`' targets, mapped to its own level-1 ancestor row (itself, if it already is one) — `src/ui/elements/capabilityDepth.ts`'s `l1AncestorOf`, resolved by the caller for each distinct target id. Lane labels come from these ancestor rows' own names, never a leaf sub-capability's.
 * @param actors Actors (`src/db/landscape.ts`'s `listActorsForLandscape`) — item 3's own top row, both external and internal together (visually distinguished, not separately grouped — `LandscapeCanvas.tsx`'s own concern).
 */
export function computeLandscapeLayout(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
  actors: readonly ElementsHeadRow[] = [],
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
  const referenceTargets: { elementId: UUID; laneKey: string }[] = [];
  const extraLaneCountByElementId = new Map<UUID, number>();

  for (const system of systems) {
    const placement = placementFor(system, supportsBySystem.get(system.element_id) ?? [], l1AncestorByCapabilityId);
    const members = byLane.get(placement.primaryLaneKey) ?? [];
    members.push(system);
    byLane.set(placement.primaryLaneKey, members);

    for (const otherLaneKey of placement.otherLaneKeys) {
      referenceTargets.push({ elementId: system.element_id, laneKey: otherLaneKey });
      if (!byLane.has(otherLaneKey)) byLane.set(otherLaneKey, []);
    }
    if (placement.isFallback && placement.otherLaneKeys.length > 0) extraLaneCountByElementId.set(system.element_id, placement.otherLaneKeys.length);
  }

  const boundaryKeys = [...byLane.keys()]
    .filter((k) => k !== EXTERNAL_LANE_KEY)
    .sort((a, b) => {
      const [ra, na] = laneSortKey(a, l1CapabilitiesById);
      const [rb, nb] = laneSortKey(b, l1CapabilitiesById);
      return ra - rb || na.localeCompare(nb) || a.localeCompare(b);
    });
  const hasExternalLane = byLane.has(EXTERNAL_LANE_KEY);

  const lanes: LandscapeLane[] = [];
  const nodes: LandscapeNodePosition[] = [];
  const referenceMarkers: LandscapeReferenceMarker[] = [];
  let y = PADDING;

  const actorRow = layoutRow([...actors].sort(byNameThenId), y);
  if (actorRow.nodes.length > 0) y += actorRow.height + ACTOR_GUTTER_Y;

  const boundaryTop = y;

  function placeLane(key: string, region: LandscapeLaneRegion): void {
    const members = [...(byLane.get(key) ?? [])].sort(byNameThenId);
    const label = key === EXTERNAL_LANE_KEY ? 'External' : key === UNASSIGNED_LANE_KEY ? 'Unassigned' : (l1CapabilitiesById.get(key)?.name ?? 'Unassigned');
    const row = layoutRow(members, y + LANE_LABEL_HEIGHT);
    const laneHeight = members.length === 0 ? LANE_LABEL_HEIGHT + EMPTY_LANE_GUTTER_Y : LANE_LABEL_HEIGHT + row.height + LANE_GUTTER_Y;
    lanes.push({ key, label, region, y, height: laneHeight });

    for (const node of row.nodes) {
      const extraLaneCount = extraLaneCountByElementId.get(node.elementId);
      nodes.push(extraLaneCount === undefined ? node : { ...node, extraLaneCount });
    }

    // The band's own right-edge reference chips (item 2 — never folded
    // into the label text) — stacked leftward from the right edge, one per
    // referencing system, at the header line's own height so even a
    // collapsed (member-less) lane still shows them.
    const refs = referenceTargets.filter((r) => r.laneKey === key);
    refs.forEach((ref, index) => {
      const chipX = LAYOUT_WIDTH - PADDING - (index + 1) * (REFERENCE_CHIP_WIDTH + REFERENCE_CHIP_GUTTER) + REFERENCE_CHIP_GUTTER;
      referenceMarkers.push({ elementId: ref.elementId, laneKey: key, x: chipX, y: y + (LANE_LABEL_HEIGHT - REFERENCE_CHIP_HEIGHT) / 2 });
    });

    y += laneHeight;
  }

  for (const key of boundaryKeys) placeLane(key, key === UNASSIGNED_LANE_KEY ? 'unassigned' : 'capability');
  const boundaryBottom = y;

  if (hasExternalLane) {
    y += EXTERNAL_GUTTER_Y;
    placeLane(EXTERNAL_LANE_KEY, 'external');
  }

  return {
    nodes,
    actorNodes: actorRow.nodes,
    lanes,
    referenceMarkers,
    boundary: { top: boundaryTop, bottom: boundaryBottom },
    width: LAYOUT_WIDTH,
    height: y + PADDING,
  };
}

export { BOUNDARY_MARGIN };
