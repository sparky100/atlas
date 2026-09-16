/**
 * V1's own layout algorithm (docs/prompts/atlas-prompt-pack.md, "### V1 —
 * the context diagram"): a pure, deterministic function (CLAUDE.md rule 6)
 * producing tile positions for the Context view's canvas renderer —
 * `ContextDiagramCanvas.tsx`. Reuses `layout.ts`'s own tile size constants
 * (`NODE_WIDTH`/`NODE_HEIGHT`) and its structural shape (an enterprise
 * boundary with an external band below it) so the context diagram reads as
 * "the same renderer, a different query and layout preset" (UI-principles
 * §6.1's own closing paragraph) rather than a fresh visual language.
 *
 * Unlike the landscape, an actor reaching the hub via a drawn `uses` edge
 * (S1 item 11a) is just another neighbour tile here, not a separate
 * structural row the way the landscape's own actors are (that row exists
 * there because a landscape actor has no lane placement of its own to
 * belong to; a context-diagram actor always has a real edge to draw, so it
 * belongs in the same wrapped row as every other neighbour, distinguished
 * only by its own person-icon glyph — `ContextDiagramCanvas.tsx`'s own
 * concern, not this layout's). An `owns`-only actor (`ContextGroup.owners`)
 * never reaches this module at all: "Header keeps ... Owned by" keeps that
 * fact in the DOM header block, unchanged.
 *
 * No obstacle-routed edges (`routeLandscapeEdge`'s own channel-based
 * detours) — a hub's own immediate neighbours are a bounded handful, never
 * landscape-scale, and straight lines from tile to tile are the common
 * case.
 *
 * V3 ("container context pages, platform context simplified to structure
 * only"): every module/platform-tile-nesting concept this file used to
 * carry — `ModuleTile`, a widened hub tile, column-aligned neighbour
 * stacking beneath a specific module, the "which module?" fallback anchor —
 * is gone. A platform-with-modules hub is no longer laid out here at all;
 * it gets its own separate, much simpler structure-only page
 * (`PlatformStructureView.tsx`) with no neighbours and no edges to route.
 * Every hub this file ever lays out now is a plain tile — a system, or one
 * container viewed on its own — with a bounded set of its own direct
 * neighbours, exactly the "one system or one container's own relationships
 * at a time" scope the V3 request itself names. What's left below
 * (wrapped, centre-weighted neighbour rows; curved edges; label-overlap
 * resolution) is unchanged, because a single hub can still have enough
 * neighbours to need wrapping and label-collision avoidance — that part of
 * the crowding problem was never about modules.
 */
import type { UUID } from '../../contracts/delta';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

const TILE_GUTTER_X = 24;
const TILE_GUTTER_Y = 20;
/** The gap between the hub row and the internal neighbour row. Edges curve through this gap (`curveBetween`) with a label pill sitting at its own vertical midpoint — wide enough to hold both a curve's own clearance and a label pill comfortably. */
const ROW_GUTTER_Y = 56;
const PADDING = 32;
export const BOUNDARY_MARGIN = 8;
/** The boundary→external gap — same reasoning as `ROW_GUTTER_Y`. */
const EXTERNAL_GUTTER_Y = 56;
export const MIN_DIAGRAM_WIDTH = 960;

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

export interface ContextDiagramLayout {
  hub: DiagramTile;
  internalNeighbours: DiagramTile[];
  externalNeighbours: DiagramTile[];
  boundary: DiagramBoundary;
  width: number;
  height: number;
}

function byElementId(a: UUID, b: UUID): number {
  return a.localeCompare(b);
}

/**
 * One row of tiles, wrapped left-to-right at `availableWidth` — every tile
 * this diagram ever places is the same fixed `NODE_WIDTH`×`NODE_HEIGHT`
 * size (V3 dropped the one case that varied it, a platform's own widened
 * tile), so this packs a simple, uniform-width row rather than needing to
 * size each tile individually first.
 *
 * "Centre-weighted layout": each wrapped row is centred within
 * `availableWidth` on its own (the hub above it is already centred the same
 * way — `computeContextDiagramLayout`'s own `hubX`) rather than hugging the
 * left edge, so a short last row (the common case — neighbours rarely
 * divide evenly into full rows) reads as balanced around the hub's own
 * centre line instead of stranded to one side.
 */
function packRow(elementIds: readonly UUID[], top: number, availableWidth: number, originX: number): { tiles: DiagramTile[]; height: number } {
  if (elementIds.length === 0) return { tiles: [], height: 0 };
  const perRow = Math.max(1, Math.floor((availableWidth + TILE_GUTTER_X) / (NODE_WIDTH + TILE_GUTTER_X)));
  const sorted = [...elementIds].sort(byElementId);

  const tiles: DiagramTile[] = [];
  let y = top;
  for (let i = 0; i < sorted.length; i += perRow) {
    const row = sorted.slice(i, i + perRow);
    const rowWidth = row.length * NODE_WIDTH + (row.length - 1) * TILE_GUTTER_X;
    let x = originX + (availableWidth - rowWidth) / 2;
    for (const elementId of row) {
      tiles.push({ elementId, x, y, w: NODE_WIDTH, h: NODE_HEIGHT });
      x += NODE_WIDTH + TILE_GUTTER_X;
    }
    y += NODE_HEIGHT + TILE_GUTTER_Y;
  }
  return { tiles, height: y - TILE_GUTTER_Y - top };
}

