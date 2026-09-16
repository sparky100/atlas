import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { quantizeScale } from '../landscape/zoom';
import { NODE_WIDTH } from '../landscape/layout';
import {
  allTilesOf,
  computeContextDiagramLayout,
  edgeLabelsCollide,
  edgeNear,
  placeEdgeLabels,
  type ContextDiagramLayout,
  type ContextEdgeInput,
  type DiagramTile,
  type DiagramUnitInput,
  type EdgeLabelPill,
} from './contextDiagramLayout';
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

/** Rework item 4: `auto` follows the collision audit (labels shown unless `edgeLabelsCollide` says they'd stack); `show`/`hide` are the reviewer's own override from the toolbar. */
type LabelMode = 'auto' | 'show' | 'hide';

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const CLICK_DRAG_THRESHOLD_PX = 4;
const FIT_MARGIN_PX = 24;
/** Screen-pixel distance within which a pointer counts as "on" an edge (hover/tap-to-reveal, rework item 4). */
const EDGE_HIT_TOLERANCE_PX = 6;

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

/** The shared status→fill-colour lookup both a top-level tile (`toneColour`, below) and a module sub-tile use. */
function toneColourForStatus(status: string | null | undefined, tokens: CanvasTokens): string | undefined {
  if (typeof status !== 'string') return undefined;
  const tone = lifecycleToneFor(status);
  if (!tone) return undefined;
  return { ok: tokens.statusOk, warn: tokens.statusWarn, danger: tokens.statusDanger, info: tokens.statusInfo, neutral: tokens.statusNeutral }[tone];
}

/** V1's own "Tone: lifecycle ... only" — a system tile's fill tint comes from its own recorded lifecycle status; nothing else is read here. An actor carries no `lifecycleStatus`, so this returns no tone for it. A module sub-tile's tone is computed separately from `ContextModule.lifecycleStatus`. */
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

/** Greedily fills each line with as many whole words as fit `maxWidth` (the current `ctx.font`'s own metrics), up to `maxLines`; whatever's left after the last allowed line is ellipsized onto it via `truncate` rather than silently dropped. */
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

/** Fit is driven by width alone, capped at 1.5× — a dense diagram reads as tall (channels full of lanes and label stacks) and is panned into view, same as the landscape's own canvas. */
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

function unitOf(element: ElementsHeadRow, platformModulesById: ReadonlyMap<UUID, ContextModule[]>): DiagramUnitInput {
  const modules = platformModulesById.get(element.element_id) ?? [];
  return { elementId: element.element_id, modules: modules.map((m) => ({ elementId: m.elementId, capabilityName: m.capabilityName })) };
}

/** Rework item 1: every hub module this neighbour's edges attach to — the fan orders the neighbour by their mean centre. Reads `hubModuleIds` alone (computed before layout), not the placed `layout.hub.modules`, so there's no circularity between "where does this neighbour belong" and "where did layout put the modules." */
function attachedModuleIdsFor(neighbour: ContextNeighbour, hubModuleIds: ReadonlySet<UUID>): UUID[] {
  const ids = new Set<UUID>();
  for (const edge of neighbour.edges) {
    if (hubModuleIds.has(edge.from_element_id)) ids.add(edge.from_element_id);
    else if (hubModuleIds.has(edge.to_element_id)) ids.add(edge.to_element_id);
  }
  return [...ids].sort();
}

function neighbourUnitOf(neighbour: ContextNeighbour, platformModulesById: ReadonlyMap<UUID, ContextModule[]>, hubModuleIds: ReadonlySet<UUID>): DiagramUnitInput {
  return { ...unitOf(neighbour.element, platformModulesById), attachedModuleIds: attachedModuleIdsFor(neighbour, hubModuleIds) };
}

/**
 * V1's own canvas renderer — the Context view's diagram, on the same
 * technology (`<canvas>` 2D, DOM only for the toolbar/tooltip) as
 * `LandscapeCanvas.tsx`, reusing its zoom/pan/fit shape verbatim. Narrower
 * in scope than that component (no diff highlighting, no colour-by beyond
 * the one lifecycle tone V1 asks for, no comment markers — decision 11,
 * UI-principles §10).
 *
 * Label routing rework (five-neighbour stress case, `fixtures/sapContext.ts`):
 * every edge is an orthogonal route from `contextDiagramLayout.ts` with
 * its own lane and attach points; its label is a pill on its own drop just
 * above the neighbour it leaves (`placeEdgeLabels`); when the audit
 * (`edgeLabelsCollide`) finds pills that would still stack, labels default
 * to hidden and the pointer reveals one edge's label at a time — the
 * "Labels" toolbar toggle overrides either way.
 */
