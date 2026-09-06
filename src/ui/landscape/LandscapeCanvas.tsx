import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/elementTypeGlyph';
import { attributesRecord } from '../elements/attributesRecord';
import { NODE_HEIGHT, NODE_WIDTH, type LandscapeLayout } from './layout';
import { quantizeScale } from './zoom';
import styles from './LandscapeCanvas.module.css';

export interface LandscapeCanvasProps {
  layout: LandscapeLayout;
  systemsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  orgSlug: string;
  modelSlug: string;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

interface HoverState {
  elementId: UUID;
  screenX: number;
  screenY: number;
}

const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const CLICK_DRAG_THRESHOLD_PX = 4;

/** The few tokens the canvas needs, read once per draw from computed style — `var()` doesn't work inside a 2D context's fillStyle, so this is the one place colours are read as resolved values instead of CSS custom properties (design tokens remain the single source; this just reads them). */
interface CanvasTokens {
  border: string;
  borderStrong: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  accent: string;
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
    accent: v('--accent'),
  };
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

interface WorldRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The visible world-space rectangle, expanded by a 20% margin each side (UI-principles §8.6's viewport-culling allowance — a node just off-screen shouldn't pop in only once its edge crosses the exact viewport boundary). */
function visibleWorldRect(transform: Transform, displayWidth: number, displayHeight: number): WorldRect {
  const left = -transform.tx / transform.scale;
  const top = -transform.ty / transform.scale;
  const right = (displayWidth - transform.tx) / transform.scale;
  const bottom = (displayHeight - transform.ty) / transform.scale;
  const marginX = (right - left) * 0.2;
  const marginY = (bottom - top) * 0.2;
  return { left: left - marginX, top: top - marginY, right: right + marginX, bottom: bottom + marginY };
}

function rectIntersects(rect: WorldRect, x: number, y: number, w: number, h: number): boolean {
  return x + w >= rect.left && x <= rect.right && y + h >= rect.top && y <= rect.bottom;
}

/**
 * The landscape's renderer (UI-principles §6.1/§8.6): Canvas 2D for
 * lanes/nodes/edges/labels, DOM only for the hover tooltip. Layout itself
 * runs in a Web Worker (layoutWorkerClient.ts); this component's own §8.6
 * work is viewport culling (a node/edge outside the visible rect, +20%
 * margin, is skipped entirely — no path built, no fill, no stroke),
 * quantised-zoom text sizing (zoom.ts — 8 discrete steps, not a continuous
 * scale, so text doesn't visibly jitter during a smooth zoom gesture), and
 * the label/edge LOD thresholds below. Diff highlighting and annotations
 * are later steps, not skipped, named.
 *
 * Full keyboard node-by-node traversal is not built here: §8.7 is explicit
 * that "the element page and the relationships list *are* the accessible
 * view of any diagram" — clicking a node navigates to exactly that page.
 * `+`/`-`/`0` (§8.8's canvas key table) zoom/fit, which this does implement.
 */
export function LandscapeCanvas({ layout, systemsById, edges, orgSlug, modelSlug }: LandscapeCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);

