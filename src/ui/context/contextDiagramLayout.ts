/**
 * V1's own layout algorithm (docs/prompts/atlas-prompt-pack.md, "### V1 —
 * the context diagram"): a pure, deterministic function (CLAUDE.md rule 6)
 * producing tile positions for the Context view's new canvas renderer —
 * `ContextDiagramCanvas.tsx`. Reuses `layout.ts`'s own tile size constants
 * (`NODE_WIDTH`/`NODE_HEIGHT`) and its structural shape (an enterprise
 * boundary with an external band below it) so the context diagram reads as
 * "the same renderer, a different query and layout preset" (UI-principles
 * §6.1's own closing paragraph — the framing this sprint exists to finally
 * deliver on for Context) rather than a fresh visual language.
 *
 * Unlike the landscape, an actor reaching the hub via a drawn `uses` edge
 * (S1 item 11a) is just another neighbour tile here, not a separate
 * structural row the way the landscape's own actors are (that row exists
 * there because a landscape actor has no lane placement of its own to
 * belong to; a context-diagram actor always has a real edge to draw, so it
 * belongs in the same wrapped row as every other neighbour, distinguished
 * only by its own person-icon glyph — `ContextDiagramCanvas.tsx`'s own
 * concern, not this layout's). An `owns`-only actor (`ContextGroup.owners`)
 * never reaches this module at all: V1's own "Header keeps ... Owned by"
 * keeps that fact in the DOM header block, unchanged, exactly like today.
 *
 * Deliberately simpler than `layout.ts` in one respect: no obstacle-routed
 * edges (`routeLandscapeEdge`'s own channel-based detours). A system's own
 * immediate neighbours are a bounded handful around one hub, never
 * landscape-scale — straight lines from tile to tile are the common case
 * and, unlike the landscape's dense many-to-many web, rarely have anything
 * to route around at all.
 */
import type { UUID } from '../../contracts/delta';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

/**
 * V1 fix: was 72. A tile-text review against the longest real content label
 * ("Regulatory Compliance & Price-Control Reporting", the `utility`/
 * `electricity_network` maps' own level-1 name) at 8-module width found the
 * capability line still hard-pressed at 72px, even with the two-line wrap
 * `ContextDiagramCanvas.tsx` already gives it. Widened using exactly the
 * width `MODULE_GUTTER_X`'s own cut below frees per module (7 gutters × 4px
 * saved ÷ 8 modules ≈ 3.5px, rounded up to a clean 4px) — same ~4px scale
 * both constants move by, so an 8-module platform tile's own overall width
 * barely changes even though each module individually gets more room.
 */
export const MODULE_WIDTH = 76;
/**
 * V1 fix: was 40 — room for exactly one line of name and one of capability,
 * truncated hard the moment either overflowed the 72px-wide tile. The fix
 * request's "capability... never a blank tile" and "labelled with the
 * module's own name" both need real room to show that text — `ModuleTile`'s
 * name/capability now wrap to up to two lines each (`ContextDiagramCanvas.tsx`),
 * so the box needs to fit four short lines, not two.
 */
export const MODULE_HEIGHT = 68;
/**
 * V1 fix: was 8. Trimmed by the same ~4px `MODULE_WIDTH`'s own comment
 * describes — a tile-text review found modules crowded at 8-module width,
 * and the gutter is pure spacing (never text), the cheapest place to claw
 * width back from before accepting that any label would need to shrink.
 * `MODULE_WIDTH` above is widened using exactly what this cut frees, so the
 * two changes are one decision, not two independent tweaks.
 */
const MODULE_GUTTER_X = 4;
const MODULE_PADDING = 8;
/**
 * Height of a platform tile's own title bar (name + glyph, kind, and a
 * one-sentence description), above its row of module sub-tiles. V1 fix: was
 * 24 — just enough for a glyph and one line of the platform's own name. The
 * fix request adds a kind label and a one-sentence description to the
 * platform tile's own title bar (`ContextDiagramCanvas.tsx`'s drawing code)
 * — name line, kind line, description wrapped to up to two lines — so the
 * title bar needs room for four short lines, not one.
 */
