import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { quantizeScale } from '../landscape/zoom';
import { NODE_WIDTH } from '../landscape/layout';
import { allTilesOf, anchorFor, computeContextDiagramLayout, curveBetween, resolveEdgeLabelOverlaps, tileTopAnchor, type ContextDiagramLayout, type DiagramTile, type DiagramUnitInput, type EdgeLabelPlacement } from './contextDiagramLayout';
import { kindOf, SYSTEM_KIND_LABEL } from '../elements/systemKind';
import { edgeLabel, type ContextGroup, type ContextNeighbour } from './contextGrouping';
import type { ContextModule } from './contextDiagramData';
import styles from './ContextDiagramCanvas.module.css';

export interface ContextDiagramCanvasProps {
  group: ContextGroup;
  platformModulesById: ReadonlyMap<UUID, ContextModule[]>;
  layoutWidthHint?: number;
  /** Tapping a system/container neighbour re-centres the diagram — V1's own wording — by navigating to that element's own Context page. Systems only (a container has no Context view of its own — `moduleHref`/`hubHref` cover it instead). */
  neighbourContextHref: (systemId: UUID) => string;
  /** Every other click target (the hub tile itself, an actor neighbour, or a module sub-tile) — an element page, the same "next best thing" `LandscapeCanvas.tsx`'s own `actorHref` already is for a node with no Context view of its own. */
  elementHref: (elementId: UUID) => string;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

interface HoverState {
  label: string;
  screenX: number;
  screenY: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const CLICK_DRAG_THRESHOLD_PX = 4;
const FIT_MARGIN_PX = 24;

interface CanvasTokens {
  border: string;
  borderStrong: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  statusOk: string;
  statusWarn: string;
  statusDanger: string;
  statusInfo: string;
  statusNeutral: string;
}

function readTokens(el: HTMLElement): CanvasTokens {
  const style = getComputedStyle(el);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    border: v('--border'),
    borderStrong: v('--border-strong'),
    surfaceRaised: v('--surface-raised'),
    text: v('--text'),
    textMuted: v('--text-muted'),
    statusOk: v('--status-ok'),
    statusWarn: v('--status-warn'),
    statusDanger: v('--status-danger'),
    statusInfo: v('--status-info'),
    statusNeutral: v('--status-neutral'),
  };
}

/** The shared status→fill-colour lookup both a top-level tile (`toneColour`, below) and a module sub-tile use — factored out once a second caller (the module fix, V1 fix) needed the exact same mapping from a plain status string rather than a whole element row. */
function toneColourForStatus(status: string | null | undefined, tokens: CanvasTokens): string | undefined {
  if (typeof status !== 'string') return undefined;
  const tone = lifecycleToneFor(status);
  if (!tone) return undefined;
  return { ok: tokens.statusOk, warn: tokens.statusWarn, danger: tokens.statusDanger, info: tokens.statusInfo, neutral: tokens.statusNeutral }[tone];
}

/** V1's own "Tone: lifecycle ... only" — a system tile's fill tint comes from its own recorded lifecycle status, the same `lifecycleToneFor` mapping `ElementHeader.tsx`'s own status chip already uses; nothing else (criticality, hosting model, exposure) is read here. An actor carries no `lifecycleStatus` of its own, so this naturally returns no tone for it — the same "silent when the fact doesn't apply" shape `landscapeTileColourFor` uses for its own colour-by modes. A module (container) sub-tile's own tone is computed separately, from `ContextModule.lifecycleStatus` (V1 fix — see `drawTile`'s own module loop), since a module's data never reaches this function's own `elementsById`-keyed lookup. */
function toneColour(element: ElementsHeadRow, tokens: CanvasTokens): string | undefined {
  if (element.element_type !== 'system') return undefined;
  return toneColourForStatus(attributesRecord(element.attributes).lifecycleStatus as string | undefined, tokens);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low === 0 ? '' : text.slice(0, low) + '…';
}

/**
 * V1 fix, "two-line wrap": greedily fills each line with as many whole
 * words as fit `maxWidth` (the current `ctx.font`'s own metrics), up to
 * `maxLines` lines; whatever's left over after the last allowed line is
 * ellipsized onto it via `truncate` above, rather than silently dropped.
 * Module names/capabilities and a platform's own one-sentence description
 * are all narrow, fixed-width canvas text with no CSS wrapping to fall back
 * on — this is this file's own equivalent.
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let remaining = words;
  while (remaining.length > 0 && lines.length < maxLines) {
    const isLastAllowedLine = lines.length === maxLines - 1;
    let count = 1;
    while (count < remaining.length && ctx.measureText(remaining.slice(0, count + 1).join(' ')).width <= maxWidth) count += 1;
    if (isLastAllowedLine && count < remaining.length) {
      lines.push(truncate(ctx, remaining.join(' '), maxWidth));
      remaining = [];
    } else {
      lines.push(remaining.slice(0, count).join(' '));
      remaining = remaining.slice(count);
    }
  }
  return lines;
}

/**
 * V1 polish, "fit uses width up to 1.5×": was `Math.min(width-ratio,
 * height-ratio, 1.5)` — on the column-per-module layout (`layoutNeighbourBand`,
 * `contextDiagramLayout.ts`), a platform with several stacked neighbours
 * under one module reads as genuinely *tall*, so the height ratio was
 * usually the smaller, binding term and the diagram rarely reached anywhere
 * near 1.5× however wide the canvas was. Driven by width alone (still
 * capped at 1.5× so a tiny diagram in a very wide window doesn't blow up
 * absurdly), a wide canvas now actually fills with the diagram — a tall
 * result is scrolled/panned into view via the existing drag/zoom controls,
 * same as the landscape's own canvas already relies on for a dense model.
 */
const FIT_MAX_SCALE = 1.5;

function computeFitTransform(worldWidth: number, worldHeight: number, displayWidth: number, displayHeight: number): Transform {
  if (worldWidth <= 0 || worldHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) return { scale: 1, tx: 0, ty: 0 };
  const availableWidth = Math.max(1, displayWidth - FIT_MARGIN_PX * 2);
  const rawScale = Math.min(availableWidth / worldWidth, FIT_MAX_SCALE);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
  const tx = (displayWidth - worldWidth * scale) / 2;
  const ty = (displayHeight - worldHeight * scale) / 2;
  return { scale, tx, ty };
}

/**
 * V1 polish: named by which side is the hub-side and which is the
 * neighbour-side, rather than by logical `from`/`to` — every edge in this
 * diagram anchors the same physical way regardless of its own direction
 * (hub/module side at its own tile's bottom edge, neighbour side at its own
 * tile's top edge; `curveBetween`'s own comment), so the drawing code needs
 * "which is which side," not "which is from/to." `arrowAtHub` alone still
 * carries the edge's real direction (the arrowhead is the only place it
 * shows up visually).
 */
interface DrawEdge {
  hubTile: DiagramTile;
  hubEndpoint: UUID;
  neighbourTile: DiagramTile;
  neighbourEndpoint: UUID;
  /** True when this edge's own `to_element_id` is the hub/module side (the arrowhead belongs there); false when it's the neighbour side. */
  arrowAtHub: boolean;
  label: string;
}

function unitOf(element: ElementsHeadRow, platformModulesById: ReadonlyMap<UUID, ContextModule[]>): DiagramUnitInput {
  const modules = platformModulesById.get(element.element_id) ?? [];
  return { elementId: element.element_id, modules: modules.map((m) => ({ elementId: m.elementId, capabilityName: m.capabilityName })) };
}

/**
 * V1 polish, "neighbour columns spaced beneath the module they connect to":
 * a neighbour's own `attachedToModuleId` hint (`DiagramUnitInput`'s own doc
 * comment) — the one hub module every one of this neighbour's edges names,
 * when they all agree, else `null`. Reads `hubModuleIds` alone (not the
 * placed `layout.hub.modules` — computing that hint has to happen *before*
 * layout, not after) so there's no circularity between "which column does
 * this neighbour belong to" and "where did layout put the modules."
 */
function attachedModuleIdFor(neighbour: ContextNeighbour, hubModuleIds: ReadonlySet<UUID>): UUID | null {
  const moduleIds = new Set<UUID>();
  for (const edge of neighbour.edges) {
    if (hubModuleIds.has(edge.from_element_id)) moduleIds.add(edge.from_element_id);
    else if (hubModuleIds.has(edge.to_element_id)) moduleIds.add(edge.to_element_id);
  }
  return moduleIds.size === 1 ? ([...moduleIds][0] ?? null) : null;
}

function neighbourUnitOf(neighbour: ContextNeighbour, platformModulesById: ReadonlyMap<UUID, ContextModule[]>, hubModuleIds: ReadonlySet<UUID>): DiagramUnitInput {
  return { ...unitOf(neighbour.element, platformModulesById), attachedToModuleId: attachedModuleIdFor(neighbour, hubModuleIds) };
}

/**
 * V1's own canvas renderer — the Context view's diagram, on the same
 * technology (`<canvas>` 2D, DOM only for the toolbar/tooltip) as
 * `LandscapeCanvas.tsx`, reusing its zoom/pan/fit shape verbatim (there is
 * no shared hook to import — that component's own investigation note: the
 * zoom/pan state lives inline there too). Deliberately narrower in scope
 * than that component: no diff highlighting, no colour-by beyond the one
 * lifecycle tone V1 itself asks for, no comment markers, no obstacle-routed
 * edges — none of those are named by V1's own wording, and a system's own
 * immediate neighbours are always a small, bounded set, never landscape
 * scale.
 */
export function ContextDiagramCanvas({ group, platformModulesById, layoutWidthHint, neighbourContextHref, elementHref }: ContextDiagramCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);
  /**
   * Tile-text fix: "ellipsis with title-attribute tooltip only past two
   * lines" — a module has no DOM node of its own to carry a real `title`
   * attribute (this is a `<canvas>`, `LandscapeCanvas.tsx`'s own reasoning),
   * so this is the same overlay `.tooltip` div the top-level hover state
   * already renders, keyed by module id instead of by tile. Populated by
   * `draw()` below (the one place `nameLines`/`capLines` — and therefore
   * whether either actually got ellipsized — are already computed), read by
   * `handlePointerMove`'s own hit-test. A ref, not state: it changes every
   * `draw()` call (i.e. every render), and re-deriving it there is free —
   * turning it into state would just add a render this component doesn't
   * need.
   */
  const moduleTooltipsRef = useRef<Map<UUID, string>>(new Map());

