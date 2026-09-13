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
export const MODULE_HEIGHT = 40;
const MODULE_GUTTER_X = 8;
const MODULE_PADDING = 8;
/** Height of a platform tile's own title bar (name + glyph), above its row of module sub-tiles. */
const PLATFORM_TITLE_HEIGHT = 24;

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

/** One row of tiles, wrapped left-to-right at `availableWidth` — unlike `layout.ts`'s own `layoutRow` (a strict uniform-width column grid), tiles here can vary in width (a platform's own widened tile), so this packs greedily by actual width instead of a fixed items-per-row count. */
function packRow(units: readonly DiagramUnitInput[], top: number, availableWidth: number, originX: number): { tiles: DiagramTile[]; height: number } {
  if (units.length === 0) return { tiles: [], height: 0 };
  const sized = units.map((unit) => ({ unit, size: tileSize(unit.modules.length) }));

  const tiles: DiagramTile[] = [];
  let x = originX;
  let y = top;
  let rowHeight = 0;
  for (const { unit, size } of sized) {
    if (x !== originX && x + size.w > originX + availableWidth) {
      x = originX;
      y += rowHeight + TILE_GUTTER_Y;
      rowHeight = 0;
    }
    tiles.push({ elementId: unit.elementId, x, y, w: size.w, h: size.h, ...(unit.modules.length > 0 ? { modules: placeModules(x, y, size.w, unit.modules) } : {}) });
    x += size.w + TILE_GUTTER_X;
    rowHeight = Math.max(rowHeight, size.h);
  }
  return { tiles, height: y + rowHeight - top };
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
 * Where an edge should anchor on `tile`'s own unit — a specific module's
 * sub-tile centre when `endpointElementId` (the edge's actual `from`/`to`
 * id) names one of that unit's modules directly, or the unit's own centre
 * with `isPlatformFallback: true` otherwise (S1 item 20's own "a flow whose
 * endpoint is a platform rather than one of its modules" — V1's "which
 * module?" marker draws here).
 */
export function anchorFor(tile: DiagramTile, endpointElementId: UUID): DiagramAnchor {
  const module = tile.modules?.find((m) => m.elementId === endpointElementId);
  if (module) return { x: module.x + module.w / 2, y: module.y + module.h / 2, isPlatformFallback: false };
  return { x: tile.x + tile.w / 2, y: tile.y + tile.h / 2, isPlatformFallback: (tile.modules?.length ?? 0) > 0 && endpointElementId === tile.elementId };
}
