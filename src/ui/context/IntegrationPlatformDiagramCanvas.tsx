import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { moduleDisplayNameFromMap } from '../elements/moduleDisplayName';
import { quantizeScale } from '../landscape/zoom';
import { NODE_WIDTH } from '../landscape/layout';
import { allPlatformFlowTilesOf, computeIntegrationPlatformContextLayout, type IntegrationPlatformContextLayout, type PlatformFlowEdgeInput, type PlatformFlowTile } from './integrationPlatformContextLayout';
import styles from './IntegrationPlatformDiagramCanvas.module.css';

export interface IntegrationPlatformDiagramCanvasProps {
  hub: ElementsHeadRow;
  sourceIds: readonly UUID[];
  targetIds: readonly UUID[];
  edges: readonly PlatformFlowEdgeInput[];
  elementsById: ReadonlyMap<UUID, ElementsHeadRow>;
  /** A system/container neighbour tile navigates to its own Context page; an actor (no Context view of its own, same reasoning `ContextDiagramCanvas.tsx`'s own prop comment gives) falls back to `elementHref`. */
  neighbourContextHref: (elementId: UUID) => string;
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
const FIT_MAX_SCALE = 1.5;

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

function toneColour(element: ElementsHeadRow, tokens: CanvasTokens): string | undefined {
  if (element.element_type !== 'system' && element.element_type !== 'container') return undefined;
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
  const rawScale = Math.min(availableWidth / worldWidth, availableHeight / worldHeight, FIT_MAX_SCALE);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, rawScale));
  const tx = (displayWidth - worldWidth * scale) / 2;
  const ty = (displayHeight - worldHeight * scale) / 2;
  return { scale, tx, ty };
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, tokens: CanvasTokens, warn: boolean): void {
  if (text.trim().length === 0) return;
  const paddingX = 8;
  const maxWidth = 160;
  const shown = truncate(ctx, text, maxWidth);
  const textWidth = ctx.measureText(shown).width;
  const w = textWidth + paddingX * 2;
  const h = 18;
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = tokens.surfaceRaised;
  ctx.fill();
  ctx.strokeStyle = warn ? tokens.statusWarn : tokens.border;
  ctx.lineWidth = warn ? 1.5 : 1;
  ctx.stroke();
  ctx.fillStyle = warn ? tokens.statusWarn : tokens.textMuted;
  ctx.fillText(shown, cx, cy);
}

/**
 * Integration platform context's own canvas — the "source → platform →
 * target" diagram, `<canvas>` 2D on the same technology as
 * `ContextDiagramCanvas.tsx`/`LandscapeCanvas.tsx` (pan/zoom/fit, DOM
 * toolbar/tooltip only). Deliberately simpler than that sibling: no
 * click-to-focus/Inspector step (a tile click navigates straight away,
 * the same one-click shape `PlatformStructureView.tsx`'s own module grid
 * already uses for the sibling "platforms and modules" concept) and no
 * label-collision auto-hide (`integrationPlatformContextLayout.ts`'s own
 * module comment names both simplifications).
 *
 * IT/OT boundary crossings (the prompt's own "highlighted"): a crossing
 * edge draws in `--status-warn` rather than the ordinary border colour,
 * the same tone `DOMAIN_TONE.ot` already uses for "this is the fact worth
 * a second look" elsewhere in the product — never colour-only, since the
 * classification pill on that same edge is real text a screen reader (or
 * a colour-blind reviewer) can still read.
 *
 * "Platform · Module": a source/target tile's own label reads
 * `moduleDisplayNameFromMap(element, elementsById)`, not the raw
 * `element.name` — `elementsById` (the caller's own `endpoints` map) must
 * already carry each container's own parent for this to resolve, same
 * requirement `contextGrouping.ts`'s own `computeContextGroup` documents.
 */