  const elementsById = useMemo(() => {
    const map = new Map<UUID, ElementsHeadRow>([[group.hub.element_id, group.hub]]);
    for (const n of [...group.internal, ...group.external]) map.set(n.element.element_id, n.element);
    return map;
  }, [group]);

  // V1 fix: a module (container) never lands in `elementsById` above — by
  // design, `useSystemContext.ts` excludes a platform's own module ids from
  // the neighbour query (its own doc comment explains why: an edge attaching
  // to a module still means "this neighbour touches the hub", not "here's a
  // second, separate neighbour named by the module's own id"). `platformModulesById`
  // (V1's own module-name/capability/lifecycle data, `contextDiagramData.ts`)
  // is the *only* source of a module's own name/tone — this flattens every
  // platform's own module list into one lookup by module id, the same shape
  // `elementsById` gives every other tile. Without this, a module tile's own
  // name/tone silently read as blank (this fix's own root cause).
  const moduleByElementId = useMemo(() => {
    const map = new Map<UUID, ContextModule>();
    for (const modules of platformModulesById.values()) {
      for (const module of modules) map.set(module.elementId, module);
    }
    return map;
  }, [platformModulesById]);

  // V1 polish: the hub's own module ids, needed *before* layout runs to
  // compute each neighbour's own `attachedToModuleId` hint — see
  // `attachedModuleIdFor`'s own comment for why this reads `platformModulesById`
  // directly rather than the layout's already-placed `layout.hub.modules`.
  const hubModuleIds = useMemo(() => new Set((platformModulesById.get(group.hub.element_id) ?? []).map((m) => m.elementId)), [platformModulesById, group.hub.element_id]);

