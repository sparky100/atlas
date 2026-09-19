/**
 * V1's own layout algorithm for the Context diagram (docs/prompts/
 * atlas-prompt-pack.md, "### V1 — the context diagram"), reworked for real
 * density: a pure, deterministic function (CLAUDE.md rule 6) producing tile
 * positions, orthogonal edge routes and label anchors for
 * `ContextDiagramCanvas.tsx`. Reuses `layout.ts`'s own tile size constants
 * (`NODE_WIDTH`/`NODE_HEIGHT`) and its structural shape (an enterprise
 * boundary with an external band below it) so the context diagram reads as
 * "the same renderer, a different query and layout preset" (UI-principles
 * §6.1).
 *
 * The first V1 build was designed and tested against a two-neighbour case.
 * The real stress case — a single hub with several real neighbours, several
 * flows each (the standing fixture in `fixtures/sapContext.ts`) — needed
 * four things, each its own section below:
 *
 *  1. **Fan.** Neighbours sit in one row, with a gap that *grows* with
 *     neighbour count (`fanGapFor`) rather than the same packed row
 *     compressed. The row only wraps when even the minimum gap won't fit
 *     the canvas.
 *  2. **Lanes.** Every edge is an orthogonal route with its own horizontal
 *     lane in the channel between the hub and the neighbour row, its own
 *     attach point on the hub's bottom edge and its own attach point on the
 *     neighbour's top edge (`spreadAlong`) — so no two edges ever share a
 *     segment. An edge from a row further down (externals below the
 *     boundary, or a wrapped second row) rises *outside* the rows above it
 *     (`riser`), never through a tile.
 *  3. **Leader labels.** A label sits on its own edge's vertical drop, just
 *     above the neighbour tile it leaves (the drop is the leader), stacked
 *     per neighbour in its own reserved band under the lanes, and clamped
 *     to its tile's own span so two neighbours' labels can never overlap
 *     (`placeEdgeLabels`).
 *  4. **Collision audit.** `edgeLabelsCollide` reports whether any two
 *     placed pills, or a pill and a tile, still intersect — the canvas uses
 *     it to default labels to hidden (hover/tap reveals them) rather than
 *     degrade the always-visible layout further.
 *
 * Coordinates are world units; the canvas scales them. Label pills are
 * sized by an injected `measureWorld` (text width already divided by the
 * current scale) so this stays a pure, unit-testable module.
 *
 * V3 ("container context pages, platform context simplified to structure
 * only"): every module/platform-tile-nesting concept this file used to
 * carry — a widened hub tile, module sub-tiles, "which hub module does this
 * edge attach to," the "which module?" fallback anchor — is gone. A
 * platform-with-modules hub is no longer laid out here at all; it gets its
 * own separate, much simpler structure-only page (`PlatformStructureView.tsx`)
 * with no neighbours and no edges to route. Every hub this file lays out
 * now is a plain tile — a system, or one container viewed on its own — so
 * the fan/lane/riser/label engine above (rework items 1–4) is unchanged,
 * but every "which of the hub's several endpoints does this edge attach
 * to" question collapses to "the hub tile itself, always" — a single hub
 * can still have enough neighbours to need fan spread and lane routing,
 * but never a second endpoint to route between.
 */
import type { UUID } from '../../contracts/delta';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

/** The minimum gap between two neighbour tiles in a row — also the gap a row shrinks to before it wraps. */
const TILE_GUTTER_X = 24;
/**
 * Fan (rework item 1): each extra neighbour adds this much to the gap
 * between every pair, so five neighbours spread wider than two, up to
 * `FAN_GAP_MAX`. Sized so a five-neighbour row (the fixture) sits at
 * `TILE_GUTTER_X + 4 × 20 = 104` — enough for a 30-character label pill
 * to clear its neighbours' pills with the `LABEL_OVERHANG_MAX` below.
 */
const FAN_GAP_STEP = 20;
const FAN_GAP_MAX = 120;
const PADDING = 32;
export const BOUNDARY_MARGIN = 8;
/** Clearance between the boundary's bottom edge and the first external row's channel — the same "externals sit clearly outside" gap `layout.ts`'s own external band keeps. */
const EXTERNAL_BOUNDARY_GAP = 24;
export const MIN_DIAGRAM_WIDTH = 960;

