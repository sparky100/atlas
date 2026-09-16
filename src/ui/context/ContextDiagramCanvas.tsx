import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { quantizeScale } from '../landscape/zoom';
import { NODE_WIDTH } from '../landscape/layout';
import { allTilesOf, computeContextDiagramLayout, curveBetween, hubBottomAnchor, resolveEdgeLabelOverlaps, tileTopAnchor, type ContextDiagramLayout, type DiagramTile, type EdgeLabelPlacement } from './contextDiagramLayout';
import { edgeLabel, type ContextGroup } from './contextGrouping';
import styles from './ContextDiagramCanvas.module.css';

export interface ContextDiagramCanvasProps {
  group: ContextGroup;
  layoutWidthHint?: number;
  /** Tapping a system or container neighbour re-centres the diagram — V1's own wording, V3 extended to containers now that a container has a Context view of its own too. */
  neighbourContextHref: (elementId: UUID) => string;
  /** Every other click target (the hub tile itself, or an actor neighbour) — an element page, the same "next best thing" `LandscapeCanvas.tsx`'s own `actorHref` already is for a node with no Context view of its own. */
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

/** V1's own "Tone: lifecycle ... only" — a tile's fill tint comes from its own recorded lifecycle status, the same `lifecycleToneFor` mapping `ElementHeader.tsx`'s own status chip already uses; nothing else (criticality, hosting model, exposure) is read here. V3: a container hub or neighbour now gets the same treatment a system already had — `ContainerAttributes` carries its own, uninherited `lifecycleStatus` (a module's own tone was already read this way when nested; a container is never nested any more, so this is the one place left it needs reading directly). An actor carries no `lifecycleStatus` of its own, so this naturally returns no tone for it — the same "silent when the fact doesn't apply" shape `landscapeTileColourFor` uses for its own colour-by modes. */
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

/**
 * "Two-line wrap": greedily fills each line with as many whole words as fit
 * `maxWidth` (the current `ctx.font`'s own metrics), up to `maxLines`
 * lines; whatever's left over after the last allowed line is ellipsized
 * onto it via `truncate` above, rather than silently dropped. A node's own
 * name is narrow, fixed-width canvas text with no CSS wrapping to fall back
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
 * "Fit uses width up to 1.5×", capped so a tiny diagram in a very wide
 * window doesn't blow up absurdly — a tall result is scrolled/panned into
 * view via the existing drag/zoom controls, same as the landscape's own
 * canvas already relies on for a dense model.
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
 * Named by which side is the hub-side and which is the neighbour-side,
 * rather than by logical `from`/`to` — every edge in this diagram anchors
 * the same physical way regardless of its own direction (hub side at its
 * own tile's bottom edge, neighbour side at its own tile's top edge;
 * `curveBetween`'s own comment), so the drawing code needs "which is which
 * side," not "which is from/to." `arrowAtHub` alone still carries the
 * edge's real direction (the arrowhead is the only place it shows up
 * visually).
 */
interface DrawEdge {
  neighbourTile: DiagramTile;
  /** True when this edge's own `to_element_id` is the hub side (the arrowhead belongs there); false when it's the neighbour side. */
  arrowAtHub: boolean;
  label: string;
}

/**
 * The Context view's canvas renderer, on the same technology (`<canvas>`
 * 2D, DOM only for the toolbar/tooltip) as `LandscapeCanvas.tsx`, reusing
 * its zoom/pan/fit shape verbatim (there is no shared hook to import — that
 * component's own investigation note: the zoom/pan state lives inline
 * there too). Deliberately narrower in scope than that component: no diff
 * highlighting, no colour-by beyond the one lifecycle tone, no comment
 * markers, no obstacle-routed edges — a hub's own immediate neighbours are
 * always a small, bounded set, never landscape scale.
 *
 * V3 ("container context pages, platform context simplified to structure
 * only"): a platform-with-modules hub never reaches this component any
 * more — it renders `PlatformStructureView.tsx` instead, with no diagram at
 * all. Every hub this canvas ever draws now is a plain tile (a system, or
 * one container viewed on its own), so the module-tile nesting, "which
 * module?" fallback marker, and column-aligned neighbour stacking this
 * file used to carry are gone along with `contextDiagramLayout.ts`'s own
 * support for them.
 */
export function ContextDiagramCanvas({ group, layoutWidthHint, neighbourContextHref, elementHref }: ContextDiagramCanvasProps) {
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
        group.hub.element_id,
        group.internal.map((n) => n.element.element_id),
        group.external.map((n) => n.element.element_id),
        layoutWidthHint,
      ),
    [group, layoutWidthHint],
  );

  const tileByElementId = useMemo(() => new Map(allTilesOf(layout).map((t) => [t.elementId, t])), [layout]);

  const edges = useMemo<DrawEdge[]>(() => {
    const result: DrawEdge[] = [];
    for (const neighbour of [...group.internal, ...group.external]) {
      const neighbourTile = tileByElementId.get(neighbour.element.element_id);
      if (!neighbourTile) continue;
      for (const edge of neighbour.edges) {
        const fromIsHub = edge.from_element_id === group.hub.element_id;
        // The arrow belongs at the logical `to` side — `arrowAtHub` is true
        // exactly when the hub side is that `to` side, i.e. the edge does
        // *not* run hub → neighbour.
        result.push({ neighbourTile, arrowAtHub: !fromIsHub, label: edgeLabel(edge, group.hub.element_id) });
      }
    }
    return result;
  }, [group, tileByElementId]);

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
      for (const edge of edges) {
        // The hub side always anchors at the hub tile's own bottom edge,
        // the neighbour side at its own tile's top edge (`hubBottomAnchor`/
        // `tileTopAnchor`'s own comments) — every neighbour this diagram
        // places sits below the hub, so this is always "lower anchor =
        // neighbour, upper anchor = hub," never the other way round,
        // regardless of the edge's own logical direction.
        const hubAnchor = hubBottomAnchor(layout.hub);
        const neighbourAnchor = tileTopAnchor(edge.neighbourTile);

        // Orthogonal/curved edge routing, entering the hub from below and
        // leaving neighbours from above: a Bézier curve, vertical at both
        // ends, rather than a straight line.
        const curve = curveBetween(neighbourAnchor, hubAnchor);
        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(neighbourAnchor.x, neighbourAnchor.y);
        ctx.bezierCurveTo(curve.cp1.x, curve.cp1.y, curve.cp2.x, curve.cp2.y, hubAnchor.x, hubAnchor.y);
        ctx.stroke();
        ctx.restore();

        // "Label pill on the free segment, never over a tile": the curve's
        // own midpoint always falls in the open gutter between the two
        // rows (`curveBetween`'s own comment) — drawn as a filled pill in
        // the screen-space pass below, not here (needs the actual font
        // metrics to size itself).
        if (showLabels && edge.label.trim().length > 0) {
          // "Push toward the target": the same anchor the arrowhead below
          // points at — pushing toward the source instead would walk an
          // overlap-resolved label back over the tile its own edge just
          // left.
          edgeLabels.push({ text: edge.label, worldX: curve.mid.x, worldY: curve.mid.y, worldTargetY: edge.arrowAtHub ? hubAnchor.y : neighbourAnchor.y });
        }

        // One arrowhead, at the target only (UI-principles §9) — always
        // vertical (both anchors are a tile's own top/bottom edge), so no
        // angle computation is needed: `arrowAtHub` alone says whether it
        // points up into the hub or down into the neighbour.
        const targetAnchor = edge.arrowAtHub ? hubAnchor : neighbourAnchor;
        const arrowSign = edge.arrowAtHub ? -1 : 1; // up into the hub, or down into the neighbour
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
          nodeLabels.push({ glyph, name: element.name, worldX: tile.x, worldY: tile.y + tile.h / 2, maxWidth: tile.w - 30 });
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

      // Two-line wrap: a name that doesn't fit on one line wraps to a
      // second rather than truncating hard — `wrapLines` measures against
      // the exact font just set, so it's called here in the screen-space
      // pass, not while building `nodeLabels` above.
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

      // "Label pill on the free segment, never over a tile": a filled
      // rounded pill sized to the text, centred on the curve's own midpoint
      // (`curveBetween`'s own comment on why that point is always in the
      // clear gutter between rows). The vertical routing above means this
      // text no longer needs to follow a line's own angle — it's always
      // sitting on the open horizontal band between two rows, so plain
      // centred text reads cleanly without rotation.
      //
      // A hub can have enough neighbours that two edges' own labels land
      // close together in that same gutter — resolved here via
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

    const tile = tileAt(screenX, screenY);
    if (!tile) return;
    if (tile.elementId === group.hub.element_id) {
      void navigate(elementHref(tile.elementId));
      return;
    }
    const element = elementsById.get(tile.elementId);
    // V3: a container neighbour now has a Context view of its own too, the
    // same as a system — only an actor still has no context page to go to.
    if (element?.element_type === 'system' || element?.element_type === 'container') void navigate(neighbourContextHref(tile.elementId));
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
