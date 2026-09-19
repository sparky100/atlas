/**
 * Context diagram layout v2: a pure, deterministic function (CLAUDE.md rule
 * 6) producing tile positions, orthogonal edge routes and label anchors for
 * `ContextDiagramCanvas.tsx`. Replaces v1's single "fan below the hub" shape
 * with a ring: the hub sits in the middle, and every neighbour is grouped by
 * its *dominant relationship direction* to the hub rather than dumped into
 * one growing row —
 *
 *  - **source** (every edge flows into the hub — "used by") sits in a
 *    column to the hub's **left**.
 *  - **target** (every edge flows out of the hub — "uses") sits in a column
 *    to the hub's **right**.
 *  - **two-way** (at least one edge each way) sits in a row **below** the
 *    hub — see "Bidirectional pairs" below for how such a neighbour's own
 *    opposing edges draw.
 *  - **actor** (any `element_type: 'actor'` neighbour, regardless of
 *    direction — a person or team reads differently from a system
 *    dependency, so this overrides the direction grouping above) sits in a
 *    row **above** the hub.
 *
 * Each group is ordered internal-neighbours-first (closest to the hub),
 * then external ones (Sprint S1 item 11a's own boundary, still enforced —
 * see "Internal/external and the boundary" below), capped at
 * `MAX_PER_BAND` (4) entries per band before continuing into a further band
 * (`bandIndexOf`) — a column's second band is a second, more distant
 * column; a row's second band is a second, more distant row.
 *
 * **Ports.** Every edge attaches to whichever hub side its group owns
 * (`spreadAlong` the hub's own edge on that side — left/right spread
 * vertically, above/below spread horizontally), and to its own neighbour
 * tile's hub-facing edge the same way. A routed edge is a three-segment
 * orthogonal "Z": the neighbour's own port, straight to a **lane** — a
 * unique coordinate in the gap between the group and the hub, so no two
 * edges' lines ever share a segment — then straight into the hub's own
 * port.
 *
 * **Why no riser is needed for a second band.** v1's fan had every row
 * stacked with no gap between one row's own channel and the next, so a
 * deeper row's edge needed a deliberate detour ("riser") outside the extent
 * of every row above it to avoid cutting through a tile. Here, a band's
 * position along the *group's own stacking axis* (y for a column, x for a
 * row) is assigned strictly sequentially across every band in the group —
 * band 1 never occupies the same stacking-axis range as band 0 — so a
 * band-1 edge's own straight run back to the lane simply never passes
 * through the stacking-axis range any band-0 tile occupies. The only
 * axis where bands actually differ is the *depth* axis (x for a column,
 * y for a row), and lanes already live strictly between the group and the
 * hub on that axis, never inside a tile's own footprint.
 *
 * **Internal/external and the boundary.** Ordering a group
 * internal-then-external keeps every internal tile strictly closer to the
 * hub (in stacking-axis order, hence never a smaller band index) than every
 * external one, the same invariant v1's own internal-row/external-row split
 * relied on — so the enterprise boundary (`DiagramBoundary`, a bounding box
 * now that neighbours surround the hub on four sides rather than one) can
 * still just be "hub plus every internal tile," and an external tile can
 * never end up inside it.
 *
 * **Bidirectional pairs.** A two-way neighbour's own opposing edges
 * (one `arrowAtHub`, one not) draw as a *single* routed edge with an
 * arrowhead at both ends (`arrowAtNeighbour`) and both verbs in one label
 * ("`verb in / verb out`") — one line, not two separately routed ones that
 * would otherwise sit on top of each other. `relationshipIds` on that
 * `RoutedEdge` carries both original relationship ids, so a caller can
 * still tell which real edges it represents. A neighbour with more edges
 * one way than the other pairs up what it can and draws any leftover as an
 * ordinary single-direction edge in the same band.
 */
import type { UUID } from '../../contracts/delta';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

const PADDING = 32;
export const MIN_DIAGRAM_WIDTH = 960;
/** Padding between the boundary's bounding box and the dashed line drawn around it. */
export const BOUNDARY_MARGIN = 8;