  const nodeAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const node of layout.nodes) {
        if (worldX >= node.x && worldX <= node.x + NODE_WIDTH && worldY >= node.y && worldY <= node.y + NODE_HEIGHT) {
          return node.elementId;
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

      const visible = visibleWorldRect(transform, displayWidth, displayHeight);
      const showLabels = NODE_WIDTH * transform.scale >= 64;
      // Screen-space width the base 1.5px world stroke would render at,
      // before culling it or drawing it in simplified form (§8.6: "<0.5px
      // aggregated, <0.25px not drawn").
      const edgeScreenWidth = 1.5 * transform.scale;

      const laneLabels: { text: string; worldX: number; worldY: number }[] = [];
      for (const lane of layout.lanes) {
        if (lane.y > visible.bottom || lane.y + lane.height < visible.top) continue;
        laneLabels.push({ text: lane.label.toUpperCase(), worldX: 4, worldY: lane.y + 8 });
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lane.y + lane.height - 16);
        ctx.lineTo(layout.width, lane.y + lane.height - 16);
        ctx.stroke();
      }

      if (edgeScreenWidth >= 0.25) {
        const positionById = new Map(layout.nodes.map((n) => [n.elementId, n]));
        const simplified = edgeScreenWidth < 0.5;
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = simplified ? 1 / transform.scale : 1.5;
        for (const edge of edges) {
          const from = positionById.get(edge.from_element_id);
          const to = positionById.get(edge.to_element_id);
          if (!from || !to) continue;
          const left = Math.min(from.x, to.x);
          const top = Math.min(from.y, to.y);
          if (!rectIntersects(visible, left, top, Math.abs(from.x - to.x) + NODE_WIDTH, Math.abs(from.y - to.y) + NODE_HEIGHT)) continue;

          const fromCx = from.x + NODE_WIDTH / 2;
          const fromCy = from.y + NODE_HEIGHT / 2;
          const toCx = to.x + NODE_WIDTH / 2;
          const toCy = to.y + NODE_HEIGHT / 2;
          ctx.beginPath();
          ctx.moveTo(fromCx, fromCy);
          ctx.lineTo(toCx, toCy);
          ctx.stroke();
          // "Aggregated": below the 0.5px tier, a plain hairline with no
          // arrowhead stands in for what would otherwise be a dense tangle
          // of individually-indistinguishable direction markers.
          if (simplified) continue;
          // One arrowhead, direction-only semantics (UI-principles §9) —
          // never a per-relationship-type marker style.
          const angle = Math.atan2(toCy - fromCy, toCx - fromCx);
          const arrowX = toCx - Math.cos(angle) * (NODE_WIDTH / 2);
          const arrowY = toCy - Math.sin(angle) * (NODE_HEIGHT / 2);
          ctx.save();
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
      }

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number }[] = [];
      for (const node of layout.nodes) {
        if (!rectIntersects(visible, node.x, node.y, NODE_WIDTH, NODE_HEIGHT)) continue;
        const system = systemsById.get(node.elementId);
        if (!system) continue;
        const external = attributesRecord(system.attributes).isExternal === true;
        const isHovered = hover?.elementId === node.elementId;
        roundRectPath(ctx, node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8);
        ctx.fillStyle = tokens.surfaceRaised;
        ctx.fill();
        ctx.strokeStyle = isHovered ? tokens.accent : tokens.borderStrong;
        ctx.lineWidth = isHovered ? 2 : 1;
        if (external) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        if (showLabels) nodeLabels.push({ glyph: elementTypeGlyph('system'), name: system.name, worldX: node.x, worldY: node.y });
      }

      ctx.restore();

      // Text, in a second pass, entirely in screen space (dpr scale only —
      // not `transform`): quantised zoom (zoom.ts) means text should hold a
      // fixed on-screen size within a zoom step, not scale continuously
      // with the gesture the way node geometry does, so it can't share the
      // world-transformed pass above.
      if (laneLabels.length > 0 || nodeLabels.length > 0) {
        const textScale = quantizeScale(transform.scale, MIN_SCALE, MAX_SCALE);
        const toScreen = (worldX: number, worldY: number): [number, number] => [worldX * transform.scale + transform.tx, worldY * transform.scale + transform.ty];
        ctx.textBaseline = 'middle';

        ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillStyle = tokens.textMuted;
        for (const label of laneLabels) {
          const [x, y] = toScreen(label.worldX, label.worldY);
          ctx.fillText(label.text, x, y);
        }

        for (const label of nodeLabels) {
          const [x, y] = toScreen(label.worldX, label.worldY);
          const screenNodeHeight = NODE_HEIGHT * transform.scale;
          ctx.fillStyle = tokens.text;
          ctx.font = `${(14 * textScale).toFixed(2)}px sans-serif`;
          ctx.fillText(label.glyph, x + 10 * textScale, y + screenNodeHeight / 2);
          ctx.font = `${(12 * textScale).toFixed(2)}px sans-serif`;
          const truncated = truncate(ctx, label.name, (NODE_WIDTH - 34) * textScale);
          ctx.fillText(truncated, x + 30 * textScale, y + screenNodeHeight / 2);
        }
      }
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [layout, edges, systemsById, transform, hover]);

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

    const elementId = nodeAt(screenX, screenY);
    setHover(elementId ? { elementId, screenX, screenY } : null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;
    const elementId = nodeAt(screenX, screenY);
    if (elementId) void navigate(`/o/${orgSlug}/m/${modelSlug}/e/${elementId}`);
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
    else if (e.key === '0') setTransform({ scale: 1, tx: 0, ty: 0 });
  }

  const hoveredSystem = hover ? systemsById.get(hover.elementId) : undefined;

  return (
    <div ref={wrapperRef} className={styles.wrapper} style={{ height: 520 }}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Landscape diagram: ${String(layout.nodes.length)} systems across ${String(layout.lanes.length)} lanes. Use the element page for an accessible, list-based view of any system shown here.`}
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
      {hoveredSystem && hover && (
        <div className={styles.tooltip} style={{ left: hover.screenX, top: hover.screenY }}>
          {hoveredSystem.name}
          {attributesRecord(hoveredSystem.attributes).isExternal === true ? ' (external)' : ''}
        </div>
      )}
    </div>
  );
}
