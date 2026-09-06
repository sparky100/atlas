import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/elementTypeGlyph';
import { attributesRecord } from '../elements/attributesRecord';
import { NODE_HEIGHT, NODE_WIDTH, type LandscapeLayout } from './layout';
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

/**
 * The landscape's renderer (UI-principles §6.1/§8.6): Canvas 2D for
 * lanes/nodes/edges/labels, DOM only for the hover tooltip. Sprint U1 step
 * 4a — no Web Worker, no viewport culling or LOD thresholds, no diff
 * highlighting, no annotations; those are step 4b (performance) and later
 * steps (diff/annotations UI), not skipped, named.
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

      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      for (const lane of layout.lanes) {
        ctx.fillStyle = tokens.textMuted;
        ctx.fillText(lane.label.toUpperCase(), 4, lane.y + 8);
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lane.y + lane.height - 16);
        ctx.lineTo(layout.width, lane.y + lane.height - 16);
        ctx.stroke();
      }

      const positionById = new Map(layout.nodes.map((n) => [n.elementId, n]));
      ctx.strokeStyle = tokens.borderStrong;
      ctx.lineWidth = 1.5;
      for (const edge of edges) {
        const from = positionById.get(edge.from_element_id);
        const to = positionById.get(edge.to_element_id);
        if (!from || !to) continue;
        const fromCx = from.x + NODE_WIDTH / 2;
        const fromCy = from.y + NODE_HEIGHT / 2;
        const toCx = to.x + NODE_WIDTH / 2;
        const toCy = to.y + NODE_HEIGHT / 2;
        ctx.beginPath();
        ctx.moveTo(fromCx, fromCy);
        ctx.lineTo(toCx, toCy);
        ctx.stroke();
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

      for (const node of layout.nodes) {
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

        ctx.fillStyle = tokens.text;
        ctx.font = '14px sans-serif';
        const glyph = elementTypeGlyph('system');
        ctx.fillText(glyph, node.x + 10, node.y + NODE_HEIGHT / 2);
        ctx.font = '12px sans-serif';
        const label = truncate(ctx, system.name, NODE_WIDTH - 34);
        ctx.fillText(label, node.x + 30, node.y + NODE_HEIGHT / 2);
      }

      ctx.restore();
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