/** Channel (rework items 2–3): the vertical band between a row and whatever is above it, holding that row's label stack (bottom) and its lanes (top). */
const MIN_CHANNEL_HEIGHT = 56;
/** Space between a neighbour tile's top edge and the lowest label slot. */
const LABEL_MARGIN = 10;
/** One label slot per edge, per neighbour — tall enough for a two-line pill (`LABEL_PILL_HEIGHT_2_LINE`). */
export const LABEL_PITCH = 30;
/** Space between the label stack and the lowest lane, and between the highest lane and the row above. */
const LANE_MARGIN = 14;
/** Vertical distance between two lanes — two parallel 1.5px lines with clear air between. */
export const LANE_PITCH = 12;
/** How far outside a row's extent a riser runs (rework item 2's "never through a tile"). */
const OUTER_RISER_MARGIN = 20;
/** Horizontal distance between two risers on the same side. */
const RISER_PITCH = 10;
/** How far a label pill may extend past its own tile's edges into the gap — capped below `OUTER_RISER_MARGIN` so a pill on an outermost tile never reaches a riser. */
const LABEL_OVERHANG_MAX = 16;

export const LABEL_PILL_PADDING_X = 12;
export const LABEL_PILL_HEIGHT_1_LINE = 18;
export const LABEL_PILL_HEIGHT_2_LINE = 30;
/** Two pills closer than this in x, sharing a y band, count as colliding (`edgeLabelsCollide`) — crowded, not just touching. */
const LABEL_MIN_GAP_X = 6;