export function ContextDiagramCanvas({ group, platformModulesById, layoutWidthHint, neighbourContextHref, elementHref }: ContextDiagramCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<UUID | null>(null);
  const [labelMode, setLabelMode] = useState<LabelMode>('auto');
  /** Rework item 4: what the collision audit found on the last draw — `true` means labels would collide if all shown. Set from inside `draw()` only when it changes, so it never loops the render. */
  const [labelsWouldCollide, setLabelsWouldCollide] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);
  /** A module has no DOM node to carry a `title` attribute (this is a `<canvas>`), so its ellipsized full text is kept here for the overlay tooltip, keyed by module id, populated by `draw()`. */
  const moduleTooltipsRef = useRef<Map<UUID, string>>(new Map());

  const elementsById = useMemo(() => {
    const map = new Map<UUID, ElementsHeadRow>([[group.hub.element_id, group.hub]]);
    for (const n of [...group.internal, ...group.external]) map.set(n.element.element_id, n.element);
    return map;
  }, [group]);

  // A module (container) never lands in `elementsById` — `useSystemContext.ts` excludes a platform's own module ids from the neighbour query by design — so `platformModulesById` is the only source of a module's own name/tone; flattened here by module id.
  const moduleByElementId = useMemo(() => {
    const map = new Map<UUID, ContextModule>();
    for (const modules of platformModulesById.values()) {
      for (const module of modules) map.set(module.elementId, module);
    }
    return map;
  }, [platformModulesById]);

  const hubModuleIds = useMemo(() => new Set((platformModulesById.get(group.hub.element_id) ?? []).map((m) => m.elementId)), [platformModulesById, group.hub.element_id]);

  /** Every drawn edge, in the layout's own input shape — the hub side is the hub itself or one of its modules; the arrow belongs at the logical `to` side. */
  const edgeInputs = useMemo<ContextEdgeInput[]>(() => {
    const result: ContextEdgeInput[] = [];
    for (const neighbour of [...group.internal, ...group.external]) {
      for (const edge of neighbour.edges) {
        const fromIsHub = edge.from_element_id === group.hub.element_id || hubModuleIds.has(edge.from_element_id);
        result.push({
          id: edge.relationship_id,
          neighbourId: neighbour.element.element_id,
          hubEndpointId: fromIsHub ? edge.from_element_id : edge.to_element_id,
          arrowAtHub: !fromIsHub,
          label: edgeLabel(edge, group.hub.element_id),
        });
      }
    }
    return result;
  }, [group, hubModuleIds]);

  const layout = useMemo<ContextDiagramLayout>(
    () =>
      computeContextDiagramLayout(
        unitOf(group.hub, platformModulesById),
        group.internal.map((n) => neighbourUnitOf(n, platformModulesById, hubModuleIds)),
        group.external.map((n) => neighbourUnitOf(n, platformModulesById, hubModuleIds)),
        layoutWidthHint,
        edgeInputs,
      ),
    [group, platformModulesById, hubModuleIds, layoutWidthHint, edgeInputs],
  );

  const labelById = useMemo(() => new Map(layout.edges.map((e) => [e.id, e.label])), [layout]);

  const fitToView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setTransform(computeFitTransform(layout.width, layout.height, wrapper.clientWidth, wrapper.clientHeight));
  }, [layout.width, layout.height]);

  useEffect(() => {
    fitToView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const toWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } => ({ x: (screenX - transform.tx) / transform.scale, y: (screenY - transform.ty) / transform.scale }), [transform]);

  const tileAt = useCallback(
    (screenX: number, screenY: number): DiagramTile | null => {
      const { x: worldX, y: worldY } = toWorld(screenX, screenY);
      for (const tile of allTilesOf(layout)) {
        if (worldX >= tile.x && worldX <= tile.x + tile.w && worldY >= tile.y && worldY <= tile.y + tile.h) return tile;
      }
      return null;
    },
    [layout, toWorld],
  );

  const moduleAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      const { x: worldX, y: worldY } = toWorld(screenX, screenY);
      for (const tile of allTilesOf(layout)) {
        for (const module of tile.modules ?? []) {
          if (worldX >= module.x && worldX <= module.x + module.w && worldY >= module.y && worldY <= module.y + module.h) return module.elementId;
        }
      }
      return null;
    },
    [layout, toWorld],
  );

  const edgeAt = useCallback((screenX: number, screenY: number): UUID | null => edgeNear(layout.edges, toWorld(screenX, screenY), EDGE_HIT_TOLERANCE_PX / transform.scale)?.id ?? null, [layout, toWorld, transform.scale]);

  const zoomShowsText = NODE_WIDTH * transform.scale >= 64;
  const edgeLabelsVisible = zoomShowsText && (labelMode === 'show' || (labelMode === 'auto' && !labelsWouldCollide));

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

      const showLabels = zoomShowsText;

      // The dotted enterprise boundary — around the hub and internal neighbours only, drawn first so tiles/edges layer on top.
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

      // Rework item 2: every edge is an axis-aligned polyline from the layout — its own lane, its own attach points. The hovered edge draws last and heavier so it reads on top of its neighbours.
      const platformMarkers: { worldX: number; worldY: number }[] = [];
      const drawEdge = (edge: (typeof layout.edges)[number], highlighted: boolean): void => {
        if (edge.hubAnchor.isPlatformFallback) platformMarkers.push({ worldX: edge.hubAnchor.x, worldY: edge.hubAnchor.y });
        ctx.save();
        ctx.strokeStyle = highlighted ? tokens.text : tokens.borderStrong;
        ctx.lineWidth = highlighted ? 2.5 : 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        edge.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();

        // One arrowhead, at the target only (UI-principles §9) — both ends are vertical runs into a tile's top/bottom edge, so no angle computation.
        const targetAnchor = edge.arrowAtHub ? edge.hubAnchor : edge.neighbourAnchor;
        const arrowSign = edge.arrowAtHub ? -1 : 1; // up into the hub/module, or down into the neighbour
        ctx.save();
        ctx.translate(targetAnchor.x, targetAnchor.y);
        ctx.rotate(arrowSign > 0 ? Math.PI / 2 : -Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fillStyle = highlighted ? tokens.text : tokens.borderStrong;
        ctx.fill();
        ctx.restore();
      };
      for (const edge of layout.edges) if (edge.id !== hoveredEdgeId) drawEdge(edge, false);
      const hoveredEdge = layout.edges.find((e) => e.id === hoveredEdgeId);
      if (hoveredEdge) drawEdge(hoveredEdge, true);

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number; maxWidth: number }[] = [];
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

      // Text, screen-space (dpr only): quantised zoom keeps text a fixed on-screen size within a zoom step rather than scaling continuously. Every box-relative bound below tracks the real `transform.scale`, not the quantised `textScale` — only the font itself is pinned to `textScale`.
      const textScale = quantizeScale(transform.scale, MIN_SCALE, MAX_SCALE);
      const toScreen = (worldX: number, worldY: number): [number, number] => [worldX * transform.scale + transform.tx, worldY * transform.scale + transform.ty];
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

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
        const nameLines = wrapLines(ctx, label.name, label.maxWidth * transform.scale, 2);
        nameLines.forEach((line, i) => {
          ctx.fillText(line, x, y + i * 11 * textScale);
        });
        let capLines: string[] = [];
        if (label.capability) {
          ctx.fillStyle = tokens.textMuted;
          ctx.font = `${(9 * textScale).toFixed(2)}px sans-serif`;
          capLines = wrapLines(ctx, label.capability, label.maxWidth * transform.scale, 2);
          capLines.forEach((line, i) => {
            ctx.fillText(line, x, y + (26 + i * 10) * textScale);
          });
        }
        const nameTruncated = nameLines.at(-1)?.endsWith('…') ?? false;
        const capabilityTruncated = capLines.at(-1)?.endsWith('…') ?? false;
        if (nameTruncated || capabilityTruncated) {
          const full = label.capability ? `${label.name} — ${label.capability}` : label.name;
          moduleTooltipsRef.current.set(label.elementId, full);
        }
      }

      // Rework items 3–4: label pills, placed in world units by the pure layout module (widths measured at the current font and divided back to world), audited for collisions, then drawn — all of them when labels are visible, only the hovered edge's when they're hidden.
      ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
      ctx.textAlign = 'center';
      const measureWorld = (text: string): number => ctx.measureText(text).width / transform.scale;
      const pills = placeEdgeLabels(layout.edges, measureWorld);
      const collide = edgeLabelsCollide(pills, allTilesOf(layout));
      if (collide !== labelsWouldCollide) setLabelsWouldCollide(collide);
      const labelsShown = showLabels && (labelMode === 'show' || (labelMode === 'auto' && !collide));
      const pillsToDraw: EdgeLabelPill[] = labelsShown ? pills : pills.filter((p) => p.edgeId === hoveredEdgeId);
      const hoveredLast = [...pillsToDraw.filter((p) => p.edgeId !== hoveredEdgeId), ...pillsToDraw.filter((p) => p.edgeId === hoveredEdgeId)];
      const edgeLabelLineHeight = 12 * textScale;
      for (const pill of hoveredLast) {
        const highlighted = pill.edgeId === hoveredEdgeId;
        const [left, top] = toScreen(pill.x - pill.width / 2, pill.y - pill.height / 2);
        const w = pill.width * transform.scale;
        const h = pill.height * transform.scale;
        // Opaque, drawn after every edge and tile (z-order) — the leader passes behind it, never through the text.
        roundRectPath(ctx, left, top, w, h, h / 2);
        ctx.fillStyle = tokens.surfaceRaised;
        ctx.fill();
        ctx.strokeStyle = highlighted ? tokens.text : tokens.border;
        ctx.lineWidth = highlighted ? 1.5 : 1;
        ctx.stroke();
        ctx.fillStyle = highlighted ? tokens.text : tokens.textMuted;
        const [cx, cy] = toScreen(pill.x, pill.y);
        const startY = cy - ((pill.lines.length - 1) * edgeLabelLineHeight) / 2;
        pill.lines.forEach((line, i) => {
          ctx.fillText(line, cx, startY + i * edgeLabelLineHeight);
        });
      }

      // V1's own "which module?" marker — a small filled "?" badge at the platform tile's own edge, where S1 item 20's `findFlowsToPlatformInsteadOfModule` health finding already flags the same fact.
      const seenMarkers = new Set<string>();
      for (const marker of platformMarkers) {
        const key = `${String(marker.worldX)} ${String(marker.worldY)}`;
        if (seenMarkers.has(key)) continue;
        seenMarkers.add(key);
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
  }, [layout, elementsById, moduleByElementId, transform, hover, hoveredEdgeId, labelMode, labelsWouldCollide, zoomShowsText]);

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
    // A module tile only ever shows a tooltip when its own text actually truncated — checked before the plain tile hover so hovering a module reveals its own full text rather than the platform tile's name underneath it.
    const moduleId = moduleAt(screenX, screenY);
    if (moduleId) {
      const tooltip = moduleTooltipsRef.current.get(moduleId);
      setHover(tooltip ? { label: tooltip, screenX, screenY } : null);
      setHoveredEdgeId(null);
      return;
    }
    const tile = tileAt(screenX, screenY);
    if (tile) {
      const element = elementsById.get(tile.elementId);
      setHover(element ? { label: element.name, screenX, screenY } : null);
      setHoveredEdgeId(null);
      return;
    }
    // Rework item 4: pointer on an edge highlights it and, when labels are hidden, reveals its verb in the tooltip.
    const edgeId = edgeAt(screenX, screenY);
    setHoveredEdgeId(edgeId);
    const label = edgeId ? labelById.get(edgeId) : undefined;
    setHover(edgeId && label && !edgeLabelsVisible ? { label, screenX, screenY } : null);
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
    if (!tile) {
      // Touch has no hover: a tap on an edge toggles that edge's label (rework item 4's "show on hover/tap").
      const edgeId = edgeAt(screenX, screenY);
      const next = edgeId && edgeId !== hoveredEdgeId ? edgeId : null;
      setHoveredEdgeId(next);
      const label = next ? labelById.get(next) : undefined;
      setHover(next && label && !edgeLabelsVisible ? { label, screenX, screenY } : null);
      return;
    }
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
    else if (e.key === 'l') setLabelMode(edgeLabelsVisible ? 'hide' : 'show');
  }

  return (
    <div ref={wrapperRef} className={styles.wrapper} data-scale={transform.scale} data-tx={transform.tx} data-ty={transform.ty} data-edge-labels={edgeLabelsVisible ? 'visible' : 'hidden'} data-edge-labels-collide={labelsWouldCollide ? 'true' : 'false'}>
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
          setHoveredEdgeId(null);
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
        {/* Rework item 4: the override. `aria-pressed` reports the labels' *effective* state, so a reviewer (and Playwright) can read whether the audit hid them. */}
        <button
          type="button"
          className={styles.toolbarButton}
          aria-label="Show edge labels"
          aria-pressed={edgeLabelsVisible}
          title={labelMode === 'auto' && labelsWouldCollide ? 'Labels hidden automatically: they would overlap at this density. Hover or tap an edge to see its label, or switch them on.' : 'Show or hide the verb label on every edge'}
          onClick={() => {
            setLabelMode(edgeLabelsVisible ? 'hide' : 'show');
          }}
        >
          Labels
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