const PLATFORM_TITLE_HEIGHT = 68;

const TILE_GUTTER_X = 24;
const TILE_GUTTER_Y = 20;
/**
 * V1 polish: was 32 — the gap between the hub/module row and the internal
 * neighbour row. Edges now curve through this gap (`curveBetween`) with a
 * label pill sitting at its own vertical midpoint (`ContextDiagramCanvas.tsx`'s
 * own drawing code) — 32px was tight for a pill plus curve clearance, so
 * this grew enough to hold both comfortably.
 */
const ROW_GUTTER_Y = 56;
const PADDING = 32;
export const BOUNDARY_MARGIN = 8;
/** V1 polish: was 32 — see `ROW_GUTTER_Y`'s own comment; the same reasoning applies to the boundary→external gap. */
const EXTERNAL_GUTTER_Y = 56;
export const MIN_DIAGRAM_WIDTH = 960;

export interface ModuleTile {
  /** The module (container) element id. */
  elementId: UUID;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The capability this module supports, if any — the module's own capability chip (V1's own wording). `null` when this module supports nothing yet. */
  capabilityName: string | null;
}

export interface DiagramTile {
  elementId: UUID;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Present only when this tile is a platform with at least one module — the tile's own module sub-tiles, positioned in world coordinates (not relative to the parent tile). */
  modules?: ModuleTile[];
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

/** One tile's own size, before it's placed — a plain system/actor/container tile is always `NODE_WIDTH`×`NODE_HEIGHT` (matching the landscape's own tile size, so this diagram reads as the same visual scale); a platform-with-modules tile widens to fit its own row of module sub-tiles and grows a title bar above them. */
function tileSize(moduleCount: number): { w: number; h: number } {
  if (moduleCount === 0) return { w: NODE_WIDTH, h: NODE_HEIGHT };
  const modulesWidth = moduleCount * MODULE_WIDTH + (moduleCount - 1) * MODULE_GUTTER_X + MODULE_PADDING * 2;
  return { w: Math.max(NODE_WIDTH, modulesWidth), h: PLATFORM_TITLE_HEIGHT + MODULE_HEIGHT + MODULE_PADDING * 2 };
}

function placeModules(unitX: number, unitY: number, unitW: number, moduleIds: readonly { elementId: UUID; capabilityName: string | null }[]): ModuleTile[] {
  if (moduleIds.length === 0) return [];
  const modulesWidth = moduleIds.length * MODULE_WIDTH + (moduleIds.length - 1) * MODULE_GUTTER_X;
  const startX = unitX + (unitW - modulesWidth) / 2;
  const y = unitY + PLATFORM_TITLE_HEIGHT + MODULE_PADDING;
  return moduleIds.map((module, index) => ({
    elementId: module.elementId,
    x: startX + index * (MODULE_WIDTH + MODULE_GUTTER_X),
    y,
    w: MODULE_WIDTH,
    h: MODULE_HEIGHT,
    capabilityName: module.capabilityName,
  }));
}

export interface DiagramUnitInput {
  elementId: UUID;
  /** This unit's own modules (empty for a plain system/actor/container, or a platform with none yet) — see `ContextDiagramCanvas.tsx`'s own caller for how these come from `contextDiagramData.ts`'s `buildPlatformModulesById`. */
  modules: readonly { elementId: UUID; capabilityName: string | null }[];
  /**
   * V1 polish, "neighbour columns spaced beneath the module they connect
   * to": a neighbour unit's own hint of which one of the *hub's* modules it
   * should be column-aligned under — the hub module id every one of this
   * neighbour's edges attaches to, when they all agree on the same one
   * (`ContextDiagramCanvas.tsx`'s own `attachedModuleIdFor`), else `null`
   * (unattached — the hub isn't a platform, the edge attaches to the
   * platform itself rather than a module, or the neighbour has edges to two
   * *different* modules). Meaningless on the hub's own unit; ignored there.
   */
  attachedToModuleId?: UUID | null;
}

function byElementId(a: DiagramUnitInput, b: DiagramUnitInput): number {
  return a.elementId.localeCompare(b.elementId);
}

/**
 * One row of tiles, wrapped left-to-right at `availableWidth` — unlike
 * `layout.ts`'s own `layoutRow` (a strict uniform-width column grid), tiles
 * here can vary in width (a platform's own widened tile), so this packs
 * greedily by actual width instead of a fixed items-per-row count.
 *
 * V1 fix, "centre-weighted layout": each wrapped row is centred within
 * `availableWidth` on its own (the hub above it is already centred the same
 * way — `computeContextDiagramLayout`'s own `hubX`) rather than hugging the
 * left edge, so a short last row (the common case — neighbours rarely divide
 * evenly into full rows) reads as balanced around the hub's own centre line
 * instead of stranded to one side.
 */
function packRow(units: readonly DiagramUnitInput[], top: number, availableWidth: number, originX: number): { tiles: DiagramTile[]; height: number } {
  if (units.length === 0) return { tiles: [], height: 0 };
  const sized = units.map((unit) => ({ unit, size: tileSize(unit.modules.length) }));

  // First pass: group into rows by width alone (no x/y yet) — the same
  // greedy wrap the old single-pass version did, just deferring placement
  // until each row's own total width is known.
  const rows: (typeof sized)[] = [];
  let current: typeof sized = [];
  let currentWidth = 0;
  for (const entry of sized) {
    const entryWidth = current.length === 0 ? entry.size.w : entry.size.w + TILE_GUTTER_X;
    if (current.length > 0 && currentWidth + entryWidth > availableWidth) {
      rows.push(current);
      current = [entry];
      currentWidth = entry.size.w;
    } else {
      current.push(entry);
      currentWidth += entryWidth;
    }
  }
  if (current.length > 0) rows.push(current);

  // Second pass: place each row, centred — same shape as the hub's own
  // `hubX = PADDING + (availableWidth - hubSize.w) / 2` one level up.
  const tiles: DiagramTile[] = [];
  let y = top;
  for (const row of rows) {
    const rowWidth = row.reduce((sum, { size }, i) => sum + size.w + (i > 0 ? TILE_GUTTER_X : 0), 0);
    const rowHeight = Math.max(...row.map(({ size }) => size.h));
    let x = originX + (availableWidth - rowWidth) / 2;
    for (const { unit, size } of row) {
      tiles.push({ elementId: unit.elementId, x, y, w: size.w, h: size.h, ...(unit.modules.length > 0 ? { modules: placeModules(x, y, size.w, unit.modules) } : {}) });
      x += size.w + TILE_GUTTER_X;
    }
    y += rowHeight + TILE_GUTTER_Y;
  }
  return { tiles, height: y - TILE_GUTTER_Y - top };
}

/**
 * Bug fix: a module's own pitch (`MODULE_WIDTH` + `MODULE_GUTTER_X` = 80px)
 * is much narrower than a neighbour tile's own width (`NODE_WIDTH` = 160px)
 * — two adjacent modules, each with its own attached neighbour, centred
 * naively under their own module would overlap by up to half a tile's
 * width, exactly the reported bug ("two neighbours render in the same box
 * and their labels concatenate"). This resolves every column's *desired*
 * centre (its own module's centre) against every other column's own
 * `NODE_WIDTH`-wide footprint, left to right: sorted by desired centre, each
 * column is pushed only as far right as it needs to clear the previous
 * column's own tile plus a normal gutter, never further — a column with
 * room to spare still sits exactly under its own module, and relative
 * left-to-right order is always preserved (this only ever pushes right,
 * never re-orders or pushes left), keeping the result deterministic
 * (CLAUDE.md rule 6).
 */
function resolveColumnCentres(desired: readonly { moduleId: UUID; centreX: number }[]): Map<UUID, number> {
  const sorted = [...desired].sort((a, b) => a.centreX - b.centreX);
  const resolved = new Map<UUID, number>();
  let previousRightEdge = -Infinity;
  for (const { moduleId, centreX } of sorted) {
    const actualCentreX = previousRightEdge === -Infinity ? centreX : Math.max(centreX, previousRightEdge + TILE_GUTTER_X + NODE_WIDTH / 2);
    resolved.set(moduleId, actualCentreX);
    previousRightEdge = actualCentreX + NODE_WIDTH / 2;
  }
  return resolved;
}

/**
 * V1 polish, "neighbour columns spaced beneath the module they connect to,
 * edges never crossing tiles": when the hub is a platform with modules, a
 * neighbour that names one of those modules on every one of its edges
 * (`unit.attachedToModuleId`) is placed in its own column, centred directly
 * under that module (`resolveColumnCentres` above resolves any two columns
 * that would otherwise collide) — stacked vertically with any other
 * neighbour sharing the same module, in module x-order — rather than packed
 * into a generic wrapped row. Since the module sits directly above (usually
 * at the same x — `resolveColumnCentres` only ever shifts a column when two
 * modules truly sit too close together to give each its own untouched
 * tile-width), the edge between them (`curveBetween`, `ContextDiagramCanvas.tsx`)
 * is a straight (or, when shifted, gently curved) vertical run through open
 * space, never crossing another tile.
 *
 * A neighbour with no such single module (an ordinary, non-platform hub —
 * every neighbour is unattached then — or a genuine edge straight to the
 * platform itself, or one with edges to two different modules) falls back
 * to `packRow`'s own centre-weighted wrapped row, placed *below* every
 * module column's own stack — a separate vertical band, so it can never
 * share a row with (and so never crosses) a column tile. For an ordinary
 * hub (`hubModules` empty), every neighbour is unattached and this reduces
 * to exactly `packRow` across the full available width — this sprint's own
 * existing, unchanged behaviour for a plain (non-platform) context.
 */
function layoutNeighbourBand(units: readonly DiagramUnitInput[], hubModules: readonly ModuleTile[], top: number, availableWidth: number, originX: number): { tiles: DiagramTile[]; height: number } {
  const hubModuleIds = new Set(hubModules.map((m) => m.elementId));
  const byModule = new Map<UUID, DiagramUnitInput[]>();
  const unattached: DiagramUnitInput[] = [];
  for (const unit of units) {
    const moduleId = unit.attachedToModuleId;
    if (moduleId && hubModuleIds.has(moduleId)) {
      const list = byModule.get(moduleId) ?? [];
      list.push(unit);
      byModule.set(moduleId, list);
    } else {
      unattached.push(unit);
    }
  }

  const columnModules = hubModules.filter((m) => (byModule.get(m.elementId)?.length ?? 0) > 0);
  const resolvedCentres = resolveColumnCentres(columnModules.map((m) => ({ moduleId: m.elementId, centreX: m.x + m.w / 2 })));

  const tiles: DiagramTile[] = [];
  let columnsHeight = 0;
  for (const module of columnModules) {
    const columnUnits = [...(byModule.get(module.elementId) ?? [])].sort(byElementId);
    const centreX = resolvedCentres.get(module.elementId) ?? module.x + module.w / 2;
    columnUnits.forEach((unit, i) => {
      tiles.push({ elementId: unit.elementId, x: centreX - NODE_WIDTH / 2, y: top + i * (NODE_HEIGHT + TILE_GUTTER_Y), w: NODE_WIDTH, h: NODE_HEIGHT });
    });
    columnsHeight = Math.max(columnsHeight, columnUnits.length * NODE_HEIGHT + (columnUnits.length - 1) * TILE_GUTTER_Y);
  }

  let bandHeight = columnsHeight;
  if (unattached.length > 0) {
    const unattachedTop = columnsHeight > 0 ? top + columnsHeight + TILE_GUTTER_Y : top;
    const packed = packRow([...unattached].sort(byElementId), unattachedTop, availableWidth, originX);
    tiles.push(...packed.tiles);
    bandHeight = (columnsHeight > 0 ? columnsHeight + TILE_GUTTER_Y : 0) + packed.height;
  }

  return { tiles, height: bandHeight };
}

/**
 * @param hub The system this Context view is scoped to, plus its own module list (empty unless it's a platform with modules).
 * @param internalNeighbours Non-external `uses`/`flows_to` neighbours — systems, containers (S1 item 20) and actors (S1 item 11a) alike, each with its own module list (empty for anything but a platform).
 * @param externalNeighbours Same shape, for `isExternal` neighbours — placed below the boundary, same as the landscape's own external band.
 * @param widthHint The canvas's own on-screen width at layout time — same `MIN_DIAGRAM_WIDTH` floor shape `layout.ts`'s own `layoutWidthHint` uses.
 */
export function computeContextDiagramLayout(
  hub: DiagramUnitInput,
  internalNeighbours: readonly DiagramUnitInput[],
  externalNeighbours: readonly DiagramUnitInput[],
  widthHint: number = MIN_DIAGRAM_WIDTH,
): ContextDiagramLayout {
  const width = Math.max(MIN_DIAGRAM_WIDTH, widthHint);
  const availableWidth = width - 2 * PADDING;

  const boundaryTop = PADDING;
  let y = boundaryTop;

  const hubSize = tileSize(hub.modules.length);
  const hubX = PADDING + (availableWidth - hubSize.w) / 2;
  const hubTile: DiagramTile = { elementId: hub.elementId, x: hubX, y, w: hubSize.w, h: hubSize.h, ...(hub.modules.length > 0 ? { modules: placeModules(hubX, y, hubSize.w, hub.modules) } : {}) };
  y += hubSize.h + ROW_GUTTER_Y;

  const hubModules = hubTile.modules ?? [];
  const internalRow = layoutNeighbourBand(internalNeighbours, hubModules, y, availableWidth, PADDING);
  if (internalRow.tiles.length > 0) y += internalRow.height;

  const boundaryBottom = Math.max(boundaryTop, y);

  let externalRow: { tiles: DiagramTile[]; height: number } = { tiles: [], height: 0 };
  if (externalNeighbours.length > 0) {
    y = boundaryBottom + EXTERNAL_GUTTER_Y;
    externalRow = layoutNeighbourBand(externalNeighbours, hubModules, y, availableWidth, PADDING);
    y += externalRow.height;
  }

  // Bug fix, `resolveColumnCentres`'s own comment: a column only ever gets
  // pushed *right* of its module's own centre, never left — so `width`
  // (fixed above, before either neighbour band was laid out) can, in a
  // dense case (several adjacent modules each with their own attached
  // neighbour), no longer be wide enough to keep every resolved column
  // inside the boundary. Widened here, after the fact, rather than
  // threaded back through the whole layout — nothing already placed
  // (the hub, its modules, every tile computed above) needs to move.
  const rightmostTileEdge = Math.max(hubTile.x + hubTile.w, ...internalRow.tiles.map((t) => t.x + t.w), ...externalRow.tiles.map((t) => t.x + t.w));
  const finalWidth = Math.max(width, rightmostTileEdge + PADDING);

  return {
    hub: hubTile,
    internalNeighbours: internalRow.tiles,
    externalNeighbours: externalRow.tiles,
    boundary: { top: boundaryTop, bottom: boundaryBottom },
    width: finalWidth,
    height: y + PADDING,
  };
}

/** Every tile in a completed layout, hub included — the flat list `ContextDiagramCanvas.tsx` needs for hit-testing and edge-anchor lookup. */
export function allTilesOf(layout: ContextDiagramLayout): DiagramTile[] {
  return [layout.hub, ...layout.internalNeighbours, ...layout.externalNeighbours];
}

export interface DiagramAnchor {
  x: number;
  y: number;
  /** True when this anchor is the platform tile's own edge rather than a specific module's sub-tile — V1's own "which module?" marker case. */
  isPlatformFallback: boolean;
}

/**
 * V1 polish, "entering module tiles from below": the hub side of an edge
 * always anchors at the *bottom* edge of whichever box it names — a
 * specific module's own sub-tile when `endpointElementId` (the edge's
 * actual `from`/`to` id) names one directly, or the hub tile's own bottom
 * edge otherwise, flagged `isPlatformFallback: true` (S1 item 20's own "a
 * flow whose endpoint is a platform rather than one of its modules" — V1's
 * "which module?" marker draws here). Every neighbour this diagram ever
 * places sits *below* its hub (`computeContextDiagramLayout`'s own row
 * ordering — internal neighbours below the hub, external neighbours below
 * that), so "the bottom edge" is always the side facing the neighbour it
 * connects to — never the tile's interior centre, which is what a v1-fix-era
 * version of this function used to return (drawing the line, and the
 * platform-fallback case especially, through the module row instead of at
 * the tile's own border).
 */
export function anchorFor(tile: DiagramTile, endpointElementId: UUID): DiagramAnchor {
  const module = tile.modules?.find((m) => m.elementId === endpointElementId);
  if (module) return { x: module.x + module.w / 2, y: module.y + module.h, isPlatformFallback: false };
  const isFallback = (tile.modules?.length ?? 0) > 0 && endpointElementId === tile.elementId;
  return { x: tile.x + tile.w / 2, y: tile.y + tile.h, isPlatformFallback: isFallback };
}

/** V1 polish, "leaving neighbours from above": the neighbour side of an edge always anchors at the top-centre of its own tile — the side facing the hub/module above it. Never a module sub-tile lookup: decision 11 (`docs/UI-principles.md` §10) means a *neighbour* platform's own modules are never nested here, so a neighbour tile is always this one plain box. */
export function tileTopAnchor(tile: DiagramTile): { x: number; y: number } {
  return { x: tile.x + tile.w / 2, y: tile.y };
}

export interface EdgeCurve {
  cp1: { x: number; y: number };
  cp2: { x: number; y: number };
  /** The curve's own midpoint — always sitting exactly halfway between `lower` and `upper` in y, which by construction (the gutter between a neighbour row and the row above it) is a band no tile occupies. V1 polish's own "label pill on the free segment, never over a tile" anchors here. */
  mid: { x: number; y: number };
}

/**
 * V1 polish, "orthogonal/curved edge routing ... label pill on the free
 * segment": a cubic Bézier between `lower` (a neighbour's own top anchor —
 * always the larger y, since every neighbour sits below its hub) and
 * `upper` (a hub/module bottom anchor), with a vertical tangent at each end
 * (`cp1`/`cp2` share their adjacent anchor's own x) — the curve leaves
 * `lower` straight up and arrives at `upper` straight down, bowing sideways
 * only in the open gutter between them if the two don't already share an x
 * (the common case, when a neighbour is column-aligned under its own
 * module, is a dead-straight vertical line — see `layoutNeighbourBand`'s
 * own comment for why that's the usual outcome). The midpoint (`mid`) of a
 * curve built this way always falls exactly on the horizontal line halfway
 * between `lower.y` and `upper.y` — a symmetric Bézier's own property — so
 * it's always in the clear gutter band, never over a tile, with no need for
 * per-diagram collision checking.
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
 * V1 fix, "two adjacent-module verb labels never render on top of each
 * other": `curveBetween`'s own "always in the clear gutter" guarantee
 * only protects a label from *tile* collisions — nothing stops two edges
 * landing in that same gutter, close together in x (adjacent modules sit
 * only `MODULE_WIDTH + MODULE_GUTTER_X` = 80px apart, easily narrower
 * than a 25+ character verb's own pill), from colliding with *each
 * other*. Resolved here, deterministically (CLAUDE.md rule 6), in the
 * caller's own array order — each label is checked only against labels
 * already placed before it, never re-litigated once resolved:
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