export function IntegrationPlatformDiagramCanvas({ hub, sourceIds, targetIds, edges, elementsById, neighbourContextHref, elementHref }: IntegrationPlatformDiagramCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);

  const layout = useMemo<IntegrationPlatformContextLayout>(() => computeIntegrationPlatformContextLayout(hub.element_id, sourceIds, targetIds, edges), [hub.element_id, sourceIds, targetIds, edges]);

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
    (screenX: number, screenY: number): PlatformFlowTile | null => {
      const { x: worldX, y: worldY } = toWorld(screenX, screenY);
      for (const tile of allPlatformFlowTilesOf(layout)) {
        if (worldX >= tile.x && worldX <= tile.x + tile.w && worldY >= tile.y && worldY <= tile.y + tile.h) return tile;
      }
      return null;
    },
    [layout, toWorld],
  );

  const zoomShowsText = NODE_WIDTH * transform.scale >= 64;

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

      const drawPolyline = (points: readonly { x: number; y: number }[], warn: boolean, arrowAtEnd: boolean): void => {
        ctx.save();
        ctx.strokeStyle = warn ? tokens.statusWarn : tokens.borderStrong;
        ctx.lineWidth = warn ? 2 : 1.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.restore();

        const end = points[points.length - 1];
        const prev = points[points.length - 2];
        if (!arrowAtEnd || !end || !prev) return;
        const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
        ctx.save();
        ctx.translate(end.x, end.y);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fillStyle = warn ? tokens.statusWarn : tokens.borderStrong;
        ctx.fill();
        ctx.restore();
      };

      // Every via-flow: source → platform (arrow into the platform),
      // platform → target (arrow into the target) — two separate drawn
      // segments per the prompt's own "each via-flow drawn as source →
      // platform → target."
      for (const edge of layout.edges) {
        drawPolyline(edge.sourceSegment, edge.crossesBoundary, true);
        drawPolyline(edge.targetSegment, edge.crossesBoundary, true);
      }

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number; maxWidth: number }[] = [];

      const drawTile = (tile: PlatformFlowTile, isHub: boolean): void => {
        const element = elementsById.get(tile.elementId);
        if (!element) return;
        const displayName = moduleDisplayNameFromMap(element, elementsById);
        const external = attributesRecord(element.attributes).isExternal === true;
        const isHovered = hover?.label === displayName;

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

        if (zoomShowsText) {
          const glyph = element.element_type === 'actor' ? elementTypeGlyph('actor', attributesRecord(element.attributes).subtype as ActorSubtype | undefined) : elementTypeGlyph(element.element_type);
          nodeLabels.push({ glyph, name: displayName, worldX: tile.x, worldY: tile.y + tile.h / 2, maxWidth: tile.w - 30 });
        }
      };

      for (const tile of layout.sources) drawTile(tile, false);
      for (const tile of layout.targets) drawTile(tile, false);
      drawTile(layout.hub, true);

      ctx.restore();

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
        const truncated = truncate(ctx, label.name, label.maxWidth * transform.scale);
        ctx.fillText(truncated, x + 26 * transform.scale, y);
      }

      // Rework of `contextDiagramLayout.ts`'s own pill drawing, simplified
      // (no wrapping, no collision audit — this module's own top comment):
      // the verb label on the source→hub segment, the classification chip
      // on the hub→target segment, both only once the tiles are already
      // legible (`zoomShowsText`) — a pill nobody could read at this zoom
      // would just be noise.
      if (zoomShowsText) {
        ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
        ctx.textAlign = 'center';
        for (const edge of layout.edges) {
          const [vx, vy] = toScreen(edge.verbLabelAnchor.x, edge.verbLabelAnchor.y);
          drawPill(ctx, edge.verbLabel, vx, vy, tokens, edge.crossesBoundary);
          if (edge.classificationLabel) {
            const [cx, cy] = toScreen(edge.classificationLabelAnchor.x, edge.classificationLabelAnchor.y);
            drawPill(ctx, edge.classificationLabel, cx, cy, tokens, edge.crossesBoundary);
          }
        }
        ctx.textAlign = 'left';
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [layout, elementsById, transform, hover, zoomShowsText]);

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
    const element = tile ? elementsById.get(tile.elementId) ?? (tile.elementId === hub.element_id ? hub : undefined) : undefined;
    setHover(element ? { label: moduleDisplayNameFromMap(element, elementsById), screenX, screenY } : null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;

    const tile = tileAt(screenX, screenY);
    if (!tile) return;
    if (tile.elementId === hub.element_id) {
      void navigate(elementHref(hub.element_id));
      return;
    }
    const element = elementsById.get(tile.elementId);
    void navigate(element?.element_type === 'system' || element?.element_type === 'container' ? neighbourContextHref(tile.elementId) : elementHref(tile.elementId));
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
        aria-label={`Integration platform diagram: ${hub.name}, ${String(sourceIds.length)} sources and ${String(targetIds.length)} targets. Use the flows list below for an accessible, list-based view.`}
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