/**
 * @param hubId The system or container this Context view is scoped to.
 * @param internalNeighbourIds Non-external `uses`/`flows_to` neighbours — systems, containers (S1 item 20) and actors (S1 item 11a) alike.
 * @param externalNeighbourIds Same, for `isExternal` neighbours — placed below the boundary, same as the landscape's own external band.
 * @param widthHint The canvas's own on-screen width at layout time — same `MIN_DIAGRAM_WIDTH` floor shape `layout.ts`'s own `layoutWidthHint` uses.
 */
export function computeContextDiagramLayout(
  hubId: UUID,
  internalNeighbourIds: readonly UUID[],
  externalNeighbourIds: readonly UUID[],
  widthHint: number = MIN_DIAGRAM_WIDTH,
): ContextDiagramLayout {
  const width = Math.max(MIN_DIAGRAM_WIDTH, widthHint);
  const availableWidth = width - 2 * PADDING;

  const boundaryTop = PADDING;
  let y = boundaryTop;

  const hubX = PADDING + (availableWidth - NODE_WIDTH) / 2;
  const hubTile: DiagramTile = { elementId: hubId, x: hubX, y, w: NODE_WIDTH, h: NODE_HEIGHT };
  y += NODE_HEIGHT + ROW_GUTTER_Y;

  const internalRow = packRow(internalNeighbourIds, y, availableWidth, PADDING);
  if (internalRow.tiles.length > 0) y += internalRow.height;

  const boundaryBottom = Math.max(boundaryTop, y);

  let externalRow: { tiles: DiagramTile[]; height: number } = { tiles: [], height: 0 };
  if (externalNeighbourIds.length > 0) {
    y = boundaryBottom + EXTERNAL_GUTTER_Y;
    externalRow = packRow(externalNeighbourIds, y, availableWidth, PADDING);
    y += externalRow.height;
  }

  return {
    hub: hubTile,
    internalNeighbours: internalRow.tiles,
    externalNeighbours: externalRow.tiles,
    boundary: { top: boundaryTop, bottom: boundaryBottom },
    width,
    height: y + PADDING,
  };
}

/** Every tile in a completed layout, hub included — the flat list `ContextDiagramCanvas.tsx` needs for hit-testing. */
export function allTilesOf(layout: ContextDiagramLayout): DiagramTile[] {
  return [layout.hub, ...layout.internalNeighbours, ...layout.externalNeighbours];
}

/** The hub side of an edge always anchors at the tile's own bottom edge — every neighbour this diagram ever places sits *below* the hub (`computeContextDiagramLayout`'s own row ordering), so "the bottom edge" is always the side facing the neighbour it connects to. */
export function hubBottomAnchor(tile: DiagramTile): { x: number; y: number } {
  return { x: tile.x + tile.w / 2, y: tile.y + tile.h };
}

/** The neighbour side of an edge always anchors at the top-centre of its own tile — the side facing the hub above it. */
export function tileTopAnchor(tile: DiagramTile): { x: number; y: number } {
  return { x: tile.x + tile.w / 2, y: tile.y };
}

export interface EdgeCurve {
  cp1: { x: number; y: number };
  cp2: { x: number; y: number };
  /** The curve's own midpoint — always sitting exactly halfway between `lower` and `upper` in y, which by construction (the gutter between the neighbour row and the hub row) is a band no tile occupies. The label pill sits here, never over a tile. */
  mid: { x: number; y: number };
}

/**
 * A cubic Bézier between `lower` (a neighbour's own top anchor — always the
 * larger y, since every neighbour sits below its hub) and `upper` (the
 * hub's own bottom anchor), with a vertical tangent at each end (`cp1`/`cp2`
 * share their adjacent anchor's own x) — the curve leaves `lower` straight
 * up and arrives at `upper` straight down, bowing sideways only in the open
 * gutter between them if the two don't already share an x. The midpoint
 * (`mid`) of a curve built this way always falls exactly on the horizontal
 * line halfway between `lower.y` and `upper.y` — a symmetric Bézier's own
 * property — so it's always in the clear gutter band, never over a tile,
 * with no need for per-diagram collision checking.
 */
export function curveBetween(lower: { x: number; y: number }, upper: { x: number; y: number }): EdgeCurve {
  const midY = (lower.y + upper.y) / 2;
  return { cp1: { x: lower.x, y: midY }, cp2: { x: upper.x, y: midY }, mid: { x: (lower.x + upper.x) / 2, y: midY } };
}

export interface EdgeLabelPlacement {
  text: string;
  x: number;
  y: number;
  /**
   * The y this label's own edge points toward — its arrow's destination
   * anchor, not its source. `curveBetween`'s own midpoint sits exactly
   * halfway between the two, so pushing "toward the target" (rather than
   * an arbitrary direction) never walks a label back over the tile its
   * own edge just left.
   */
  targetY: number;
}