export interface DiagramTile {
  elementId: UUID;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramBoundary {
  top: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** One neighbour row (rework item 1's fan) — the internal band is row 0 and, if it wrapped, row 1…; every external row follows. */
export interface DiagramRow {
  index: number;
  external: boolean;
  tileIds: UUID[];
  top: number;
  bottom: number;
  /** The row's leftmost tile edge / rightmost tile edge — a deeper row's risers run outside the extents of every row above it. */
  left: number;
  right: number;
  /** The gap between adjacent tiles in this row (`fanGapFor`, or the shrunk gap when the fan didn't fit). */
  gap: number;
  /** The channel directly above this row: `channelTop` is the bottom of whatever sits above (the hub, the previous row, or the boundary for the first external row), `channelBottom` is this row's own `top`. */
  channelTop: number;
  channelBottom: number;
}

export interface EdgeLabelAnchor {
  /** The x of the edge's own vertical drop at the neighbour — the leader the pill sits on. */
  x: number;
  /** The centre y of this label's own slot in the neighbour's label stack. */
  y: number;
  /** The pill's allowed horizontal extent — its own tile's span plus a bounded overhang into the gap. */
  minX: number;
  maxX: number;
}

export interface RoutedEdge {
  id: UUID;
  neighbourId: UUID;
  label: string;
  /** True when the edge's own `to` side is the hub — the arrowhead belongs at `hubAnchor`; false when it belongs at `neighbourAnchor`. */
  arrowAtHub: boolean;
  /** The polyline, neighbour end first, hub end last — every segment is axis-aligned. Two points for a dead-straight vertical; four for one lane; six for a riser route. */
  points: Point[];
  neighbourAnchor: Point;
  hubAnchor: Point;
  /** The lane this edge's horizontal segment in the top channel occupies (0 = nearest the hub), or `null` for a dead-straight vertical. */
  lane: number | null;
  labelAnchor: EdgeLabelAnchor;
}

export interface ContextDiagramLayout {
  hub: DiagramTile;
  internalNeighbours: DiagramTile[];
  externalNeighbours: DiagramTile[];
  boundary: DiagramBoundary;
  width: number;
  height: number;
  rows: DiagramRow[];
  edges: RoutedEdge[];
}

/** One `uses`/`flows_to` edge to draw — always neighbour ↔ hub (V3: there is no other endpoint to name any more), the arrow's direction, and the verb label. */
export interface ContextEdgeInput {
  id: UUID;
  neighbourId: UUID;
  arrowAtHub: boolean;
  label: string;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether `upper` (the smaller lane index — its own horizontal run sits
 * nearer the hub) visibly crosses `lower` (a larger lane index, nearer the
 * neighbour row). Every no-riser edge's route is exactly two vertical
 * segments joined by one horizontal run at its own lane's height:
 * `upper`'s rise from the neighbour row up to *its* lane necessarily
 * passes through every lane below it, including `lower`'s — a real,
 * visible crossing whenever that rise's own x (`upper.fromX`) falls
 * inside `lower`'s own horizontal span; symmetrically, `lower`'s rise from
 * its own lane up to the hub passes through every lane above it,
 * including `upper`'s, crossing it whenever that rise's x (`lower.toX`)
 * falls inside `upper`'s own span. Either one alone is a crossing a
 * viewer actually sees.
 */
export function lanesCross(upper: { fromX: number; toX: number }, lower: { fromX: number; toX: number }): boolean {
  const upperLo = Math.min(upper.fromX, upper.toX);
  const upperHi = Math.max(upper.fromX, upper.toX);
  const lowerLo = Math.min(lower.fromX, lower.toX);
  const lowerHi = Math.max(lower.fromX, lower.toX);
  const lowerRiseCrossesUpper = lower.toX >= upperLo && lower.toX <= upperHi;
  const upperRiseCrossesLower = upper.fromX >= lowerLo && upper.fromX <= lowerHi;
  return lowerRiseCrossesUpper || upperRiseCrossesLower;
}

/**
 * Refines a lane order (widest-span-first is a reasonable starting point,
 * but not itself crossing-aware — two edges whose spans happen to be
 * close, or whose spans don't correlate with which one should sit nearer
 * the hub, can still cross needlessly) with bounded adjacent-swap passes,
 * the same "layered crossing reduction" technique the Sugiyama framework
 * uses for this exact class of problem. Swapping two *adjacent* lanes only
 * ever changes whether that one pair crosses — every other pair's
 * relative order, and therefore its own crossing status, is untouched —
 * so a pass that swaps only when doing so turns a real crossing into a
 * clean one (never the reverse) strictly reduces the total count and
 * never worsens it. A fixed point is reached deterministically within `n`
 * passes (the standard bubble-sort bound); a pair that crosses either way
 * (a genuine, unavoidable crossing between two interleaved edges) is left
 * in its span-order position, same as today.
 */
export function minimizeLaneCrossings<T>(ordered: readonly T[], pointOf: (item: T) => { fromX: number; toX: number }): T[] {
  const order = [...ordered];
  let pass = 0;
  while (pass < order.length) {
    let swapped = false;
    for (let i = 0; i < order.length - 1; i += 1) {
      const a = order[i];
      const b = order[i + 1];
      if (a === undefined || b === undefined) continue;
      const pa = pointOf(a);
      const pb = pointOf(b);
      if (lanesCross(pa, pb) && !lanesCross(pb, pa)) {
        order[i] = b;
        order[i + 1] = a;
        swapped = true;
      }
    }
    if (!swapped) break;
    pass += 1;
  }
  return order;
}

/** Rework item 1: the gap between adjacent neighbour tiles for a row of `count` — grows with count, capped. */
export function fanGapFor(count: number): number {
  return Math.min(FAN_GAP_MAX, TILE_GUTTER_X + FAN_GAP_STEP * Math.max(0, count - 1));
}

interface PlannedRow {
  ids: UUID[];
  gap: number;
  width: number;
  height: number;
}

/**
 * Rework item 1, the fan: sorted by id (every tile is the same fixed
 * `NODE_WIDTH`×`NODE_HEIGHT` size now that a hub never widens for modules,
 * so there's no attach-point-based ordering left to sort by — id order is
 * simply a deterministic tie-break, CLAUDE.md rule 6), then try one row at
 * `fanGapFor(n)`; if that overflows, shrink the gap down to `TILE_GUTTER_X`;
 * if it still overflows, wrap into rows of as many tiles as fit at the fan
 * gap for that row size. Each row is centred by the caller.
 */
function planFanRows(ids: readonly UUID[], availableWidth: number): PlannedRow[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort(compareIds);
  const widthOf = (count: number, gap: number) => count * NODE_WIDTH + (count - 1) * gap;

  const fanGap = fanGapFor(sorted.length);
  if (widthOf(sorted.length, fanGap) <= availableWidth) return [{ ids: sorted, gap: fanGap, width: widthOf(sorted.length, fanGap), height: NODE_HEIGHT }];
  if (sorted.length > 1 && widthOf(sorted.length, TILE_GUTTER_X) <= availableWidth) {
    const gap = Math.floor((availableWidth - sorted.length * NODE_WIDTH) / (sorted.length - 1));
    return [{ ids: sorted, gap, width: widthOf(sorted.length, gap), height: NODE_HEIGHT }];
  }

  // Wrap: greedy by width at the minimum gutter, then re-fan each row to the widest gap that still fits it.
  const rows: UUID[][] = [];
  let current: UUID[] = [];
  for (const id of sorted) {
    if (current.length > 0 && widthOf(current.length + 1, TILE_GUTTER_X) > availableWidth) {
      rows.push(current);
      current = [id];
    } else {
      current.push(id);
    }
  }
  if (current.length > 0) rows.push(current);
  return rows.map((row) => {
    const maxGap = row.length > 1 ? Math.floor((availableWidth - row.length * NODE_WIDTH) / (row.length - 1)) : 0;
    const gap = Math.min(fanGapFor(row.length), Math.max(TILE_GUTTER_X, maxGap));
    return { ids: row, gap, width: widthOf(row.length, gap), height: NODE_HEIGHT };
  });
}

/** Rework item 2: `count` attach points spread evenly along a span, never on its ends — index `i` of `count` sits at `(i + 1) / (count + 1)` of the way across. */
export function spreadAlong(from: number, width: number, index: number, count: number): number {
  return from + (width * (index + 1)) / (count + 1);
}

/**
 * @param hubId The system or container this Context view is scoped to.
 * @param internalNeighbourIds Non-external `uses`/`flows_to` neighbours — systems, containers (S1 item 20) and actors (S1 item 11a) alike.
 * @param externalNeighbourIds Same, for `isExternal` neighbours — placed below the boundary, same as the landscape's own external band.
 * @param widthHint The canvas's own on-screen width at layout time — same `MIN_DIAGRAM_WIDTH` floor shape `layout.ts`'s own `layoutWidthHint` uses.
 * @param edges Every drawn edge (rework items 2–3) — sizes the channels and is routed into `ContextDiagramLayout.edges`. Empty is a valid (edgeless) layout.
 */
export function computeContextDiagramLayout(
  hubId: UUID,
  internalNeighbourIds: readonly UUID[],
  externalNeighbourIds: readonly UUID[],
  widthHint: number = MIN_DIAGRAM_WIDTH,
  edges: readonly ContextEdgeInput[] = [],
): ContextDiagramLayout {
  const width = Math.max(MIN_DIAGRAM_WIDTH, widthHint);
  const availableWidth = width - 2 * PADDING;

  // ---- The hub: centred, at the top. Always a plain NODE_WIDTH×NODE_HEIGHT tile — a platform with modules never reaches this layout (module comment above). ----
  const boundaryTop = PADDING;
  const hubX = PADDING + (availableWidth - NODE_WIDTH) / 2;
  const hubTile: DiagramTile = { elementId: hubId, x: hubX, y: boundaryTop, w: NODE_WIDTH, h: NODE_HEIGHT };

  // ---- x-phase: plan every row's tiles and x positions. ----
  const internalPlan = planFanRows(internalNeighbourIds, availableWidth);
  const externalPlan = planFanRows(externalNeighbourIds, availableWidth);
  const plannedRows: { plan: PlannedRow; external: boolean }[] = [...internalPlan.map((plan) => ({ plan, external: false })), ...externalPlan.map((plan) => ({ plan, external: true }))];

  const rowXs: { left: number; right: number; xs: number[] }[] = plannedRows.map(({ plan }) => {
    let x = PADDING + (availableWidth - plan.width) / 2;
    const xs: number[] = [];
    plan.ids.forEach(() => {
      xs.push(x);
      x += NODE_WIDTH + plan.gap;
    });
    const first = xs[0] ?? PADDING;
    return { left: first, right: (xs[xs.length - 1] ?? PADDING) + NODE_WIDTH, xs };
  });

  // ---- Edge planning that needs only x: attach x's on each side, and whether an edge needs a lane. ----
  const edgesByNeighbour = new Map<UUID, ContextEdgeInput[]>();
  for (const edge of edges) {
    const list = edgesByNeighbour.get(edge.neighbourId) ?? [];
    list.push(edge);
    edgesByNeighbour.set(edge.neighbourId, list);
  }
  const rowIndexOf = new Map<UUID, number>();
  plannedRows.forEach(({ plan }, rowIndex) => {
    for (const id of plan.ids) rowIndexOf.set(id, rowIndex);
  });
  const tileXOf = new Map<UUID, { x: number; w: number }>();
  plannedRows.forEach(({ plan }, rowIndex) => {
    plan.ids.forEach((id, i) => {
      tileXOf.set(id, { x: rowXs[rowIndex]?.xs[i] ?? PADDING, w: NODE_WIDTH });
    });
  });

  // Attach order at a neighbour: by edge id (there's only ever one hub endpoint to order against now) — so a neighbour's own drops never cross each other on the way up.
  const neighbourAttachX = new Map<UUID, number>();
  for (const [neighbourId, list] of edgesByNeighbour) {
    const box = tileXOf.get(neighbourId);
    if (!box) continue;
    const ordered = [...list].sort((a, b) => compareIds(a.id, b.id));
    ordered.forEach((edge, i) => {
      neighbourAttachX.set(edge.id, spreadAlong(box.x, box.w, i, ordered.length));
    });
  }
  // Attach order at the hub: every edge that touches a placed neighbour, ordered by the neighbour's own attach x, spread along the hub tile's own bottom edge — so several edges converging on the one hub tile don't all run through the same point.
  const hubEdges = edges.filter((e) => tileXOf.has(e.neighbourId));
  const hubAttachX = new Map<UUID, number>();
  {
    const ordered = [...hubEdges].sort((a, b) => (neighbourAttachX.get(a.id) ?? 0) - (neighbourAttachX.get(b.id) ?? 0) || compareIds(a.id, b.id));
    ordered.forEach((edge, i) => {
      hubAttachX.set(edge.id, spreadAlong(hubTile.x, hubTile.w, i, ordered.length));
    });
  }

  // Riser side and provisional x for every edge from a deeper row (rework item 2).
  const extentsAbove = (rowIndex: number): { left: number; right: number } => {
    const above = rowXs.slice(0, rowIndex);
    return { left: Math.min(hubTile.x, ...above.map((r) => r.left)), right: Math.max(hubTile.x + hubTile.w, ...above.map((r) => r.right)) };
  };
  interface EdgePlan {
    edge: ContextEdgeInput;
    rowIndex: number;
    fromX: number;
    toX: number;
    riserSide: 'left' | 'right' | null;
    /** Provisional riser x (before per-side spacing) — used only to order lanes. */
    provisionalRiserX: number | null;
  }
  const plans: EdgePlan[] = [];
  for (const edge of hubEdges) {
    const rowIndex = rowIndexOf.get(edge.neighbourId);
    const fromX = neighbourAttachX.get(edge.id);
    const toX = hubAttachX.get(edge.id);
    if (rowIndex === undefined || fromX === undefined || toX === undefined) continue;
    if (rowIndex === 0) {
      plans.push({ edge, rowIndex, fromX, toX, riserSide: null, provisionalRiserX: null });
    } else {
      const extents = extentsAbove(rowIndex);
      const side: 'left' | 'right' = toX - extents.left < extents.right - toX ? 'left' : 'right';
      plans.push({ edge, rowIndex, fromX, toX, riserSide: side, provisionalRiserX: side === 'left' ? extents.left - OUTER_RISER_MARGIN : extents.right + OUTER_RISER_MARGIN });
    }
  }

  // Top-channel lanes: every edge whose top-channel horizontal has a real span. Widest span nearest the hub (lane 0) as a starting order — its long run then sits farthest from the label stacks. A deeper row's own edge doesn't have a real x to route the top channel against yet at this point — only `provisionalRiserX`, a crude, per-side, per-row placeholder shared by every edge on that side (real per-edge spacing depends on lane rank, which doesn't exist yet either) — so this first pass exists only to give `riserX` below a valid, self-consistent order to spread edges out by; it is not the order edges actually draw in (see `topLaneEdges` below, computed a second time once real riser x's exist).
  const topSpanOf = (p: EdgePlan): number => Math.abs(p.toX - (p.provisionalRiserX ?? p.fromX));
  const topLaneEdgesBySpan = plans.filter((p) => topSpanOf(p) >= 1).sort((a, b) => topSpanOf(b) - topSpanOf(a) || compareIds(a.edge.id, b.edge.id));
  const provisionalTopLane = new Map<UUID, number>(minimizeLaneCrossings(topLaneEdgesBySpan, (p) => ({ fromX: p.provisionalRiserX ?? p.fromX, toX: p.toX })).map((p, i) => [p.edge.id, i]));

  // Own-row lanes for deeper rows (the horizontal from the neighbour's drop out to its riser): per row, widest span first as a starting order, same crossing refinement as the top channel above (using the same provisional riser x — this channel's own edges are compared only against each other, on the same row and side, where the shared placeholder value is at least consistent between them).
  const ownLane = new Map<UUID, number>();
  const ownLaneCount = new Map<number, number>();
  for (let rowIndex = 1; rowIndex < plannedRows.length; rowIndex += 1) {
    const rowPlansBySpan = plans.filter((p) => p.rowIndex === rowIndex).sort((a, b) => Math.abs((b.provisionalRiserX ?? b.fromX) - b.fromX) - Math.abs((a.provisionalRiserX ?? a.fromX) - a.fromX) || compareIds(a.edge.id, b.edge.id));
    const rowPlans = minimizeLaneCrossings(rowPlansBySpan, (p) => ({ fromX: p.fromX, toX: p.provisionalRiserX ?? p.fromX }));
    rowPlans.forEach((p, i) => ownLane.set(p.edge.id, i));
    ownLaneCount.set(rowIndex, rowPlans.length);
  }

  // Riser x per side: the edge with the highest top lane (smallest lane index) runs outermost, so an inner riser never crosses an outer edge's lane. Every riser on a side is placed relative to the widest extents any deeper row sees, so risers from different rows on the same side stay parallel and ordered.
  const riserX = new Map<UUID, number>();
  for (const side of ['left', 'right'] as const) {
    const sidePlans = plans.filter((p) => p.riserSide === side).sort((a, b) => (provisionalTopLane.get(a.edge.id) ?? 0) - (provisionalTopLane.get(b.edge.id) ?? 0) || compareIds(a.edge.id, b.edge.id));
    if (sidePlans.length === 0) continue;
    const base = side === 'left' ? Math.min(...sidePlans.map((q) => extentsAbove(q.rowIndex).left)) : Math.max(...sidePlans.map((q) => extentsAbove(q.rowIndex).right));
    const count = sidePlans.length;
    sidePlans.forEach((p, rank) => {
      const outwardIndex = count - 1 - rank; // rank 0 (highest lane) → outermost
      riserX.set(p.edge.id, side === 'left' ? base - OUTER_RISER_MARGIN - outwardIndex * RISER_PITCH : base + OUTER_RISER_MARGIN + outwardIndex * RISER_PITCH);
    });
  }

  // Top-channel lanes, for real: every deeper-row edge now has its own actual riser x (just computed above, no longer the crude shared placeholder every edge on a side used to share) — re-running the same crossing minimization against real endpoints (row-0 edges already had exact `fromX` all along) gives the order edges actually draw in. Re-deriving this doesn't disturb `riserX` itself: a riser's own x only had to be a valid, uniquely-spaced position on its own side, never tied to one specific top-lane order.
  const topChannelPoint = (p: EdgePlan): { fromX: number; toX: number } => ({ fromX: riserX.get(p.edge.id) ?? p.provisionalRiserX ?? p.fromX, toX: p.toX });
  const topLaneEdges = minimizeLaneCrossings(topLaneEdgesBySpan, topChannelPoint);
  const topLane = new Map<UUID, number>(topLaneEdges.map((p, i) => [p.edge.id, i]));

  // ---- y-phase: channel heights from label stacks and lane counts, then place rows. ----
  const rows: DiagramRow[] = [];
  const tiles: DiagramTile[] = [];
  const placed = new Map<UUID, DiagramTile>();
  let y = hubTile.y + hubTile.h;
  let boundaryBottom = y;
  plannedRows.forEach(({ plan, external }, rowIndex) => {
    const maxEdgesPerNeighbour = Math.max(0, ...plan.ids.map((id) => edgesByNeighbour.get(id)?.length ?? 0));
    const laneCount = rowIndex === 0 ? topLaneEdges.length : (ownLaneCount.get(rowIndex) ?? 0);
    const labelBand = maxEdgesPerNeighbour > 0 ? LABEL_MARGIN + maxEdgesPerNeighbour * LABEL_PITCH : 0;
    const laneBand = laneCount > 0 ? LANE_MARGIN + laneCount * LANE_PITCH : 0;
    const channelHeight = Math.max(MIN_CHANNEL_HEIGHT, labelBand + laneBand + LANE_MARGIN);
    const firstExternal = external && rows.every((r) => !r.external);
    if (firstExternal) {
      boundaryBottom = y;
      y += EXTERNAL_BOUNDARY_GAP;
    }
    const channelTop = y;
    const top = y + channelHeight;
    const xs = rowXs[rowIndex]?.xs ?? [];
    const tileIds: UUID[] = [];
    plan.ids.forEach((id, i) => {
      const x = xs[i] ?? PADDING;
      const tile: DiagramTile = { elementId: id, x, y: top, w: NODE_WIDTH, h: NODE_HEIGHT };
      tiles.push(tile);
      placed.set(id, tile);
      tileIds.push(id);
    });
    const bottom = top + NODE_HEIGHT;
    rows.push({ index: rowIndex, external, tileIds, top, bottom, left: rowXs[rowIndex]?.left ?? PADDING, right: rowXs[rowIndex]?.right ?? PADDING, gap: plan.gap, channelTop, channelBottom: top });
    y = bottom;
    if (!external) boundaryBottom = bottom;
  });

  // ---- Routes. ----
  const laneY = (row: DiagramRow, laneIndex: number): number => row.channelTop + LANE_MARGIN + laneIndex * LANE_PITCH;
  const topRow = rows[0];
  const routed: RoutedEdge[] = [];
  for (const plan of plans) {
    const row = rows[plan.rowIndex];
    const neighbourTile = placed.get(plan.edge.neighbourId);
    if (!row || !neighbourTile || !topRow) continue;
    const hubAnchor: Point = { x: plan.toX, y: hubTile.y + hubTile.h };
    const neighbourAnchor: Point = { x: plan.fromX, y: neighbourTile.y };

    const points: Point[] = [neighbourAnchor];
    const lane = topLane.get(plan.edge.id) ?? null;
    if (plan.riserSide === null) {
      if (lane !== null) {
        const ly = laneY(topRow, lane);
        points.push({ x: plan.fromX, y: ly }, { x: plan.toX, y: ly });
      }
    } else {
      const rx = riserX.get(plan.edge.id) ?? plan.provisionalRiserX ?? plan.fromX;
      const ownY = laneY(row, ownLane.get(plan.edge.id) ?? 0);
      points.push({ x: plan.fromX, y: ownY }, { x: rx, y: ownY });
      if (lane !== null) {
        const ly = laneY(topRow, lane);
        points.push({ x: rx, y: ly }, { x: plan.toX, y: ly });
      }
    }
    points.push({ x: hubAnchor.x, y: hubAnchor.y });

    // Label slot: index among this neighbour's own edges in attach order (leftmost drop = lowest slot).
    const siblings = (edgesByNeighbour.get(plan.edge.neighbourId) ?? []).map((e) => ({ id: e.id, x: neighbourAttachX.get(e.id) ?? 0 })).sort((a, b) => a.x - b.x || compareIds(a.id, b.id));
    const slot = Math.max(0, siblings.findIndex((s) => s.id === plan.edge.id));
    // Two adjacent tiles' spans always stay `LABEL_MIN_GAP_X` apart, so two full-width pills on the same slot never count as crowded by construction.
    const overhang = Math.min(LABEL_OVERHANG_MAX, Math.max(0, (row.gap - LABEL_MIN_GAP_X) / 2));
    routed.push({
      id: plan.edge.id,
      neighbourId: plan.edge.neighbourId,
      label: plan.edge.label,
      arrowAtHub: plan.edge.arrowAtHub,
      points,
      neighbourAnchor,
      hubAnchor,
      lane,
      labelAnchor: { x: plan.fromX, y: neighbourTile.y - LABEL_MARGIN - LABEL_PITCH / 2 - slot * LABEL_PITCH, minX: neighbourTile.x - overhang, maxX: neighbourTile.x + neighbourTile.w + overhang },
    });
  }
  routed.sort((a, b) => compareIds(a.id, b.id));

  // ---- Extents: the fan and any risers may run past the width hint; widen after the fact, nothing placed needs to move. ----
  const rightmost = Math.max(hubTile.x + hubTile.w, ...tiles.map((t) => t.x + t.w), ...routed.flatMap((e) => e.points.map((p) => p.x)));
  const leftmost = Math.min(hubTile.x, ...tiles.map((t) => t.x), ...routed.flatMap((e) => e.points.map((p) => p.x)));
  const shift = leftmost < PADDING ? PADDING - leftmost : 0;
  if (shift > 0) {
    // A left-side riser ran past the left padding: translate everything right by the shortfall (a pure offset — order and spacing unchanged).
    const shiftTile = (t: DiagramTile): DiagramTile => ({ ...t, x: t.x + shift });
    const shiftedHub = shiftTile(hubTile);
    const shiftedTiles = tiles.map(shiftTile);
    const shiftedRows = rows.map((r) => ({ ...r, left: r.left + shift, right: r.right + shift }));
    const shiftedEdges = routed.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + shift, y: p.y })),
      neighbourAnchor: { x: e.neighbourAnchor.x + shift, y: e.neighbourAnchor.y },
      hubAnchor: { x: e.hubAnchor.x + shift, y: e.hubAnchor.y },
      labelAnchor: { ...e.labelAnchor, x: e.labelAnchor.x + shift, minX: e.labelAnchor.minX + shift, maxX: e.labelAnchor.maxX + shift },
    }));
    const internalIds = new Set(rows.filter((r) => !r.external).flatMap((r) => r.tileIds));
    return {
      hub: shiftedHub,
      internalNeighbours: shiftedTiles.filter((t) => internalIds.has(t.elementId)),
      externalNeighbours: shiftedTiles.filter((t) => !internalIds.has(t.elementId)),
      boundary: { top: boundaryTop, bottom: boundaryBottom },
      width: Math.max(width, rightmost + shift + PADDING),
      height: y + PADDING,
      rows: shiftedRows,
      edges: shiftedEdges,
    };
  }
  const internalIds = new Set(rows.filter((r) => !r.external).flatMap((r) => r.tileIds));
  return {
    hub: hubTile,
    internalNeighbours: tiles.filter((t) => internalIds.has(t.elementId)),
    externalNeighbours: tiles.filter((t) => !internalIds.has(t.elementId)),
    boundary: { top: boundaryTop, bottom: boundaryBottom },
    width: Math.max(width, rightmost + PADDING),
    height: y + PADDING,
    rows,
    edges: routed,
  };
}