  const layout = useMemo<ContextDiagramLayout>(
    () =>
      computeContextDiagramLayout(
        unitOf(group.hub, platformModulesById),
        group.internal.map((n) => neighbourUnitOf(n, platformModulesById, hubModuleIds)),
        group.external.map((n) => neighbourUnitOf(n, platformModulesById, hubModuleIds)),
        layoutWidthHint,
      ),
    [group, platformModulesById, hubModuleIds, layoutWidthHint],
  );

  const tileByElementId = useMemo(() => new Map(allTilesOf(layout).map((t) => [t.elementId, t])), [layout]);

  const edges = useMemo<DrawEdge[]>(() => {
    const result: DrawEdge[] = [];
    for (const neighbour of [...group.internal, ...group.external]) {
      const neighbourTile = tileByElementId.get(neighbour.element.element_id);
      if (!neighbourTile) continue;
      for (const edge of neighbour.edges) {
        const fromIsHub = edge.from_element_id === group.hub.element_id || (layout.hub.modules?.some((m) => m.elementId === edge.from_element_id) ?? false);
        const hubEndpoint = fromIsHub ? edge.from_element_id : edge.to_element_id;
        const neighbourEndpoint = fromIsHub ? edge.to_element_id : edge.from_element_id;
        // The arrow belongs at the logical `to` side — `arrowAtHub` is true
        // exactly when the hub/module side is that `to` side, i.e. the edge
        // does *not* run hub → neighbour.
        result.push({ hubTile: layout.hub, hubEndpoint, neighbourTile, neighbourEndpoint, arrowAtHub: !fromIsHub, label: edgeLabel(edge, group.hub.element_id) });
      }
    }
    return result;
  }, [group, layout, tileByElementId]);

