/**
 * The landscape's layout algorithm (UI-principles.md §6.1/§6.4): systems in
 * swim-lanes by the level-1 capability they `support`, actors above the
 * top band, an enterprise boundary around the internal lanes, externals
 * outside it. Pure and deterministic — CLAUDE.md rule 6 ("no Math.random in
 * anything deterministic") — the same inputs (including the width hint,
 * below) always produce the same output: grouping and ordering are total
 * orders over real data (capability name/id, system/actor name/id), never a
 * randomised placement.
 *
 * Sprint U4-2b item 7: wrapping/band height are computed against
 * `layoutWidthHint` (`computeLandscapeLayout`'s own last parameter) —
 * clamped to a `MIN_LAYOUT_WIDTH` floor, never a fixed design width any
 * more. Before item 6 removed `view_layouts` persistence for the landscape
 * kind entirely, a *live* width here would have gone stale the moment a
 * saved position was reused at a different window size than the one that
 * produced it; with nothing persisted and auto-layout running fresh on
 * every open (`useLandscape.ts`'s own comment), that risk is gone, so the
 * width can now genuinely track "the canvas's own on-screen size at layout
 * time" — `LandscapePage.tsx` measures `<main>` (`useCanvasWidth.ts`; the
 * canvas's own containing block once it's showing — `LandscapePage.module.css`'s
 * `.mainWithCanvas` comment) and hands the result to `useLandscape.ts`,
 * which passes it straight through here. A caller with no measurement yet
 * (or one that doesn't care, like this module's own tests) gets
 * `MIN_LAYOUT_WIDTH` via the parameter's own default.
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
 * Landscape canvas, structural (this pass): lanes now span the effective
 * layout width in full regardless of member count (item 2's "each level-1 lane spans
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
import { isNonApplicationKind } from '../elements/systemKind';
import { domainOf } from '../elements/systemDomain';

export const EXTERNAL_LANE_KEY = '$external';
export const UNASSIGNED_LANE_KEY = '$unassigned';
/**
 * Prompt 7k item 3: "OT systems grouped in a labelled zone inside the
 * enterprise boundary" — structurally analogous to `EXTERNAL_LANE_KEY`
 * (a system with `domain: 'ot'` is pulled out of its capability lane
 * placement the same way an external one is, before any `supports` edge
 * is even considered) but placed *inside* `boundaryKeys`, not outside it
 * the way External sits below the boundary. `hybrid` stays in its normal
 * capability lane — only a system whose domain resolves fully to `'ot'`
 * is zoned out; the external check still runs first (an external OT
 * system has no home inside the boundary at all, matching "outside" being
 * the more fundamental fact of the two).
 */
export const OT_ZONE_LANE_KEY = '$ot';
/**
 * Prompt 7k item 4: "a platform band along the bottom spanning the
 * capability lanes for non-application kinds" — structurally the same
 * shape as `OT_ZONE_LANE_KEY` (a non-`'application'`-kind system is pulled
 * out of capability-lane placement before any `supports` edge is
 * considered), placed inside the boundary and ordered last of all —
 * "along the bottom" read literally, after `OT_ZONE_LANE_KEY` and even
 * `UNASSIGNED_LANE_KEY`, a judgment call recorded here since the prompt
 * names no explicit order among the three. Checked after both
 * `isExternal` and `domainOf(...) === 'ot'`: a system that is external, or
 * OT, keeps that more specific placement even if it also happens to be a
 * non-application kind — this band is this sprint's last, least specific
 * zone, not a fourth check every other one has to be re-litigated
 * against.
 */
export const PLATFORM_BAND_KEY = '$platform';

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

/**
 * Item 7's own floor — "LAYOUT_WIDTH = canvas width at layout time (min
 * 1280)". `computeLandscapeLayout`'s effective width is
 * `Math.max(MIN_LAYOUT_WIDTH, layoutWidthHint)`, never this constant alone
 * once a real hint is available; a narrow canvas (or no hint at all) still
 * gets this floor, so bands never shrink to the point of one item per row.
 */
export const MIN_LAYOUT_WIDTH = 1280;