/** Every tile in a completed layout, hub included — the flat list `ContextDiagramCanvas.tsx` needs for hit-testing. */
export function allTilesOf(layout: ContextDiagramLayout): DiagramTile[] {
  return [layout.hub, ...layout.internalNeighbours, ...layout.externalNeighbours];
}

/** The neighbour side of an edge, before spreading: top-centre of its own tile. */
export function tileTopAnchor(tile: DiagramTile): Point {
  return { x: tile.x + tile.w / 2, y: tile.y };
}

// ---------------------------------------------------------------------------
// Labels (rework items 3–4)
// ---------------------------------------------------------------------------

export interface EdgeLabelPill {
  edgeId: UUID;
  /** One line, or two when the text didn't fit its allowed width on one. */
  lines: string[];
  /** Centre, world units. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Greedily fills the first line up to `targetWidth`, puts every remaining word on the second. A single word already over `targetWidth` still gets its own line rather than being split mid-word. */
function wrapToTwoLines(text: string, measure: (s: string) => number, targetWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return [text];
  let splitAt = 1;
  for (let i = 2; i <= words.length; i += 1) {
    if (measure(words.slice(0, i).join(' ')) <= targetWidth) splitAt = i;
    else break;
  }
  const first = words.slice(0, splitAt).join(' ');
  const second = words.slice(splitAt).join(' ');
  return second.length > 0 ? [first, second] : [first];
}

/** Ellipsizes `text` to fit `maxWidth` under `measure` — binary search over the cut point, same shape as `ContextDiagramCanvas.tsx`'s own canvas-bound `truncate`. */
export function truncateToWidth(text: string, measure: (s: string) => number, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(text.slice(0, mid) + '…') <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? '' : text.slice(0, low) + '…';
}

/**
 * Rework item 3: one pill per routed edge, on its own leader (the edge's
 * drop at the neighbour), in its own slot of that neighbour's label stack,
 * clamped to the tile's allowed span (`EdgeLabelAnchor.minX`/`maxX`) — so
 * a pill leans off its drop only as far as needed to stay inside its own
 * tile's span, and the drop always still passes through it. Text that
 * doesn't fit the span on one line wraps to two; a line that still doesn't
 * fit is ellipsized. Pure: `measureWorld` is the canvas's own `measureText`
 * divided by the current scale, so widths come back in world units.
 */
export function placeEdgeLabels(edges: readonly RoutedEdge[], measureWorld: (text: string) => number): EdgeLabelPill[] {
  const pills: EdgeLabelPill[] = [];
  for (const edge of edges) {
    const text = edge.label.trim();
    if (text.length === 0) continue;
    const { minX, maxX } = edge.labelAnchor;
    const maxPillWidth = Math.max(LABEL_PILL_PADDING_X * 2, maxX - minX);
    const maxTextWidth = maxPillWidth - LABEL_PILL_PADDING_X;
    let lines: string[] = [text];
    if (measureWorld(text) > maxTextWidth) lines = wrapToTwoLines(text, measureWorld, maxTextWidth);
    lines = lines.map((line) => truncateToWidth(line, measureWorld, maxTextWidth));
    const width = Math.max(...lines.map(measureWorld)) + LABEL_PILL_PADDING_X;
    const height = lines.length > 1 ? LABEL_PILL_HEIGHT_2_LINE : LABEL_PILL_HEIGHT_1_LINE;
    const x = Math.min(maxX - width / 2, Math.max(minX + width / 2, edge.labelAnchor.x));
    pills.push({ edgeId: edge.id, lines, x, y: edge.labelAnchor.y, width, height });
  }
  return pills;
}

function rectsIntersect(a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }, gapX: number): boolean {
  const sharesYBand = a.top < b.bottom && b.top < a.bottom;
  if (!sharesYBand) return false;
  const gap = a.right <= b.left ? b.left - a.right : b.right <= a.left ? a.left - b.right : -1;
  return gap < gapX;
}