  const fitToView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setTransform(computeFitTransform(layout.width, layout.height, wrapper.clientWidth, wrapper.clientHeight));
  }, [layout.width, layout.height]);

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const tileAt = useCallback(
    (screenX: number, screenY: number): DiagramTile | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const tile of allTilesOf(layout)) {
        if (worldX >= tile.x && worldX <= tile.x + tile.w && worldY >= tile.y && worldY <= tile.y + tile.h) return tile;
      }
      return null;
    },
    [layout, transform],
  );

  const moduleAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const tile of allTilesOf(layout)) {
        for (const module of tile.modules ?? []) {
          if (worldX >= module.x && worldX <= module.x + module.w && worldY >= module.y && worldY <= module.y + module.h) return module.elementId;
        }
      }
      return null;
    },
    [layout, transform],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw(): void {
      if (!canvas || !wrapper || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = wrapper.clientWidth;
      const displayHeight = wrapper.clientHeight;
      if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
      }
      const tokens = readTokens(wrapper);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.save();
      ctx.translate(transform.tx, transform.ty);
      ctx.scale(transform.scale, transform.scale);

      const showLabels = NODE_WIDTH * transform.scale >= 64;

      // The dotted enterprise boundary — around the hub and internal
      // neighbours only, same convention `LandscapeCanvas.tsx`'s own
      // boundary uses, drawn first so tiles/edges layer on top.
      if (layout.boundary.bottom > layout.boundary.top) {
        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        roundRectPath(ctx, 8, layout.boundary.top - 8, layout.width - 16, layout.boundary.bottom - layout.boundary.top + 16, 12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      const edgeLabels: { text: string; worldX: number; worldY: number; worldTargetY: number }[] = [];
      const platformMarkers: { worldX: number; worldY: number }[] = [];
      for (const edge of edges) {
        // V1 polish: the hub/module side always anchors at its own tile's
        // bottom edge, the neighbour side at its own tile's top edge
        // (`anchorFor`/`tileTopAnchor`'s own comments) — every neighbour
        // this diagram places sits below its hub, so this is always "lower
        // anchor = neighbour, upper anchor = hub/module," never the other
        // way round, regardless of the edge's own logical direction.
        const hubAnchor = anchorFor(edge.hubTile, edge.hubEndpoint);
        const neighbourAnchor = tileTopAnchor(edge.neighbourTile);
        if (hubAnchor.isPlatformFallback) platformMarkers.push({ worldX: hubAnchor.x, worldY: hubAnchor.y });

        // V1 polish, "orthogonal/curved edge routing entering module tiles
        // from below and leaving neighbours from above": a Bézier curve,
        // vertical at both ends, rather than a straight line — see
        // `curveBetween`'s own comment for why this is a dead-straight
        // vertical run whenever a neighbour sits in its own module's column
        // (the common case), and only bows sideways for an unattached
        // neighbour placed elsewhere in the band.
        const curve = curveBetween(neighbourAnchor, hubAnchor);
        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(neighbourAnchor.x, neighbourAnchor.y);
        ctx.bezierCurveTo(curve.cp1.x, curve.cp1.y, curve.cp2.x, curve.cp2.y, hubAnchor.x, hubAnchor.y);
        ctx.stroke();
        ctx.restore();

        // V1 polish, "label pill on the free segment, never over a tile":
        // the curve's own midpoint always falls in the open gutter between
        // the two rows (`curveBetween`'s own comment) — drawn as a filled
        // pill in the screen-space pass below, not here (needs the actual
        // font metrics to size itself).
        if (showLabels && edge.label.trim().length > 0) {
          // V1 fix, "push toward the target": the same anchor the
          // arrowhead below points at — pushing toward the source instead
          // would walk an overlap-resolved label back over the tile its
          // own edge just left.
          edgeLabels.push({ text: edge.label, worldX: curve.mid.x, worldY: curve.mid.y, worldTargetY: edge.arrowAtHub ? hubAnchor.y : neighbourAnchor.y });
        }

        // One arrowhead, at the target only (UI-principles §9) — always
        // vertical now (both anchors are a tile's own top/bottom edge), so
        // no angle computation is needed: `arrowAtHub` alone says whether it
        // points up into the hub/module or down into the neighbour.
        const targetAnchor = edge.arrowAtHub ? hubAnchor : neighbourAnchor;
        const arrowSign = edge.arrowAtHub ? -1 : 1; // up into the hub/module, or down into the neighbour
        ctx.save();
        ctx.translate(targetAnchor.x, targetAnchor.y);
        ctx.rotate(arrowSign > 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fillStyle = tokens.borderStrong;
        ctx.fill();
        ctx.restore();
      }

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number; maxWidth: number }[] = [];
      // V1 fix: "the platform tile shows the platform's name, kind and one
      // sentence" — a separate list from `nodeLabels` above (a plain tile
      // never has `tile.modules`, so never contributes here), since a
      // platform's own title bar needs three lines' worth of content, not
      // one.
      const platformTitles: { glyph: string; name: string; kind: string; description: string | null; worldX: number; worldY: number; maxWidth: number }[] = [];
      const moduleLabels: { elementId: UUID; name: string; capability: string | null; worldX: number; worldY: number; maxWidth: number }[] = [];

      const drawTile = (tile: DiagramTile, isHub: boolean): void => {
        const element = elementsById.get(tile.elementId);
        if (!element) return;
        const external = attributesRecord(element.attributes).isExternal === true;
        const isHovered = hover?.label === element.name;

        ctx.save();
        roundRectPath(ctx, tile.x, tile.y, tile.w, tile.h, 8);
        const tone = toneColour(element, tokens);
        ctx.fillStyle = tone ? `color-mix(in srgb, ${tone} 16%, ${tokens.surfaceRaised})` : tokens.surfaceRaised;
        ctx.fill();
        ctx.strokeStyle = isHub ? tokens.text : isHovered ? tokens.borderStrong : tokens.border;
        ctx.lineWidth = isHub ? 2 : 1;
        if (external) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        if (showLabels) {
          const glyph = element.element_type === 'actor' ? elementTypeGlyph('actor', attributesRecord(element.attributes).subtype as ActorSubtype | undefined) : elementTypeGlyph(element.element_type);
          if (tile.modules) {
            const description = attributesRecord(element.attributes).description;
            platformTitles.push({
              glyph,
              name: element.name,
              kind: SYSTEM_KIND_LABEL[kindOf(element)],
              description: typeof description === 'string' && description.trim().length > 0 ? description : null,
              worldX: tile.x + 8,
              worldY: tile.y + 14,
              maxWidth: tile.w - 16,
            });
          } else {
            nodeLabels.push({ glyph, name: element.name, worldX: tile.x, worldY: tile.y + tile.h / 2, maxWidth: tile.w - 30 });
          }
        }

        for (const module of tile.modules ?? []) {
          // V1 fix: a module's own name/capability/tone come from
          // `moduleByElementId` (this component's own flattening of
          // `platformModulesById`, above) — `elementsById` never contains a
          // module (`useSystemContext.ts`'s own deliberate exclusion), which
          // is exactly why a module tile's name silently rendered blank
          // before this fix.
          const moduleData = moduleByElementId.get(module.elementId);
          const moduleTone = toneColourForStatus(moduleData?.lifecycleStatus, tokens);
          ctx.save();
          roundRectPath(ctx, module.x, module.y, module.w, module.h, 6);
          ctx.fillStyle = moduleTone ? `color-mix(in srgb, ${moduleTone} 20%, ${tokens.surfaceRaised})` : tokens.surfaceRaised;
          ctx.fill();
          ctx.strokeStyle = tokens.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
          if (showLabels) moduleLabels.push({ elementId: module.elementId, name: moduleData?.name ?? '', capability: module.capabilityName, worldX: module.x + module.w / 2, worldY: module.y + 10, maxWidth: module.w - 8 });
        }
      };

      drawTile(layout.hub, true);
      for (const tile of layout.internalNeighbours) drawTile(tile, false);
      for (const tile of layout.externalNeighbours) drawTile(tile, false);

      ctx.restore();

      // Text, screen-space (dpr only), same reasoning LandscapeCanvas.tsx's
      // own second pass gives: quantised zoom keeps text a fixed on-screen
      // size within a zoom step rather than scaling continuously.
      const textScale = quantizeScale(transform.scale, MIN_SCALE, MAX_SCALE);
      const toScreen = (worldX: number, worldY: number): [number, number] => [worldX * transform.scale + transform.tx, worldY * transform.scale + transform.ty];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      // V1 fix, "two-line wrap": a name that doesn't fit on one line wraps
      // to a second rather than truncating hard — `wrapLines` measures
      // against the exact font just set, so it's called here in the
      // screen-space pass, not while building `nodeLabels` above.
      //
      // Overflow fix ("Graphical Design Tool" hanging past its own tile,
      // reproducible at some zoom levels but not others): `textScale` is
      // *quantised* (`quantizeScale`'s own comment — pinned to one of 8
      // steps so the font itself doesn't jitter mid-zoom) and can land
      // above the real, continuous `transform.scale` at some zoom levels —
      // exactly when the box on screen (always sized by the true
      // `transform.scale`, never `textScale`) is smaller than whatever
      // `textScale` assumes it to be. Every width bound and box-relative
      // offset below (how far the name starts past the glyph, how wide it's
      // allowed to wrap or truncate against) has to track that same real
      // box size — `transform.scale`, not `textScale` — or the text is
      // being measured and placed against a box that doesn't match the one
      // actually drawn. Only the font's own rendered size (`ctx.font`,
      // right below) stays pinned to `textScale` — that's the one thing
      // quantisation is actually for.
      for (const label of nodeLabels) {
        const [x, y] = toScreen(label.worldX, label.worldY);
        ctx.fillStyle = tokens.text;
        ctx.font = `${(14 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(label.glyph, x + 8 * transform.scale, y);
        ctx.font = `${(12 * textScale).toFixed(2)}px sans-serif`;
        const lines = wrapLines(ctx, label.name, label.maxWidth * transform.scale, 2);
        const lineHeight = 13 * textScale;
        const startY = y - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, x + 26 * transform.scale, startY + i * lineHeight);
        });
      }

      // V1 fix: the platform tile's own title — name, kind, and one
      // sentence (`docs/prompts/atlas-prompt-pack.md`'s own V1 wording,
      // "Centre: the system as a tile (name, type, one sentence)").
      // Overflow fix: same `transform.scale`-for-box-bounds rule as
      // `nodeLabels` above — the width this title's own name/description
      // are measured and wrapped against, and the offset its name starts
      // at past the glyph, both have to track the tile's real on-screen
      // size.
      for (const title of platformTitles) {
        const [x, y] = toScreen(title.worldX, title.worldY);
        ctx.fillStyle = tokens.text;
        ctx.font = `${(14 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(title.glyph, x, y);
        ctx.font = `${(12 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(truncate(ctx, title.name, (title.maxWidth - 20) * transform.scale), x + 18 * transform.scale, y);
        ctx.fillStyle = tokens.textMuted;
        ctx.font = `${(10 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(title.kind, x, y + 14 * textScale);
        if (title.description) {
          const descLines = wrapLines(ctx, title.description, title.maxWidth * transform.scale, 2);
          descLines.forEach((line, i) => {
            ctx.fillText(line, x, y + (30 + i * 12) * textScale);
          });
        }
      }

      ctx.textAlign = 'center';
      moduleTooltipsRef.current = new Map();
      for (const label of moduleLabels) {
        const [x, y] = toScreen(label.worldX, label.worldY);
        ctx.fillStyle = tokens.text;
        ctx.font = `${(10 * textScale).toFixed(2)}px sans-serif`;
        // Overflow fix: same `transform.scale`-for-width-bound rule as
        // `nodeLabels`/`platformTitles` above — this text is centred, so
        // there's no offset bug to match, but the wrap width still has to
        // track the module tile's real on-screen size, not `textScale`.
        const nameLines = wrapLines(ctx, label.name, label.maxWidth * transform.scale, 2);
        nameLines.forEach((line, i) => {
          ctx.fillText(line, x, y + i * 11 * textScale);
        });
        // Tile-text fix: "module code stays at current size; capability
        // label below renders one size smaller" — 10px name, 9px capability,
        // already the case before this fix; unchanged here.
        //
        // V1 fix: absent entirely (never a placeholder/blank second line)
        // when this module supports nothing yet — the capability chip only
        // ever draws when there's a real capability name to show.
        let capLines: string[] = [];
        if (label.capability) {
          ctx.fillStyle = tokens.textMuted;
          ctx.font = `${(9 * textScale).toFixed(2)}px sans-serif`;
          capLines = wrapLines(ctx, label.capability, label.maxWidth * transform.scale, 2);
          capLines.forEach((line, i) => {
            ctx.fillText(line, x, y + (26 + i * 10) * textScale);
          });
        }
        // Tile-text fix: "ellipsis with title-attribute tooltip only past
        // two lines" — `wrapLines` only ever appends "…" (via `truncate`)
        // on its own last allowed line, and only when the real text didn't
        // fit; checking the last rendered line for it is a reliable,
        // reasoning-free signal, cheaper than re-deriving "did this
        // overflow" a second way. Keyed by module id, not tile position, so
        // `handlePointerMove`'s own `moduleAt()` hit-test (already computed
        // for click navigation) can look it up directly.
        const nameTruncated = nameLines.at(-1)?.endsWith('…') ?? false;
        const capabilityTruncated = capLines.at(-1)?.endsWith('…') ?? false;
        if (nameTruncated || capabilityTruncated) {
          const full = label.capability ? `${label.name} — ${label.capability}` : label.name;
          moduleTooltipsRef.current.set(label.elementId, full);
        }
      }

      // V1 polish, "label pill on the free segment, never over a tile": a
      // filled rounded pill sized to the text, centred on the curve's own
      // midpoint (`curveBetween`'s own comment on why that point is always
      // in the clear gutter between rows). The vertical routing above means
      // this text no longer needs to follow a line's own angle — it's
      // always sitting on the open horizontal band between two rows, so
      // plain centred text reads cleanly without rotation.
      //
      // V1 fix, "two adjacent-module labels never render on top of each
      // other": that "always in the clear gutter" guarantee is a tile
      // collision guarantee, not a label-vs-label one — resolved here via
      // `resolveEdgeLabelOverlaps` (`contextDiagramLayout.ts`'s own doc
      // comment has the full algorithm). Each placement's own text is
      // still hard-capped at the same single-line width as before
      // (`truncate`) *before* overlap resolution ever sees it — a wildly
      // long single label was never this fix's own problem to solve, and
      // capping it first keeps `resolveEdgeLabelOverlaps`'s own two-line
      // wrap working from a bounded starting width.
      ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
      ctx.textAlign = 'center';
      const placements: EdgeLabelPlacement[] = edgeLabels.map((label) => {
        const [x, y] = toScreen(label.worldX, label.worldY);
        const [, targetY] = toScreen(label.worldX, label.worldTargetY);
        return { text: truncate(ctx, label.text, NODE_WIDTH * 1.5 * textScale), x, y, targetY };
      });
      const resolvedLabels = resolveEdgeLabelOverlaps(placements, (text) => ctx.measureText(text).width, textScale);
      const edgeLabelLineHeight = 12 * textScale;
      for (const pill of resolvedLabels) {
        // Opaque, and drawn after every edge/tile above (z-order) — a
        // pushed-apart pair no longer needs this, but a pair still sharing
        // a y band by design (the min-gap check, not a genuine collision)
        // must never let one's edge line or the other's own pill show
        // through the gap between them.
        roundRectPath(ctx, pill.x - pill.width / 2, pill.y - pill.height / 2, pill.width, pill.height, pill.height / 2);
        ctx.fillStyle = tokens.surfaceRaised;
        ctx.fill();
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = tokens.textMuted;
        const startY = pill.y - ((pill.lines.length - 1) * edgeLabelLineHeight) / 2;
        pill.lines.forEach((line, i) => {
          ctx.fillText(line, pill.x, startY + i * edgeLabelLineHeight);
        });
      }

      // V1's own "which module?" marker — a small filled "?" badge at the
      // platform tile's own edge, exactly where S1 item 20's
      // `findFlowsToPlatformInsteadOfModule` health finding already flags
      // the same fact from the architect door's own list.
      for (const marker of platformMarkers) {
        const [x, y] = toScreen(marker.worldX, marker.worldY);
        ctx.beginPath();
        ctx.arc(x, y, 8 * textScale, 0, Math.PI * 2);
        ctx.fillStyle = tokens.statusWarn;
        ctx.fill();
        ctx.fillStyle = tokens.surfaceRaised;
        ctx.fillText('?', x, y + 1);
      }
      ctx.textAlign = 'left';
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [layout, edges, elementsById, moduleByElementId, transform, hover]);

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>): void {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startTransform: transform, moved: false };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > CLICK_DRAG_THRESHOLD_PX) drag.moved = true;
      if (drag.moved) {
        setTransform({ scale: drag.startTransform.scale, tx: drag.startTransform.tx + dx, ty: drag.startTransform.ty + dy });
        setHover(null);
        return;
      }
    }
    // Tile-text fix: a module tile only ever shows a tooltip when its own
    // text actually truncated (`moduleTooltipsRef`'s own comment) — checked
    // before the plain tile hover below so hovering a module reveals its
    // own full text rather than the platform tile's name underneath it;
    // hovering a module with nothing truncated shows no tooltip at all,
    // rather than falling back to the platform's.
    const moduleId = moduleAt(screenX, screenY);
    if (moduleId) {
      const tooltip = moduleTooltipsRef.current.get(moduleId);
      setHover(tooltip ? { label: tooltip, screenX, screenY } : null);
      return;
    }
    const tile = tileAt(screenX, screenY);
    const element = tile ? elementsById.get(tile.elementId) : undefined;
    setHover(element ? { label: element.name, screenX, screenY } : null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;

    const moduleId = moduleAt(screenX, screenY);
    if (moduleId) {
      void navigate(elementHref(moduleId));
      return;
    }
    const tile = tileAt(screenX, screenY);
    if (!tile) return;
    if (tile.elementId === group.hub.element_id) {
      void navigate(elementHref(tile.elementId));
      return;
    }
    const element = elementsById.get(tile.elementId);
    if (element?.element_type === 'system') void navigate(neighbourContextHref(tile.elementId));
    else void navigate(elementHref(tile.elementId));
  }

  function zoomBy(factor: number, center?: { x: number; y: number }): void {
    setTransform((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const wrapper = wrapperRef.current;
      const cx = center?.x ?? (wrapper ? wrapper.clientWidth / 2 : 0);
      const cy = center?.y ?? (wrapper ? wrapper.clientHeight / 2 : 0);
      const worldX = (cx - prev.tx) / prev.scale;
      const worldY = (cy - prev.ty) / prev.scale;
      return { scale: nextScale, tx: cx - worldX * nextScale, ty: cy - worldY * nextScale };
    });
  }

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>): void {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>): void {
    if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === '0') fitToView();
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper} data-scale={transform.scale} data-tx={transform.tx} data-ty={transform.ty}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Context diagram: ${group.hub.name} and ${String(group.internal.length + group.external.length)} connected systems, containers or people. Use the element page for an accessible, list-based view of any of these.`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHover(null);
        }}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      />
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolbarButton} aria-label="Zoom in" onClick={() => { zoomBy(1.2); }}>
          +
        </button>
        <button type="button" className={styles.toolbarButton} aria-label="Zoom out" onClick={() => { zoomBy(1 / 1.2); }}>
          −
        </button>
        <button type="button" className={styles.toolbarButton} aria-label="Fit to view" onClick={fitToView}>
          Fit
        </button>
      </div>
      {hover && (
        <div className={styles.tooltip} style={{ left: hover.screenX, top: hover.screenY }}>
          {hover.label}
        </div>
      )}
    </div>
  );
}