// Exported: `LandscapeCanvas.tsx`'s own drawing pass and (secondary-
// supporter wording) its reference-chip hit test both need this exact box
// size — one source for the literal rather than two copies to keep in sync.
export const REFERENCE_CHIP_WIDTH = 108;
export const REFERENCE_CHIP_HEIGHT = 18;
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

export type LandscapeLaneRegion = 'capability' | 'unassigned' | 'external' | 'ot' | 'platform';

export interface LandscapeLane {
  key: string;
  label: string;
  /** `'external'` lanes sit outside the enterprise boundary (`boundary`, below); `'capability'`/`'unassigned'`/`'ot'`/`'platform'` are what the boundary actually encloses — `'ot'` (Prompt 7k item 3) and `'platform'` (item 4) are `LandscapeCanvas.tsx`'s own cues to draw each one's zone rectangle. */
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
  if (domainOf(system) === 'ot') return { primaryLaneKey: OT_ZONE_LANE_KEY, otherLaneKeys: [], isFallback: false };
  if (isNonApplicationKind(system)) return { primaryLaneKey: PLATFORM_BAND_KEY, otherLaneKeys: [], isFallback: false };

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

/** Capability lanes first (by name), then the OT zone (Prompt 7k item 3 — a judgment call: real domain-based grouping reads more like "another lane" than a leftover bucket, so it sits ahead of Unassigned), then Unassigned (item 2), then the platform band last of all (Prompt 7k item 4 — "along the bottom," `PLATFORM_BAND_KEY`'s own comment) — External isn't part of this ordering at all any more, see this module's own top comment. */
function laneSortKey(key: string, l1CapabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>): [number, string] {
  if (key === PLATFORM_BAND_KEY) return [3, ''];
  if (key === UNASSIGNED_LANE_KEY) return [2, ''];
  if (key === OT_ZONE_LANE_KEY) return [1, ''];
  return [0, l1CapabilitiesById.get(key)?.name ?? key];
}

/** One row-wrapped block of members (a lane's systems, or the actor row) — left to right, wrapping at `itemsPerRow`, top-anchored at `top`. `height` is exactly as tall as the rows actually used, `0` for an empty list. */
function layoutRow(members: readonly ElementsHeadRow[], top: number, itemsPerRow: number): { nodes: LandscapeNodePosition[]; height: number } {
  if (members.length === 0) return { nodes: [], height: 0 };
  const nodes = members.map((member, index) => {
    const row = Math.floor(index / itemsPerRow);
    const col = index % itemsPerRow;
    return { elementId: member.element_id, x: PADDING + col * (NODE_WIDTH + NODE_GUTTER_X), y: top + row * (NODE_HEIGHT + NODE_GUTTER_Y) };
  });
  const rows = Math.ceil(members.length / itemsPerRow);
  const height = rows * NODE_HEIGHT + (rows - 1) * NODE_GUTTER_Y;
  return { nodes, height };
}

export interface LandscapeSystemGrouping {
  /** Every level-1 capability lane key touched, in the exact order both the canvas and the mobile list (item 13) render lanes: capability lanes by name, then `UNASSIGNED_LANE_KEY` — never `EXTERNAL_LANE_KEY`, which both callers place last, on their own (this module's own top comment: external isn't part of this ordering). */
  boundaryKeys: string[];
  hasExternalLane: boolean;
  /** Every lane's members, already sorted by name/id (`byNameThenId`) — includes `EXTERNAL_LANE_KEY` when `hasExternalLane`, and every lane a system merely *references* (via `referenceTargets`) even if nothing is ever primary-placed there. */
  byLane: ReadonlyMap<string, ElementsHeadRow[]>;
  l1CapabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>;
  extraLaneCountByElementId: ReadonlyMap<UUID, number>;
  referenceTargets: readonly { elementId: UUID; laneKey: string }[];
}

/**
 * The lane-assignment half of `computeLandscapeLayout` (B4's whole
 * placement rule — this module's own top comment), extracted so item 13's
 * mobile list (`landscapeGroups.ts`) can classify systems into the exact
 * same lanes the desktop canvas draws, without needing any of this
 * function's pixel math.
 */
function groupSystemsByLane(systems: readonly ElementsHeadRow[], supportsEdges: readonly RelationshipsHeadRow[], l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>): LandscapeSystemGrouping {
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

  const sortedByLane = new Map<string, ElementsHeadRow[]>();
  for (const [key, members] of byLane) sortedByLane.set(key, [...members].sort(byNameThenId));

  return { boundaryKeys, hasExternalLane, byLane: sortedByLane, l1CapabilitiesById, extraLaneCountByElementId, referenceTargets };
}

export { groupSystemsByLane };

/**
 * @param systems Landscape nodes (src/db/landscape.ts's `listSystemsForLandscape`).
 * @param supportsEdges `supports` relationships from a system to a capability (`listSupportsEdgesForSystems`) — used only for lane assignment, never rendered as edges themselves (§6.1: landscape edges are `uses`/`flows_to` only).
 * @param l1AncestorByCapabilityId Every capability actually named by `supportsEdges`' targets, mapped to its own level-1 ancestor row (itself, if it already is one) — `src/ui/elements/capabilityDepth.ts`'s `l1AncestorOf`, resolved by the caller for each distinct target id. Lane labels come from these ancestor rows' own names, never a leaf sub-capability's.
 * @param actors Actors (`src/db/landscape.ts`'s `listActorsForLandscape`) — item 3's own top row, both external and internal together (visually distinguished, not separately grouped — `LandscapeCanvas.tsx`'s own concern).
 * @param layoutWidthHint Item 7: the canvas's own on-screen width at layout time, when the caller has one — clamped to `MIN_LAYOUT_WIDTH` below. Omitted (this module's own tests, mostly) means "just use the floor."
 */
export function computeLandscapeLayout(
  systems: readonly ElementsHeadRow[],
  supportsEdges: readonly RelationshipsHeadRow[],
  l1AncestorByCapabilityId: ReadonlyMap<UUID, ElementsHeadRow>,
  actors: readonly ElementsHeadRow[] = [],
  layoutWidthHint: number = MIN_LAYOUT_WIDTH,
): LandscapeLayout {
  const layoutWidth = Math.max(MIN_LAYOUT_WIDTH, layoutWidthHint);
  const availableRowWidth = layoutWidth - 2 * PADDING;
  const itemsPerRow = Math.max(1, Math.floor((availableRowWidth + NODE_GUTTER_X) / (NODE_WIDTH + NODE_GUTTER_X)));

  const { boundaryKeys, hasExternalLane, byLane, l1CapabilitiesById, extraLaneCountByElementId, referenceTargets } = groupSystemsByLane(systems, supportsEdges, l1AncestorByCapabilityId);

  const lanes: LandscapeLane[] = [];
  const nodes: LandscapeNodePosition[] = [];
  const referenceMarkers: LandscapeReferenceMarker[] = [];
  let y = PADDING;

  const actorRow = layoutRow([...actors].sort(byNameThenId), y, itemsPerRow);
  if (actorRow.nodes.length > 0) y += actorRow.height + ACTOR_GUTTER_Y;

  const boundaryTop = y;

  function placeLane(key: string, region: LandscapeLaneRegion): void {
    const members = [...(byLane.get(key) ?? [])].sort(byNameThenId);
    const label = key === EXTERNAL_LANE_KEY ? 'External' : key === OT_ZONE_LANE_KEY ? 'OT' : key === PLATFORM_BAND_KEY ? 'Platforms' : key === UNASSIGNED_LANE_KEY ? 'Unassigned' : (l1CapabilitiesById.get(key)?.name ?? 'Unassigned');
    const row = layoutRow(members, y + LANE_LABEL_HEIGHT, itemsPerRow);
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
      const chipX = layoutWidth - PADDING - (index + 1) * (REFERENCE_CHIP_WIDTH + REFERENCE_CHIP_GUTTER) + REFERENCE_CHIP_GUTTER;
      referenceMarkers.push({ elementId: ref.elementId, laneKey: key, x: chipX, y: y + (LANE_LABEL_HEIGHT - REFERENCE_CHIP_HEIGHT) / 2 });
    });