function pillRect(p: EdgeLabelPill): { left: number; right: number; top: number; bottom: number } {
  return { left: p.x - p.width / 2, right: p.x + p.width / 2, top: p.y - p.height / 2, bottom: p.y + p.height / 2 };
}

/**
 * Rework item 4: true when any two pills crowd each other (closer than
 * `LABEL_MIN_GAP_X` while sharing a y band) or any pill overlaps a tile.
 * The canvas defaults edge labels to hidden when this is true, rather than
 * pushing/wrapping labels into a layout nobody can read; the reviewer's
 * "Labels" toggle overrides either way.
 */
export function edgeLabelsCollide(pills: readonly EdgeLabelPill[], tiles: readonly DiagramTile[]): boolean {
  for (let i = 0; i < pills.length; i += 1) {
    const a = pills[i];
    if (!a) continue;
    const ra = pillRect(a);
    for (let j = i + 1; j < pills.length; j += 1) {
      const b = pills[j];
      if (b && rectsIntersect(ra, pillRect(b), LABEL_MIN_GAP_X)) return true;
    }
    for (const tile of tiles) {
      if (rectsIntersect(ra, { left: tile.x, right: tile.x + tile.w, top: tile.y, bottom: tile.y + tile.h }, 0)) return true;
    }
  }
  return false;
}

/** Distance from `p` to the closest point on segment `a`–`b`. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** The routed edge whose polyline passes within `tolerance` of `p` (world units), nearest first; `null` when none does. Hover/tap-to-reveal for hidden labels (rework item 4). */
export function edgeNear(edges: readonly RoutedEdge[], p: Point, tolerance: number): RoutedEdge | null {
  let best: { edge: RoutedEdge; distance: number } | null = null;
  for (const edge of edges) {
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      if (!a || !b) continue;
      const distance = distanceToSegment(p, a, b);
      if (distance <= tolerance && (best === null || distance < best.distance)) best = { edge, distance };
    }
  }
  return best?.edge ?? null;
}