const LABEL_MARGIN = 10;
export const LABEL_PITCH = 26;
/** How far a label pill may extend past its own tile's edge into the gap for a row group (top/bottom) — capped so a pill on an outermost tile never reaches a lane. */
const LABEL_OVERHANG_MAX = 16;
/** A column-group (left/right) label has no neighbouring tile to share width with — its own edge sits in open gap space — so it gets a fixed generous budget instead of a tile-span-derived one. */
const COLUMN_LABEL_MAX_WIDTH = 140;

/** Gap between the hub's own top/bottom edge and the nearest actor/two-way tile. */
const GAP_HUB_TB = 64;
/** Gap between two tiles stacked along a group's own stacking axis. */
const TILE_GUTTER = 20;
/** Extra distance a further band sits beyond the one before it, along the depth axis. */
const BAND_GAP = 40;
/** Extra gap, on the stacking axis, between a group's last internal tile and its first external one — the same "externals sit clearly outside" gap v1's own external band kept. */
const EXTERNAL_GAP = 32;
/** Never more than this many entries in one band before the layout starts a further one. */
const MAX_PER_BAND = 4;

export const LABEL_PILL_PADDING_X = 12;
export const LABEL_PILL_HEIGHT_1_LINE = 18;
export const LABEL_PILL_HEIGHT_2_LINE = 30;
/** Two pills closer than this in x, sharing a y band, count as colliding (`edgeLabelsCollide`) — crowded, not just touching. */
const LABEL_MIN_GAP_X = 6;
/** Distance between consecutive label slots in a column group's own multi-edge stack — wide enough that two full-`COLUMN_LABEL_MAX_WIDTH` pills never overlap, whatever their real text (`layoutColumn`'s own comment on why this differs from the row engine's much smaller `LABEL_PITCH`). */
const COLUMN_LABEL_PITCH = COLUMN_LABEL_MAX_WIDTH + LABEL_MIN_GAP_X;