    y += laneHeight;
  }

  for (const key of boundaryKeys) placeLane(key, key === UNASSIGNED_LANE_KEY ? 'unassigned' : key === OT_ZONE_LANE_KEY ? 'ot' : key === PLATFORM_BAND_KEY ? 'platform' : 'capability');
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
    width: layoutWidth,
    height: y + PADDING,
  };
}

export { BOUNDARY_MARGIN };

// --- Item 9: edges route around unrelated tiles ---
//
// The layout above places every node on a strict column/row grid (a lane's
// members wrap at `itemsPerRow`, every row across every lane shares the
// same column x-positions). That means the *gaps* between columns, and the
// gaps between rows (within a lane, and between lanes), are never occupied
// by any tile anywhere in the diagram — a "channel" spanning the full
// height (a column gap) or full width (a row gap) that a routed edge can
// always travel along without crossing a tile, whichever two nodes it
// connects. `computeLandscapeChannels` derives both lists straight from
// the *actual* node positions a completed layout produced — no need to
// duplicate the grid bookkeeping above — and `routeLandscapeEdge` uses
// them to build an orthogonal path only when the direct line between two
// nodes would otherwise cross a third one, keeping the common case (an
// unobstructed straight line) exactly as simple as it already was.

export interface LandscapeChannels {
  /** x-coordinates guaranteed clear of every node's column, top to bottom of the diagram. */
  vertical: number[];
  /** y-coordinates guaranteed clear of every node's row, left to right of the diagram. */
  horizontal: number[];
}

