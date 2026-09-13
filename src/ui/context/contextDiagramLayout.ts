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

export const MODULE_WIDTH = 72;
/**
 * V1 fix: was 40 — room for exactly one line of name and one of capability,
 * truncated hard the moment either overflowed the 72px-wide tile. The fix
 * request's "capability... never a blank tile" and "labelled with the
 * module's own name" both need real room to show that text — `ModuleTile`'s
 * name/capability now wrap to up to two lines each (`ContextDiagramCanvas.tsx`),
 * so the box needs to fit four short lines, not two.
 */
export const MODULE_HEIGHT = 68;
const MODULE_GUTTER_X = 8;
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
const ROW_GUTTER_Y = 32;
const PADDING = 32;
export const BOUNDARY_MARGIN = 8;
const EXTERNAL_GUTTER_Y = 32;
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

  const internalRow = packRow([...internalNeighbours].sort(byElementId), y, availableWidth, PADDING);
  if (internalRow.tiles.length > 0) y += internalRow.height;

  const boundaryBottom = Math.max(boundaryTop, y);

  let externalRow: { tiles: DiagramTile[]; height: number } = { tiles: [], height: 0 };
  if (externalNeighbours.length > 0) {
    y = boundaryBottom + EXTERNAL_GUTTER_Y;
    externalRow = packRow([...externalNeighbours].sort(byElementId), y, availableWidth, PADDING);
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
 * Where a straight line from `tile`'s own centre to `towards` crosses this
 * tile's own rectangle boundary — standard rect/line clipping (scale the
 * centre-to-`towards` vector down by whichever axis, x or y, hits the
 * rectangle's own half-width/half-height first). V1 fix: the platform
 * fallback anchor below used to return the tile's own *centre* unconditionally,
 * despite its own doc comment already promising "the platform tile's own
 * edge" — for a wide platform tile (widened to fit a row of module
 * sub-tiles) that put the anchor deep inside the box, so the line and its
 * "which module?" marker both drew through/behind the module row instead of
 * sitting at the tile's own border, exactly the messy crossing a live
 * screenshot showed for a plain system → platform edge.
 */
function clipToRectBoundary(tile: DiagramTile, towards: { x: number; y: number }): { x: number; y: number } {
  const cx = tile.x + tile.w / 2;
  const cy = tile.y + tile.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? tile.w / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? tile.h / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Where an edge should anchor on `tile`'s own unit — a specific module's
 * sub-tile centre when `endpointElementId` (the edge's actual `from`/`to`
 * id) names one of that unit's modules directly, or a point on the unit's
 * own rectangle boundary, facing `towards` (the other endpoint's own
 * anchor-side tile centre), with `isPlatformFallback: true` otherwise (S1
 * item 20's own "a flow whose endpoint is a platform rather than one of its
 * modules" — V1's "which module?" marker draws here, now genuinely at the
 * tile's own edge rather than its centre — see `clipToRectBoundary`'s own
 * comment for why that changed).
 */
export function anchorFor(tile: DiagramTile, endpointElementId: UUID, towards: { x: number; y: number }): DiagramAnchor {
  const module = tile.modules?.find((m) => m.elementId === endpointElementId);
  if (module) return { x: module.x + module.w / 2, y: module.y + module.h / 2, isPlatformFallback: false };
  const isFallback = (tile.modules?.length ?? 0) > 0 && endpointElementId === tile.elementId;
  if (!isFallback) return { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2, isPlatformFallback: false };
  return { ...clipToRectBoundary(tile, towards), isPlatformFallback: true };
}
