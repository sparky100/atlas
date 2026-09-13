import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { quantizeScale } from '../landscape/zoom';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';
import { allTilesOf, anchorFor, computeContextDiagramLayout, type ContextDiagramLayout, type DiagramTile, type DiagramUnitInput } from './contextDiagramLayout';
import { edgeLabel, type ContextGroup } from './contextGrouping';
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

/** V1's own "Tone: lifecycle ... only" — a system tile's fill tint comes from its own recorded lifecycle status, the same `lifecycleToneFor` mapping `ElementHeader.tsx`'s own status chip already uses; nothing else (criticality, hosting model, exposure) is read here. An actor or container carries no `lifecycleStatus` of its own, so this naturally returns no tone for either — the same "silent when the fact doesn't apply" shape `landscapeTileColourFor` uses for its own colour-by modes. */
function toneColour(element: ElementsHeadRow, tokens: CanvasTokens): string | undefined {
  if (element.element_type !== 'system') return undefined;
  const status = attributesRecord(element.attributes).lifecycleStatus;
  if (typeof status !== 'string') return undefined;
  const tone = lifecycleToneFor(status);
  if (!tone) return undefined;
  return { ok: tokens.statusOk, warn: tokens.statusWarn, danger: tokens.statusDanger, info: tokens.statusInfo, neutral: tokens.statusNeutral }[tone];
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

function computeFitTransform(worldWidth: number, worldHeight: number, displayWidth: number, displayHeight: number): Transform {
  if (worldWidth <= 0 || worldHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) return { scale: 1, tx: 0, ty: 0 };
  const availableWidth = Math.max(1, displayWidth - FIT_MARGIN_PX * 2);
  const availableHeight = Math.max(1, displayHeight - FIT_MARGIN_PX * 2);
  const rawScale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight, 1);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
  const tx = (displayWidth - worldWidth * scale) / 2;
  const ty = (displayHeight - worldHeight * scale) / 2;
  return { scale, tx, ty };
}

interface DrawEdge {
  fromTile: DiagramTile;
  toTile: DiagramTile;
  fromEndpoint: UUID;
  toEndpoint: UUID;
  label: string;
}

function unitOf(element: ElementsHeadRow, platformModulesById: ReadonlyMap<UUID, ContextModule[]>): DiagramUnitInput {
  const modules = platformModulesById.get(element.element_id) ?? [];
  return { elementId: element.element_id, modules: modules.map((m) => ({ elementId: m.elementId, capabilityName: m.capabilityName })) };
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

  const elementsById = useMemo(() => {
    const map = new Map<UUID, ElementsHeadRow>([[group.hub.element_id, group.hub]]);
    for (const n of [...group.internal, ...group.external]) map.set(n.element.element_id, n.element);
    return map;
  }, [group]);

  const layout = useMemo<ContextDiagramLayout>(
    () =>
      computeContextDiagramLayout(
        unitOf(group.hub, platformModulesById),
        group.internal.map((n) => unitOf(n.element, platformModulesById)),
        group.external.map((n) => unitOf(n.element, platformModulesById)),
        layoutWidthHint,
      ),
    [group, platformModulesById, layoutWidthHint],
  );

  const tileByElementId = useMemo(() => new Map(allTilesOf(layout).map((t) => [t.elementId, t])), [layout]);

  const edges = useMemo<DrawEdge[]>(() => {
    const result: DrawEdge[] = [];
    for (const neighbour of [...group.internal, ...group.external]) {
      const neighbourTile = tileByElementId.get(neighbour.element.element_id);
      if (!neighbourTile) continue;
      for (const edge of neighbour.edges) {
        const fromIsHub = edge.from_element_id === group.hub.element_id || (layout.hub.modules?.some((m) => m.elementId === edge.from_element_id) ?? false);
        const fromTile = fromIsHub ? layout.hub : neighbourTile;
        const toTile = fromIsHub ? neighbourTile : layout.hub;
        result.push({ fromTile, toTile, fromEndpoint: edge.from_element_id, toEndpoint: edge.to_element_id, label: edgeLabel(edge, group.hub.element_id) });
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

      const edgeLabels: { text: string; worldX: number; worldY: number }[] = [];
      const platformMarkers: { worldX: number; worldY: number }[] = [];
      for (const edge of edges) {
        const from = anchorFor(edge.fromTile, edge.fromEndpoint);
        const to = anchorFor(edge.toTile, edge.toEndpoint);
        if (from.isPlatformFallback) platformMarkers.push({ worldX: from.x, worldY: from.y });
        if (to.isPlatformFallback) platformMarkers.push({ worldX: to.x, worldY: to.y });

        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        if (showLabels && edge.label.trim().length > 0) {
          edgeLabels.push({ text: edge.label, worldX: (from.x + to.x) / 2, worldY: (from.y + to.y) / 2 });
        }

        // One arrowhead, direction-only (UI-principles §9) — same shape
        // LandscapeCanvas.tsx's own arrowhead uses, oriented along this
        // edge's own line (never routed here, so always the direct angle).
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        const arrowX = to.x - Math.cos(angle) * (NODE_HEIGHT / 2);
        const arrowY = to.y - Math.sin(angle) * (NODE_HEIGHT / 2);
        ctx.translate(arrowX, arrowY);
        ctx.rotate(angle);
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
      const moduleLabels: { name: string; capability: string | null; worldX: number; worldY: number; maxWidth: number }[] = [];

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
          const titleY = tile.modules ? tile.y + 12 : tile.y + tile.h / 2;
          nodeLabels.push({ glyph, name: element.name, worldX: tile.x, worldY: titleY, maxWidth: tile.w - 30 });
        }

        for (const module of tile.modules ?? []) {
          ctx.save();
          roundRectPath(ctx, module.x, module.y, module.w, module.h, 6);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          ctx.strokeStyle = tokens.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
          if (showLabels) moduleLabels.push({ name: elementsById.get(module.elementId)?.name ?? '', capability: module.capabilityName, worldX: module.x + module.w / 2, worldY: module.y + 12, maxWidth: module.w - 8 });
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

      for (const label of nodeLabels) {
        const [x, y] = toScreen(label.worldX, label.worldY);
        ctx.fillStyle = tokens.text;
        ctx.font = `${(14 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(label.glyph, x + 8 * textScale, y);
        ctx.font = `${(12 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillText(truncate(ctx, label.name, label.maxWidth * textScale), x + 26 * textScale, y);
      }

      ctx.textAlign = 'center';
      ctx.font = `${(10 * textScale).toFixed(2)}px sans-serif`;
      for (const label of moduleLabels) {
        const [x, y] = toScreen(label.worldX, label.worldY);
        ctx.fillStyle = tokens.text;
        ctx.fillText(truncate(ctx, label.name, label.maxWidth * textScale), x, y);
        if (label.capability) {
          ctx.fillStyle = tokens.textMuted;
          ctx.font = `${(9 * textScale).toFixed(2)}px sans-serif`;
          ctx.fillText(truncate(ctx, label.capability, label.maxWidth * textScale), x, y + 12 * textScale);
          ctx.font = `${(10 * textScale).toFixed(2)}px sans-serif`;
        }
      }

      ctx.fillStyle = tokens.textMuted;
      ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
      for (const label of edgeLabels) {
        const [x, y] = toScreen(label.worldX, label.worldY);
        ctx.fillText(truncate(ctx, label.text, NODE_WIDTH * 1.5 * textScale), x, y - 8 * textScale);
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
  }, [layout, edges, elementsById, transform, hover]);

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