export interface ResolvedEdgeLabel {
  /** One line, or two once collision resolution wraps it. */
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

const LABEL_PUSH_STEP = 10;
const LABEL_MIN_GAP_X = 16;
const LABEL_PILL_PADDING_X = 12;
const LABEL_PILL_HEIGHT_1_LINE = 18;
const LABEL_PILL_HEIGHT_2_LINE = 30;

/** Greedily fills the first line up to `targetWidth`, puts every remaining word on the second — no further wrap or truncation, since two lines comfortably holds any verb phrase this diagram actually renders (a hard single-line cap already ran before this is ever reached — see `resolveEdgeLabelOverlaps`'s own doc comment). A single word already over `targetWidth` still gets its own line rather than being split mid-word. */
function wrapToTwoLines(text: string, measureWidth: (s: string) => number, targetWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return [text];
  let splitAt = 1;
  for (let i = 2; i <= words.length; i += 1) {
    if (measureWidth(words.slice(0, i).join(' ')) <= targetWidth) splitAt = i;
    else break;
  }
  const first = words.slice(0, splitAt).join(' ');
  const second = words.slice(splitAt).join(' ');
  return second.length > 0 ? [first, second] : [first];
}

function pillFor(lines: readonly string[], x: number, y: number, measureWidth: (s: string) => number, textScale: number): ResolvedEdgeLabel {
  const width = Math.max(...lines.map(measureWidth)) + LABEL_PILL_PADDING_X * textScale;
  const height = (lines.length > 1 ? LABEL_PILL_HEIGHT_2_LINE : LABEL_PILL_HEIGHT_1_LINE) * textScale;
  return { lines: [...lines], x, y, width, height };
}

/** "Share a y band" (both pills' y-ranges overlap) with less than `LABEL_MIN_GAP_X` (16px) of horizontal clearance between them — a real box intersection is the same test with a negative gap. */
function pillsCollide(a: ResolvedEdgeLabel, b: ResolvedEdgeLabel, minGapX: number): boolean {
  const sharesYBand = a.y - a.height / 2 < b.y + b.height / 2 && b.y - b.height / 2 < a.y + a.height / 2;
  if (!sharesYBand) return false;
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  const gap = aRight <= bLeft ? bLeft - aRight : bRight <= aLeft ? aLeft - bRight : -1; // -1: a literal overlap, not just a crowded gap
  return gap < minGapX;
}

/**
 * A hub can have enough neighbours that two of their edge labels land close
 * together in the same gutter band — `curveBetween`'s own "always in the
 * clear gutter" guarantee only protects a label from *tile* collisions,
 * nothing stops two edges' own labels from colliding with *each other*.
 * Resolved here, deterministically (CLAUDE.md rule 6), in the caller's own
 * array order — each label is checked only against labels already placed
 * before it, never re-litigated once resolved:
 *
 * 1. Collides with an earlier label? Push this one vertically toward its
 *    own `targetY` (never the source — see `EdgeLabelPlacement.targetY`'s
 *    own comment) by `LABEL_PUSH_STEP`, up to two tries, re-checking
 *    after each.
 * 2. Still colliding after two pushes? Wrap the text to two lines (half
 *    the rough width, at the cost of height) at its current, already-
 *    pushed position — one more line to fix a horizontal crowding is
 *    usually enough; a vertical push already tried and failed, so this
 *    doesn't try pushing again.
 *
 * `measureWidth` is injected (a thin wrapper over a real
 * `CanvasRenderingContext2D.measureText` in `ContextDiagramCanvas.tsx`)
 * so this stays a pure, unit-testable function with no canvas of its own.
 */
export function resolveEdgeLabelOverlaps(placements: readonly EdgeLabelPlacement[], measureWidth: (text: string) => number, textScale: number): ResolvedEdgeLabel[] {
  const minGapX = LABEL_MIN_GAP_X * textScale;
  const pushStep = LABEL_PUSH_STEP * textScale;

  const resolved: ResolvedEdgeLabel[] = [];
  for (const placement of placements) {
    let box = pillFor([placement.text], placement.x, placement.y, measureWidth, textScale);
    const pushSign = placement.targetY >= placement.y ? 1 : -1;
    for (let attempt = 0; attempt < 2 && resolved.some((r) => pillsCollide(box, r, minGapX)); attempt += 1) {
      box = { ...box, y: box.y + pushSign * pushStep };
    }
    if (resolved.some((r) => pillsCollide(box, r, minGapX))) {
      // Half the current (unwrapped) text width, not the full width — the
      // full text obviously already fits within its own width, so wrapping
      // against that target would just hand every word back onto one line
      // and change nothing.
      const targetWidth = (box.width - LABEL_PILL_PADDING_X * textScale) / 2;
      const wrapped = wrapToTwoLines(placement.text, measureWidth, targetWidth);
      box = pillFor(wrapped, box.x, box.y, measureWidth, textScale);
    }
    resolved.push(box);
  }
  return resolved;
}