export interface DiagramTile {
  elementId: UUID;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The dashed enterprise boundary's bounding box — `null` when the hub has no internal neighbour at all (nothing to enclose). */
export interface DiagramBoundary {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EdgeLabelAnchor {
  /** Centre the pill wants to sit at, before clamping. */
  x: number;
  y: number;
  /** The pill's allowed horizontal centre range — `minX === maxX` fixes it (a column-group label's own stacking axis). */
  minX: number;
  maxX: number;
  /** The pill's allowed vertical centre range — `minY === maxY` fixes it (a row-group label's own stacking axis). */
  minY: number;
  maxY: number;
}

export interface RoutedEdge {
  /** A merged bidirectional pair's own id is its "in" edge's id — an arbitrary but deterministic choice; `relationshipIds` below carries both. */
  id: UUID;
  neighbourId: UUID;
  /** A merged bidirectional pair's own two verbs, `"in / out"` — never two separately drawn labels. */
  label: string;
  /** True when the hub-anchor end carries an arrowhead — always true for a merged bidirectional pair. */
  arrowAtHub: boolean;
  /** True only for a merged bidirectional pair — a second arrowhead at the neighbour end too. */
  arrowAtNeighbour: boolean;
  /** The polyline, neighbour end first, hub end last — every segment is axis-aligned. */
  points: Point[];
  neighbourAnchor: Point;
  hubAnchor: Point;
  labelAnchor: EdgeLabelAnchor;
  /** The original relationship id(s) this routed edge represents — one, except for a merged bidirectional pair (two). */
  relationshipIds: readonly UUID[];
}

export interface ContextDiagramLayout {
  hub: DiagramTile;
  /** Every neighbour tile, hub excluded — v1's own `internalNeighbours`/`externalNeighbours` split is gone; a tile's own `isExternal` fact is read from element data by the caller, same as it always was for the dashed-outline treatment. */
  neighbours: DiagramTile[];
  boundary: DiagramBoundary | null;
  width: number;
  height: number;
  edges: RoutedEdge[];
}

/** One `uses`/`flows_to` edge to draw — always neighbour ↔ hub, the arrow's direction, and the verb label. */
export interface ContextEdgeInput {
  id: UUID;
  neighbourId: UUID;
  arrowAtHub: boolean;
  label: string;
}

/** One neighbour to place — direction (from its own edges) and actor-hood decide which of the four groups it lands in; `isExternal` decides how far out within that group. */
export interface ContextNeighbourInput {
  id: UUID;
  isExternal: boolean;
  isActor: boolean;
}

export type NeighbourGroupKind = 'source' | 'target' | 'twoWay' | 'actor';

/**
 * An actor is always `'actor'` (a person/team reads differently from a
 * system dependency, regardless of which way its own edges point).
 * Otherwise: edges only into the hub → `'source'` (left); edges only out of
 * the hub → `'target'` (right); both → `'twoWay'` (below).
 */
export function classifyNeighbourGroup(isActor: boolean, edges: readonly ContextEdgeInput[]): NeighbourGroupKind {
  if (isActor) return 'actor';
  const hasIn = edges.some((e) => e.arrowAtHub);
  const hasOut = edges.some((e) => !e.arrowAtHub);
  if (hasIn && hasOut) return 'twoWay';
  return hasIn ? 'source' : 'target';
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `count` attach points spread evenly along a span, never on its ends — index `i` of `count` sits at `(i + 1) / (count + 1)` of the way across. */
export function spreadAlong(from: number, width: number, index: number, count: number): number {
  return from + (width * (index + 1)) / (count + 1);
}

/** Which band (0 = nearest the hub) the tile at `position` in a group's own internal-then-external order falls in — a further band every `MAX_PER_BAND` entries. */
export function bandIndexOf(position: number): number {
  return Math.floor(position / MAX_PER_BAND);
}

/** One edge as this file's own routing needs it — every `ContextEdgeInput` becomes one of these; a two-way neighbour's own opposing pair becomes one merged one (see module comment, "Bidirectional pairs"). */
interface LayoutEdge {
  id: UUID;
  neighbourId: UUID;
  label: string;
  arrowAtHub: boolean;
  arrowAtNeighbour: boolean;
  relationshipIds: readonly UUID[];
}

/** Rework: merges a two-way neighbour's own `in`/`out` edges into as many single bidirectional `LayoutEdge`s as pairs exist, pairing in id order for determinism; any edges left over (an uneven in/out count) draw as ordinary single-direction `LayoutEdge`s instead. */
function mergeTwoWayEdges(edges: readonly ContextEdgeInput[]): LayoutEdge[] {
  const inbound = edges.filter((e) => e.arrowAtHub).sort((a, b) => compareIds(a.id, b.id));
  const outbound = edges.filter((e) => !e.arrowAtHub).sort((a, b) => compareIds(a.id, b.id));
  const pairCount = Math.min(inbound.length, outbound.length);
  const merged: LayoutEdge[] = [];
  for (let i = 0; i < pairCount; i += 1) {
    const inEdge = inbound[i];
    const outEdge = outbound[i];
    if (!inEdge || !outEdge) continue;
    merged.push({ id: inEdge.id, neighbourId: inEdge.neighbourId, label: `${inEdge.label} / ${outEdge.label}`, arrowAtHub: true, arrowAtNeighbour: true, relationshipIds: [inEdge.id, outEdge.id] });
  }
  for (const leftover of [...inbound.slice(pairCount), ...outbound.slice(pairCount)]) {
    merged.push({ id: leftover.id, neighbourId: leftover.neighbourId, label: leftover.label, arrowAtHub: leftover.arrowAtHub, arrowAtNeighbour: false, relationshipIds: [leftover.id] });
  }
  return merged;
}

interface PlacedTile {
  id: UUID;
  /** Position along the group's own stacking axis (y for a column, x for a row), before the group's own overall offset is applied. */
  along: number;
  /** Which band (depth from the hub) this tile sits in. */
  band: number;
}

/**
 * Internal-then-external order, each sorted by id for a deterministic
 * tie-break, stacked sequentially along the group's own axis (`tileSize`
 * is `NODE_HEIGHT` for a column, `NODE_WIDTH` for a row — the two axes
 * this file lays groups out on are different sizes) with an extra
 * `EXTERNAL_GAP` at the internal/external join, and banded every
 * `MAX_PER_BAND` — *within* the internal list and *within* the external
 * list separately, an external tile's own band starting from however many
 * bands the internal list needed, so an external tile is never in the same
 * band as an internal one even when neither list alone reaches
 * `MAX_PER_BAND` (see the module comment's "why no riser is needed" for
 * what disjoint bands buy, and `computeContextDiagramLayout`'s own
 * boundary comment for why internal/external must never share one).
 */
function placeGroup(internalIds: readonly UUID[], externalIds: readonly UUID[], tileSize: number): { placed: PlacedTile[]; span: number } {
  const internalSorted = [...internalIds].sort(compareIds);
  const externalSorted = [...externalIds].sort(compareIds);
  const internalBandCount = internalSorted.length === 0 ? 0 : bandIndexOf(internalSorted.length - 1) + 1;
  const placed: PlacedTile[] = [];
  let along = 0;
  internalSorted.forEach((id, position) => {
    placed.push({ id, along, band: bandIndexOf(position) });
    along += tileSize + TILE_GUTTER;
  });
  if (internalSorted.length > 0 && externalSorted.length > 0) along += EXTERNAL_GAP - TILE_GUTTER;
  externalSorted.forEach((id, position) => {
    placed.push({ id, along, band: internalBandCount + bandIndexOf(position) });
    along += tileSize + TILE_GUTTER;
  });
  const span = along > 0 ? along - TILE_GUTTER : 0;
  return { placed, span };
}

function clampCenter(anchor: number, min: number, max: number, size: number): number {
  if (min === max) return min;
  return Math.min(max - size / 2, Math.max(min + size / 2, anchor));
}

interface GroupResult {
  tiles: DiagramTile[];
  edges: RoutedEdge[];
  internalIds: ReadonlySet<UUID>;
}

/** "Don't let a label pill reach into the next tile's own space along the group's stacking axis" — the same shape v1's own `LABEL_OVERHANG_MAX` clamp kept, sized off this file's fixed `TILE_GUTTER` now that every group uses one fixed gutter rather than a per-row computed one. */
const TILE_LABEL_OVERHANG = Math.min(LABEL_OVERHANG_MAX, (TILE_GUTTER - LABEL_MIN_GAP_X) / 2);

/** Every edge touching this group's own neighbours, in a deterministic draw/port order: by neighbour (in the order `placed` already stacks them), then by edge id within a neighbour — so a neighbour's own edges' hub-side ports land next to each other, same as v1's own attach-order convention. */
function flattenGroupEdges(placed: readonly PlacedTile[], edgesByNeighbour: ReadonlyMap<UUID, LayoutEdge[]>): LayoutEdge[] {
  const result: LayoutEdge[] = [];
  for (const p of placed) {
    const edges = [...(edgesByNeighbour.get(p.id) ?? [])].sort((a, b) => compareIds(a.id, b.id));
    result.push(...edges);
  }
  return result;
}

/**
 * A source/target column: `sign` is `-1` (left, source) or `+1` (right,
 * target). Tiles stack down the group's own y axis (`placeGroup`),
 * vertically centred on the hub's own vertical span; a tile's own band
 * decides its x, a further band always farther from the hub than a nearer
 * one. Every edge's own lane is a unique x strictly between the group and
 * the hub — safe for every band, not just band 0, because a band's own y
 * range never overlaps a nearer band's (module comment, "why no riser is
 * needed").
 */
function layoutColumn(sign: -1 | 1, internalIds: readonly UUID[], externalIds: readonly UUID[], edgesByNeighbour: ReadonlyMap<UUID, LayoutEdge[]>, hub: DiagramTile): GroupResult {
  const { placed, span } = placeGroup(internalIds, externalIds, NODE_HEIGHT);
  // A neighbour with more than one edge stacks that many label pills, each
  // up to `COLUMN_LABEL_MAX_WIDTH` wide, along the gap — `COLUMN_LABEL_PITCH`
  // spaces consecutive slots far enough apart that two full-width pills
  // never overlap regardless of their real text, and the gap itself widens
  // to fit however many slots this side's *most*-connected neighbour needs
  // (mirroring how a row's own channel height grows with its own densest
  // neighbour's label stack).
  const maxEdgesPerNeighbour = Math.max(1, ...placed.map((p) => edgesByNeighbour.get(p.id)?.length ?? 1));
  const gap = 2 * LABEL_MARGIN + COLUMN_LABEL_MAX_WIDTH + (maxEdgesPerNeighbour - 1) * COLUMN_LABEL_PITCH;
  const yStart = hub.y + (hub.h - span) / 2;
  const tileAt = new Map<UUID, DiagramTile>();
  const tiles: DiagramTile[] = placed.map((p) => {
    const tile: DiagramTile = {
      elementId: p.id,
      x: sign === -1 ? hub.x - gap - NODE_WIDTH - p.band * (NODE_WIDTH + BAND_GAP) : hub.x + hub.w + gap + p.band * (NODE_WIDTH + BAND_GAP),
      y: yStart + p.along,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    };
    tileAt.set(p.id, tile);
    return tile;
  });

  const flat = flattenGroupEdges(placed, edgesByNeighbour);
  const laneCount = flat.length;
  const edges: RoutedEdge[] = flat.map((edge, k) => {
    const tile = tileAt.get(edge.neighbourId);
    if (!tile) return null;
    const siblings = [...(edgesByNeighbour.get(edge.neighbourId) ?? [])].sort((a, b) => compareIds(a.id, b.id));
    const slot = Math.max(0, siblings.findIndex((s) => s.id === edge.id));
    const neighbourPortY = spreadAlong(tile.y, NODE_HEIGHT, slot, siblings.length);
    const hubPortY = spreadAlong(hub.y, hub.h, k, laneCount);
    const laneX = sign === -1 ? hub.x - gap + spreadAlong(0, gap, k, laneCount) : hub.x + hub.w + spreadAlong(0, gap, k, laneCount);
    const neighbourAnchor: Point = { x: sign === -1 ? tile.x + tile.w : tile.x, y: neighbourPortY };
    const hubAnchor: Point = { x: sign === -1 ? hub.x : hub.x + hub.w, y: hubPortY };
    // Centred at least half of `COLUMN_LABEL_MAX_WIDTH` past the tile's own edge, so even a full-width pill clears the tile — `gap`'s own sizing above gives this (and the matching clearance from the hub, and from a sibling slot) room.
    const labelX = sign === -1 ? tile.x + tile.w + LABEL_MARGIN + COLUMN_LABEL_MAX_WIDTH / 2 + slot * COLUMN_LABEL_PITCH : tile.x - LABEL_MARGIN - COLUMN_LABEL_MAX_WIDTH / 2 - slot * COLUMN_LABEL_PITCH;
    return {
      id: edge.id,
      neighbourId: edge.neighbourId,
      label: edge.label,
      arrowAtHub: edge.arrowAtHub,
      arrowAtNeighbour: edge.arrowAtNeighbour,
      points: [neighbourAnchor, { x: laneX, y: neighbourPortY }, { x: laneX, y: hubPortY }, hubAnchor],
      neighbourAnchor,
      hubAnchor,
      labelAnchor: { x: labelX, y: neighbourPortY, minX: labelX, maxX: labelX, minY: tile.y - TILE_LABEL_OVERHANG, maxY: tile.y + tile.h + TILE_LABEL_OVERHANG },
      relationshipIds: edge.relationshipIds,
    };
  }).filter((e): e is RoutedEdge => e !== null);

  return { tiles, edges, internalIds: new Set(internalIds) };
}

/**
 * An actor/two-way row: `sign` is `-1` (above, actor) or `+1` (below,
 * two-way). Tiles stack along the group's own x axis (`placeGroup`),
 * horizontally centred on the hub's own horizontal span; a tile's own band
 * decides its y, further from the hub band by band — the row's own analogue
 * of `layoutColumn`'s column, x and y swapped.
 */
function layoutRow(sign: -1 | 1, internalIds: readonly UUID[], externalIds: readonly UUID[], edgesByNeighbour: ReadonlyMap<UUID, LayoutEdge[]>, hub: DiagramTile): GroupResult {
  const { placed, span } = placeGroup(internalIds, externalIds, NODE_WIDTH);
  const xStart = hub.x + (hub.w - span) / 2;
  const tileAt = new Map<UUID, DiagramTile>();
  const tiles: DiagramTile[] = placed.map((p) => {
    const tile: DiagramTile = {
      elementId: p.id,
      x: xStart + p.along,
      y: sign === -1 ? hub.y - GAP_HUB_TB - NODE_HEIGHT - p.band * (NODE_HEIGHT + BAND_GAP) : hub.y + hub.h + GAP_HUB_TB + p.band * (NODE_HEIGHT + BAND_GAP),
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    };
    tileAt.set(p.id, tile);
    return tile;
  });

  const flat = flattenGroupEdges(placed, edgesByNeighbour);
  const laneCount = flat.length;
  const edges: RoutedEdge[] = flat.map((edge, k) => {
    const tile = tileAt.get(edge.neighbourId);
    if (!tile) return null;
    const siblings = [...(edgesByNeighbour.get(edge.neighbourId) ?? [])].sort((a, b) => compareIds(a.id, b.id));
    const slot = Math.max(0, siblings.findIndex((s) => s.id === edge.id));
    const neighbourPortX = spreadAlong(tile.x, NODE_WIDTH, slot, siblings.length);
    const hubPortX = spreadAlong(hub.x, hub.w, k, laneCount);
    const laneY = sign === -1 ? hub.y - spreadAlong(0, GAP_HUB_TB, k, laneCount) : hub.y + hub.h + spreadAlong(0, GAP_HUB_TB, k, laneCount);
    const neighbourAnchor: Point = { x: neighbourPortX, y: sign === -1 ? tile.y + tile.h : tile.y };
    const hubAnchor: Point = { x: hubPortX, y: sign === -1 ? hub.y : hub.y + hub.h };
    const labelY = sign === -1 ? tile.y + tile.h + LABEL_MARGIN + LABEL_PITCH / 2 + slot * LABEL_PITCH : tile.y - LABEL_MARGIN - LABEL_PITCH / 2 - slot * LABEL_PITCH;
    return {
      id: edge.id,
      neighbourId: edge.neighbourId,
      label: edge.label,
      arrowAtHub: edge.arrowAtHub,
      arrowAtNeighbour: edge.arrowAtNeighbour,
      points: [neighbourAnchor, { x: neighbourPortX, y: laneY }, { x: hubPortX, y: laneY }, hubAnchor],
      neighbourAnchor,
      hubAnchor,
      labelAnchor: { x: neighbourPortX, y: labelY, minX: tile.x - TILE_LABEL_OVERHANG, maxX: tile.x + tile.w + TILE_LABEL_OVERHANG, minY: labelY, maxY: labelY },
      relationshipIds: edge.relationshipIds,
    };
  }).filter((e): e is RoutedEdge => e !== null);

  return { tiles, edges, internalIds: new Set(internalIds) };
}

/**
 * @param hubId The system or container this Context view is scoped to.
 * @param neighbours Every neighbour reached by a drawn `uses`/`flows_to` edge — direction (from `edges`) and `isActor` decide its group (`classifyNeighbourGroup`); `isExternal` decides how far out within that group.
 * @param widthHint The canvas's own on-screen width at layout time — a floor on the returned `width`, same `MIN_DIAGRAM_WIDTH` shape `layout.ts`'s own `layoutWidthHint` uses; wrapping itself is count-based now (`MAX_PER_BAND`), not width-based.
 * @param edges Every drawn edge — sizes the groups and is routed into `ContextDiagramLayout.edges`. Empty is a valid (edgeless) layout.
 */
export function computeContextDiagramLayout(hubId: UUID, neighbours: readonly ContextNeighbourInput[], widthHint: number = MIN_DIAGRAM_WIDTH, edges: readonly ContextEdgeInput[] = []): ContextDiagramLayout {
  const edgesByNeighbourRaw = new Map<UUID, ContextEdgeInput[]>();
  for (const e of edges) {
    const list = edgesByNeighbourRaw.get(e.neighbourId) ?? [];
    list.push(e);
    edgesByNeighbourRaw.set(e.neighbourId, list);
  }

  const groupOf = new Map<UUID, NeighbourGroupKind>();
  for (const n of neighbours) groupOf.set(n.id, classifyNeighbourGroup(n.isActor, edgesByNeighbourRaw.get(n.id) ?? []));

  // Every neighbour's own edges, as this file's routing needs them — a two-way neighbour's own opposing pair merges into one bidirectional `LayoutEdge` (module comment).
  const edgesByNeighbour = new Map<UUID, LayoutEdge[]>();
  for (const n of neighbours) {
    const raw = edgesByNeighbourRaw.get(n.id) ?? [];
    const kind = groupOf.get(n.id);
    edgesByNeighbour.set(n.id, kind === 'twoWay' ? mergeTwoWayEdges(raw) : raw.map((e) => ({ id: e.id, neighbourId: e.neighbourId, label: e.label, arrowAtHub: e.arrowAtHub, arrowAtNeighbour: false, relationshipIds: [e.id] })));
  }

  const idsOf = (kind: NeighbourGroupKind, external: boolean): UUID[] => neighbours.filter((n) => groupOf.get(n.id) === kind && n.isExternal === external).map((n) => n.id);

  const hub: DiagramTile = { elementId: hubId, x: 0, y: 0, w: NODE_WIDTH, h: NODE_HEIGHT };
  const left = layoutColumn(-1, idsOf('source', false), idsOf('source', true), edgesByNeighbour, hub);
  const right = layoutColumn(1, idsOf('target', false), idsOf('target', true), edgesByNeighbour, hub);
  const above = layoutRow(-1, idsOf('actor', false), idsOf('actor', true), edgesByNeighbour, hub);
  const below = layoutRow(1, idsOf('twoWay', false), idsOf('twoWay', true), edgesByNeighbour, hub);

  const allTiles = [...left.tiles, ...right.tiles, ...above.tiles, ...below.tiles];
  const allEdges = [...left.edges, ...right.edges, ...above.edges, ...below.edges].sort((a, b) => compareIds(a.id, b.id));
  const internalTileIds = new Set([...left.internalIds, ...right.internalIds, ...above.internalIds, ...below.internalIds]);
  const internalTiles = allTiles.filter((t) => internalTileIds.has(t.elementId));

  const boundary: DiagramBoundary | null =
    internalTiles.length === 0
      ? null
      : {
          left: Math.min(hub.x, ...internalTiles.map((t) => t.x)),
          top: Math.min(hub.y, ...internalTiles.map((t) => t.y)),
          right: Math.max(hub.x + hub.w, ...internalTiles.map((t) => t.x + t.w)),
          bottom: Math.max(hub.y + hub.h, ...internalTiles.map((t) => t.y + t.h)),
        };

  // Normalise: everything above was placed relative to the hub at the origin, so a source/actor group can leave the layout with negative coordinates — translate the whole thing to sit inside `PADDING`, exactly as `layout.ts`'s own canvases keep their own world origin non-negative.
  const allPoints = [hub, ...allTiles].flatMap((t) => [{ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.h }]);
  for (const e of allEdges) allPoints.push(...e.points);
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const maxY = Math.max(...allPoints.map((p) => p.y));
  const dx = PADDING - minX;
  const dy = PADDING - minY;

  const shiftTile = (t: DiagramTile): DiagramTile => ({ ...t, x: t.x + dx, y: t.y + dy });
  const shiftPoint = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const shiftedHub = shiftTile(hub);
  const shiftedNeighbours = allTiles.map(shiftTile);
  const shiftedEdges = allEdges.map((e) => ({
    ...e,
    points: e.points.map(shiftPoint),
    neighbourAnchor: shiftPoint(e.neighbourAnchor),
    hubAnchor: shiftPoint(e.hubAnchor),
    labelAnchor: { ...e.labelAnchor, x: e.labelAnchor.x + dx, y: e.labelAnchor.y + dy, minX: e.labelAnchor.minX + dx, maxX: e.labelAnchor.maxX + dx, minY: e.labelAnchor.minY + dy, maxY: e.labelAnchor.maxY + dy },
  }));
  const shiftedBoundary: DiagramBoundary | null = boundary && { left: boundary.left + dx, top: boundary.top + dy, right: boundary.right + dx, bottom: boundary.bottom + dy };

  return {
    hub: shiftedHub,
    neighbours: shiftedNeighbours,
    boundary: shiftedBoundary,
    width: Math.max(MIN_DIAGRAM_WIDTH, widthHint, maxX - minX + 2 * PADDING),
    height: maxY - minY + 2 * PADDING,
    edges: shiftedEdges,
  };
}

/** Every tile in a completed layout, hub included — the flat list `ContextDiagramCanvas.tsx` needs for hit-testing. */
export function allTilesOf(layout: ContextDiagramLayout): DiagramTile[] {
  return [layout.hub, ...layout.neighbours];
}

// ---------------------------------------------------------------------------
// Labels
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
 * One pill per routed edge, on its own leader (the edge's drop at the
 * neighbour), in its own slot of that neighbour's label stack, clamped to
 * the tile's allowed span on whichever axis the group's own stacking runs
 * (`EdgeLabelAnchor.minX`/`maxX` for a row group, `minY`/`maxY` for a
 * column group — `clampCenter` treats a degenerate `min === max` range,
 * the fixed slot axis, as already-fixed rather than clamping it). A column
 * group's pill has no tile-span-derived width limit (its own edge sits in
 * open gap space, not beside a sibling tile) — `COLUMN_LABEL_MAX_WIDTH`
 * instead, detected by that same `minX === maxX`. Text that doesn't fit
 * wraps to two lines; a line that still doesn't fit is ellipsized. Pure:
 * `measureWorld` is the canvas's own `measureText` divided by the current
 * scale, so widths come back in world units.
 */
export function placeEdgeLabels(edges: readonly RoutedEdge[], measureWorld: (text: string) => number): EdgeLabelPill[] {
  const pills: EdgeLabelPill[] = [];
  for (const edge of edges) {
    const text = edge.label.trim();
    if (text.length === 0) continue;
    const { minX, maxX, minY, maxY } = edge.labelAnchor;
    const maxPillWidth = minX === maxX ? COLUMN_LABEL_MAX_WIDTH : Math.max(LABEL_PILL_PADDING_X * 2, maxX - minX);
    const maxTextWidth = maxPillWidth - LABEL_PILL_PADDING_X;
    let lines: string[] = [text];
    if (measureWorld(text) > maxTextWidth) lines = wrapToTwoLines(text, measureWorld, maxTextWidth);
    lines = lines.map((line) => truncateToWidth(line, measureWorld, maxTextWidth));
    const width = Math.max(...lines.map(measureWorld)) + LABEL_PILL_PADDING_X;
    const height = lines.length > 1 ? LABEL_PILL_HEIGHT_2_LINE : LABEL_PILL_HEIGHT_1_LINE;
    const x = clampCenter(edge.labelAnchor.x, minX, maxX, width);
    const y = clampCenter(edge.labelAnchor.y, minY, maxY, height);
    pills.push({ edgeId: edge.id, lines, x, y, width, height });
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
 * True when any two pills crowd each other (closer than `LABEL_MIN_GAP_X`
 * while sharing a y band) or any pill overlaps a tile. The canvas defaults
 * edge labels to hidden when this is true, rather than pushing/wrapping
 * labels into a layout nobody can read; the reviewer's "Labels" toggle
 * overrides either way.
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

/** The routed edge whose polyline passes within `tolerance` of `p` (world units), nearest first; `null` when none does. Hover/tap-to-reveal for hidden labels. */
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