/** The midpoints of every gap between a sorted list of `[start, start+span)` extents — plus one before the first and one after the last, into the given margin. Shared shape for both axes below. */
function channelsBetween(starts: readonly number[], span: number, marginEnd: number): number[] {
  const distinct = [...new Set(starts)].sort((a, b) => a - b);
  const first = distinct[0];
  const last = distinct[distinct.length - 1];
  if (first === undefined || last === undefined) return [marginEnd / 2];

  const channels: number[] = [first / 2];
  for (let i = 0; i < distinct.length - 1; i++) {
    const current = distinct[i];
    const next = distinct[i + 1];
    if (current === undefined || next === undefined) continue;
    const end = current + span;
    if (next > end) channels.push((end + next) / 2);
  }
  channels.push((last + span + marginEnd) / 2);
  return channels;
}

/** Derives both channel lists from a completed layout's own node positions (`nodes` + `actorNodes` together — an actor tile is a tile like any other for routing purposes). Cheap: this is a handful of numbers, computed once per layout, not per edge. */
export function computeLandscapeChannels(layout: Pick<LandscapeLayout, 'nodes' | 'actorNodes' | 'width' | 'height'>): LandscapeChannels {
  const all = [...layout.nodes, ...layout.actorNodes];
  return {
    vertical: channelsBetween(all.map((n) => n.x), NODE_WIDTH, layout.width),
    horizontal: channelsBetween(all.map((n) => n.y), NODE_HEIGHT, layout.height),
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Liang-Barsky segment/AABB clip test — true when the closed segment (x1,y1)-(x2,y2) enters `rect`'s interior at all (touching an edge exactly counts as clear, per the `<`/`>` below, not `<=`/`>=` — a route that just grazes a tile's boundary was never asked to detour around it). */
export function segmentCrossesRect(x1: number, y1: number, x2: number, y2: number, rect: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const checks: [number, number][] = [
    [-dx, x1 - rect.x],
    [dx, rect.x + rect.w - x1],
    [-dy, y1 - rect.y],
    [dy, rect.y + rect.h - y1],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t1 - t0 > 1e-9;
}

/** The vertical channel immediately to one side of `[start, start+span)` — the gap's own midpoint, always present (`computeLandscapeChannels` seeds a channel before the first extent and after the last, so every extent has a neighbour on both sides). `0` is an unreachable fallback (`channels` is never empty in practice — it always comes from `computeLandscapeChannels`, which always returns at least one entry per axis), needed only to satisfy the type checker. */
function adjacentChannel(channels: readonly number[], start: number, span: number, side: 'before' | 'after'): number {
  const sorted = [...channels].sort((a, b) => a - b);
  if (side === 'before') {
    const below = sorted.filter((c) => c <= start);
    return below[below.length - 1] ?? sorted[0] ?? 0;
  }
  const above = sorted.filter((c) => c >= start + span);
  return above[0] ?? sorted[sorted.length - 1] ?? 0;
}

function nearestChannel(channels: readonly number[], target: number): number {
  return channels.reduce((best, c) => (Math.abs(c - target) < Math.abs(best - target) ? c : best), channels[0] ?? target);
}

/**
 * The polyline (world-space points, first and last are the two node
 * centres) an edge from `from` to `to` should draw as — a plain 2-point
 * straight line when nothing else is in the way (the common case, and
 * visually simplest), or an orthogonal detour through the clear channels
 * `computeLandscapeChannels` derived, when the direct line would otherwise
 * cross a third node's tile. `obstacles` is every OTHER node in the
 * diagram (systems and actors both — the caller excludes `from`/`to`
 * themselves before calling).
 */
export function routeLandscapeEdge(from: LandscapeNodePosition, to: LandscapeNodePosition, obstacles: readonly LandscapeNodePosition[], channels: LandscapeChannels): { x: number; y: number }[] {
  const fromCentre = { x: from.x + NODE_WIDTH / 2, y: from.y + NODE_HEIGHT / 2 };
  const toCentre = { x: to.x + NODE_WIDTH / 2, y: to.y + NODE_HEIGHT / 2 };

  const blocked = obstacles.some((n) => segmentCrossesRect(fromCentre.x, fromCentre.y, toCentre.x, toCentre.y, { x: n.x, y: n.y, w: NODE_WIDTH, h: NODE_HEIGHT }));
  if (!blocked) return [fromCentre, toCentre];

  // Exit `from` sideways into whichever of its two adjacent column
  // channels leans toward `to` (always safe — the gap next to a tile's own
  // column is never occupied by anything, regardless of that row's other
  // content); enter `to` the same way, symmetrically; connect the two via
  // whichever horizontal channel sits closest to the pair's own vertical
  // midpoint (always safe too — a horizontal channel spans the full width
  // by construction).
  const v1 = adjacentChannel(channels.vertical, from.x, NODE_WIDTH, to.x >= from.x ? 'after' : 'before');
  const v2 = adjacentChannel(channels.vertical, to.x, NODE_WIDTH, from.x >= to.x ? 'after' : 'before');
  const h = nearestChannel(channels.horizontal, (fromCentre.y + toCentre.y) / 2);

  const raw = [fromCentre, { x: v1, y: fromCentre.y }, { x: v1, y: h }, { x: v2, y: h }, { x: v2, y: toCentre.y }, toCentre];
  // Drop a point that adds no direction change (e.g. `v1 === v2` collapses
  // the middle two into one point) — dedupe on identical consecutive
  // points and on three consecutive collinear ones.
  const points: { x: number; y: number }[] = [];
  for (const point of raw) {
    const prev = points[points.length - 1];
    if (prev?.x === point.x && prev.y === point.y) continue;
    const prev2 = points[points.length - 2];
    if (prev && prev2 && ((prev2.x === prev.x && prev.x === point.x) || (prev2.y === prev.y && prev.y === point.y))) {
      points[points.length - 1] = point;
      continue;
    }
    points.push(point);
  }
  return points;
}

/**
 * Prompt 7k item 4's "route via platforms" toggle: which node (if any) an
 * edge should route through instead of drawing direct — extracted as its
 * own pure function so the decision itself (as opposed to
 * `LandscapeCanvas.tsx`'s own two-leg `routeLandscapeEdge` calls once a
 * via node is found) is unit-testable without a canvas.
 *
 * `false`/`routeViaPlatforms` off always returns `undefined` regardless of
 * `via` — direct edges by default, per the prompt's own parenthetical. A
 * `via` that doesn't resolve to a node actually on this map (the platform
 * system exists in the model but isn't itself placed here) also returns
 * `undefined`, so the caller falls back to the direct edge rather than
 * drawing nothing.
 */
export function viaPositionFor(via: string | undefined, positionById: ReadonlyMap<UUID, LandscapeNodePosition>, routeViaPlatforms: boolean): LandscapeNodePosition | undefined {
  if (!routeViaPlatforms || via === undefined) return undefined;
  return positionById.get(via);
}
