import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { ElementVersionDiff, RelationshipVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { DIFF_MARKER, diffBorderColour, edgeDiffState, polylineMidpoint } from '../components/DiffBadge/diffCanvas';
import { usesAi } from '../../engine/elementRead/aiAgent';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { lifecycleToneFor } from '../elements/lifecycleTone';
import { quantizeScale, wheelZoomFactor } from '../landscape/zoom';
import { NODE_WIDTH } from '../landscape/layout';
import {
  allTilesOf,
  BOUNDARY_MARGIN,
  computeContextDiagramLayout,
  edgeLabelsCollide,
  edgeNear,
  placeEdgeLabels,
  type ContextDiagramLayout,
  type ContextEdgeInput,
  type ContextNeighbourInput,
  type DiagramTile,
  type EdgeLabelPill,
  type Point,
} from './contextDiagramLayout';
import { edgeLabel, type ContextGroup } from './contextGrouping';
import { useRefitOnResize } from '../landscape/useRefitOnResize';
import styles from './ContextDiagramCanvas.module.css';
import { isSystemLikeType } from '../../contracts/elementKinds';

export interface ContextDiagramCanvasProps {
  group: ContextGroup;
  layoutWidthHint?: number;
  /** Tapping an already-focused system or container neighbour re-centres the diagram — V1's own wording, V3 extended to containers now that a container has a Context view of its own too. */
  neighbourContextHref: (elementId: UUID) => string;
  /** Every other click target once already focused (an actor neighbour) — an element page, the same "next best thing" `LandscapeCanvas.tsx`'s own `actorHref` already is for a node with no Context view of its own. The hub tile itself always uses this too — see `handlePointerUp`'s own comment for why the hub never goes through the focus step at all. */
  elementHref: (elementId: UUID) => string;
  /**
   * V2b: click-to-focus, the same two-step model `LandscapeCanvas.tsx`
   * already uses — a first click on a neighbour tile opens the shared
   * Inspector scoped to it (no navigation); a second click on the
   * already-focused tile navigates (`neighbourContextHref`/`elementHref`
   * above, unchanged). Never the hub tile itself: it already has a
   * permanent header describing it (`ContextView.tsx`'s own "Supports"/
   * "Owned by" lines), so focusing it in the Inspector too would just
   * duplicate that — the hub tile keeps navigating on a single click, same
   * as before this rollout.
   */
  focusedElementId: UUID | null;
  onFocusElement: (elementId: UUID) => void;
  onClearFocus: () => void;
  /**
   * UI-principles §6.2/§6.3 — present only when a change's Diff mode is on. Added things draw in the `--diff-added` colour with a "+", removed ones dashed in `--diff-removed` with a "−", changed ones `--diff-changed` with a "~"; everything unchanged recedes. Before this the Diff view of a Context page looked identical to To-be, so an integration a change adds was impossible to pick out.
   */
  diff?: VersionDiff | null | undefined;
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
  diffAdded: string;
  diffRemoved: string;
  diffChanged: string;
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
    diffAdded: v('--diff-added'),
    diffRemoved: v('--diff-removed'),
    diffChanged: v('--diff-changed'),
  };
}

/** V1's own "Tone: lifecycle ... only" — a tile's fill tint comes from its own recorded lifecycle status, the same `lifecycleToneFor` mapping `ElementHeader.tsx`'s own status chip already uses; nothing else (criticality, hosting model, exposure) is read here. V3: a container hub or neighbour now gets the same treatment a system already had — `ContainerAttributes` carries its own, uninherited `lifecycleStatus` (a module's own tone was already read this way when nested; a container is never nested any more, so this is the one place left it needs reading directly). An actor carries no `lifecycleStatus` of its own, so this naturally returns no tone for it — the same "silent when the fact doesn't apply" shape `landscapeTileColourFor` uses for its own colour-by modes. */
function toneColour(element: ElementsHeadRow, tokens: CanvasTokens): string | undefined {
  if (!isSystemLikeType(element.element_type)) return undefined;
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

/**
 * V1's own canvas renderer — the Context view's diagram, on the same
 * technology (`<canvas>` 2D, DOM only for the toolbar/tooltip) as
 * `LandscapeCanvas.tsx`, reusing its zoom/pan/fit shape verbatim. Narrower
 * in scope than that component (no diff highlighting, no colour-by beyond
 * the one lifecycle tone V1 asks for, no comment markers).
 *
 * Label routing rework (five-neighbour stress case, `fixtures/sapContext.ts`):
 * every edge is an orthogonal route from `contextDiagramLayout.ts` with its
 * own lane and attach points; its label is a pill on its own drop just
 * above the neighbour it leaves (`placeEdgeLabels`); when the audit
 * (`edgeLabelsCollide`) finds pills that would still stack, labels default
 * to hidden and the pointer reveals one edge's label at a time — the
 * "Labels" toolbar toggle overrides either way.
 *
 * V3 ("container context pages, platform context simplified to structure
 * only"): a platform-with-modules hub never reaches this component any
 * more — it renders `PlatformStructureView.tsx` instead, with no diagram at
 * all. Every hub this canvas ever draws now is a plain tile (a system, or
 * one container viewed on its own), so the module-tile drawing, "which
 * module?" marker and per-module tooltip this file used to carry are gone
 * along with `contextDiagramLayout.ts`'s own support for them.
 */
export function ContextDiagramCanvas({ group, layoutWidthHint, neighbourContextHref, elementHref, focusedElementId, onFocusElement, onClearFocus, diff = null }: ContextDiagramCanvasProps) {
  const diffByElementId = useMemo(() => new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []), [diff]);
  const diffByRelationshipId = useMemo(() => new Map<UUID, RelationshipVersionDiff>(diff?.relationships.map((r) => [r.relationshipId, r]) ?? []), [diff]);
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

  const elementsById = useMemo(() => {
    const map = new Map<UUID, ElementsHeadRow>([[group.hub.element_id, group.hub]]);
    for (const n of [...group.internal, ...group.external]) map.set(n.element.element_id, n.element);
    return map;
  }, [group]);

  // "Platform · Module" (moduleDisplayName, via `ContextGroup`'s own
  // `hubDisplayName`/`ContextNeighbour.displayName` — computed once in
  // `computeContextGroup`, not recomputed here) — every place this canvas
  // shows a tile's name (label, hover tooltip) reads from this map instead
  // of `element.name` directly, so a module of some other platform never
  // reads as a bare, ambiguous short name on the diagram either.
  const displayNameById = useMemo(() => {
    const map = new Map<UUID, string>([[group.hub.element_id, group.hubDisplayName]]);
    for (const n of [...group.internal, ...group.external]) map.set(n.element.element_id, n.displayName);
    return map;
  }, [group]);

  /** Every drawn edge, in the layout's own input shape — always neighbour ↔ hub now (V3 dropped the module endpoint entirely); the arrow belongs at the logical `to` side. */
  const edgeInputs = useMemo<ContextEdgeInput[]>(() => {
    const result: ContextEdgeInput[] = [];
    for (const neighbour of [...group.internal, ...group.external]) {
      for (const edge of neighbour.edges) {
        const fromIsHub = edge.from_element_id === group.hub.element_id;
        result.push({ id: edge.relationship_id, neighbourId: neighbour.element.element_id, arrowAtHub: !fromIsHub, label: edgeLabel(edge, group.hub.element_id) });
      }
    }
    return result;
  }, [group]);

  /** V2's own grouping input (module comment on `classifyNeighbourGroup`) — direction comes from `edgeInputs` above, `isActor`/`isExternal` from the element itself. */
  const neighbourInputs = useMemo<ContextNeighbourInput[]>(
    () => [...group.internal, ...group.external].map((n) => ({ id: n.element.element_id, isExternal: attributesRecord(n.element.attributes).isExternal === true, isActor: n.element.element_type === 'actor' })),
    [group],
  );

  const layout = useMemo<ContextDiagramLayout>(
    () => computeContextDiagramLayout(group.hub.element_id, neighbourInputs, layoutWidthHint, edgeInputs),
    [group.hub.element_id, neighbourInputs, layoutWidthHint, edgeInputs],
  );

  const fitToView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setTransform(computeFitTransform(layout.width, layout.height, wrapper.clientWidth, wrapper.clientHeight));
  }, [layout.width, layout.height]);

  useRefitOnResize(wrapperRef, () => transform, setTransform, (w, h) => computeFitTransform(layout.width, layout.height, w, h));

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

      // The dotted enterprise boundary — around the hub and internal neighbours only, drawn first so tiles/edges layer on top. V2: a bounding box now that neighbours surround the hub on four sides rather than sitting in one row below it; `null` when the hub has no internal neighbour at all.
      if (layout.boundary) {
        const b = layout.boundary;
        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        roundRectPath(ctx, b.left - BOUNDARY_MARGIN, b.top - BOUNDARY_MARGIN, b.right - b.left + BOUNDARY_MARGIN * 2, b.bottom - b.top + BOUNDARY_MARGIN * 2, 12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Every edge is an axis-aligned polyline from the layout — its own lane, its own attach points. The hovered edge draws last and heavier so it reads on top of its neighbours.
      const diffMarkers: { text: string; worldX: number; worldY: number; colour: string }[] = [];
      const drawEdge = (edge: (typeof layout.edges)[number], highlighted: boolean): void => {
        // Diff mode: an added/removed/changed connection takes its diff colour (removed also dashed), and what has not changed recedes so the change stands out.
        const edgeState = diff ? edgeDiffState(edge.relationshipIds, diffByRelationshipId) : 'unchanged';
        const diffColour = diff && edgeState !== 'unchanged' ? diffBorderColour(edgeState, tokens) : null;
        const lineColour = highlighted ? tokens.text : (diffColour ?? tokens.borderStrong);
        ctx.save();
        ctx.strokeStyle = lineColour;
        ctx.lineWidth = highlighted ? 2.5 : diffColour ? 2.5 : 1.5;
        ctx.globalAlpha = diff && edgeState === 'unchanged' && !highlighted ? 0.6 : 1;
        if (edgeState === 'removed') ctx.setLineDash([6, 4]);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        edge.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        if (diff && edgeState !== 'unchanged' && DIFF_MARKER[edgeState] !== '') {
          const mid = polylineMidpoint(edge.points);
          diffMarkers.push({ text: DIFF_MARKER[edgeState], worldX: mid.x, worldY: mid.y, colour: diffColour ?? tokens.text });
        }

        // An arrowhead at whichever end(s) carry one (UI-principles §9's
        // "target only" for a normal edge; a merged bidirectional pair,
        // V2's own rework item 3, gets one at both ends). A group's own
        // final segment can now run in any of the four axis-aligned
        // directions (left/right groups end horizontally, above/below
        // groups end vertically), so the angle comes from the actual
        // adjacent segment rather than being assumed vertical.
        const drawArrowhead = (target: Point, from: Point): void => {
          const angle = Math.atan2(target.y - from.y, target.x - from.x);
          ctx.save();
          ctx.translate(target.x, target.y);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-8, -4);
          ctx.lineTo(-8, 4);
          ctx.closePath();
          ctx.fillStyle = lineColour;
          ctx.globalAlpha = diff && edgeState === 'unchanged' && !highlighted ? 0.6 : 1;
          ctx.fill();
          ctx.restore();
        };
        const beforeLast = edge.points[edge.points.length - 2] ?? edge.neighbourAnchor;
        const afterFirst = edge.points[1] ?? edge.hubAnchor;
        if (edge.arrowAtHub) drawArrowhead(edge.hubAnchor, beforeLast);
        if (!edge.arrowAtHub || edge.arrowAtNeighbour) drawArrowhead(edge.neighbourAnchor, afterFirst);
      };
      for (const edge of layout.edges) if (edge.id !== hoveredEdgeId) drawEdge(edge, false);
      const hoveredEdge = layout.edges.find((e) => e.id === hoveredEdgeId);
      if (hoveredEdge) drawEdge(hoveredEdge, true);

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number; maxWidth: number; tileHeight: number; aiAgent: boolean }[] = [];

      const drawTile = (tile: DiagramTile, isHub: boolean): void => {
        const element = elementsById.get(tile.elementId);
        if (!element) return;
        const displayName = displayNameById.get(tile.elementId) ?? element.name;
        const external = attributesRecord(element.attributes).isExternal === true;
        const isHovered = hover?.label === displayName;
        // V2b: the focused neighbour reads the same as the hub itself
        // (thicker, full-strength border) — a real, visible "this is what
        // the Inspector is showing" cue, never colour-only (§6.3/§8.4/§8.7)
        // since the Inspector's own Selection heading names it too.
        const isFocused = tile.elementId === focusedElementId;

        ctx.save();
        roundRectPath(ctx, tile.x, tile.y, tile.w, tile.h, 8);
        const tone = toneColour(element, tokens);
        ctx.fillStyle = tone ? `color-mix(in srgb, ${tone} 16%, ${tokens.surfaceRaised})` : tokens.surfaceRaised;
        ctx.fill();
        const tileDiff = diff ? diffByElementId.get(tile.elementId) : undefined;
        const tileState = tileDiff?.state ?? 'unchanged';
        const tileDiffColour = diff && tileState !== 'unchanged' ? diffBorderColour(tileState, tokens) : null;
        ctx.strokeStyle = tileDiffColour ?? (isHub || isFocused ? tokens.text : isHovered ? tokens.borderStrong : tokens.border);
        ctx.lineWidth = tileDiffColour ? 3 : isHub || isFocused ? 2 : 1;
        if (external || tileState === 'removed') ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        if (diff && tileState !== 'unchanged' && DIFF_MARKER[tileState] !== '') {
          const text = tileState === 'changed' ? `${DIFF_MARKER[tileState]}${String(tileDiff?.changedAttributes.length ?? 0)}` : DIFF_MARKER[tileState];
          diffMarkers.push({ text, worldX: tile.x + tile.w - 14, worldY: tile.y + 12, colour: tileDiffColour ?? tokens.text });
        }

        if (showLabels) {
          const glyph = element.element_type === 'actor' ? elementTypeGlyph('actor', attributesRecord(element.attributes).subtype as ActorSubtype | undefined) : elementTypeGlyph(element.element_type);
          // system-only: the AI-agent mark is a setting of a whole system.
          nodeLabels.push({ glyph, name: displayName, worldX: tile.x, worldY: tile.y + tile.h / 2, maxWidth: tile.w - 30, tileHeight: tile.h, aiAgent: element.element_type === 'system' && usesAi(element) });
        }
      };

      drawTile(layout.hub, true);
      for (const tile of layout.neighbours) drawTile(tile, false);

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
        if (label.aiAgent) {
          // A plain outlined "AI" tag under the glyph, left of the name: no fill colour of its own, so it never competes with status or diff tints.
          const tagW = 18 * transform.scale;
          const tagH = 13 * transform.scale;
          const tagX = x + 6 * transform.scale;
          const tagY = y + (label.tileHeight / 2 - 4) * transform.scale - tagH;
          roundRectPath(ctx, tagX, tagY, tagW, tagH, 3 * transform.scale);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          ctx.strokeStyle = tokens.borderStrong;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = tokens.textMuted;
          ctx.font = `600 ${(9 * textScale).toFixed(2)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('AI', tagX + tagW / 2, tagY + tagH / 2 + 0.5);
          ctx.textAlign = 'left';
        }
      }

      // The state markers (§8.4: never colour alone) — "+" added, "−" removed, "~N" changed — on the changed edge's midpoint or the tile's top-right corner, in the same diff colour.
      ctx.font = `bold ${(14 * textScale).toFixed(2)}px sans-serif`;
      ctx.textAlign = 'center';
      for (const marker of diffMarkers) {
        const [x, y] = toScreen(marker.worldX, marker.worldY);
        ctx.fillStyle = marker.colour;
        ctx.fillText(marker.text, x, y);
      }
      ctx.textAlign = 'left';

      // Rework items 3–4: label pills, placed in world units by the pure layout module (widths measured at the current font and divided back to world), audited for collisions, then drawn — all of them when labels are visible, only the hovered edge's when they're hidden.
      // Measured once at the reference size (11px in world units), so the
      // collision audit below gives the same answer at every zoom. It used
      // to measure at the zoom-stepped screen font and divide by the exact
      // zoom: within one zoom step the font is rounded up or down, so the
      // same diagram's labels "collided" at one window width and not at a
      // slightly different one (a page scrollbar was enough to flip it).
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      const measureWorld = (text: string): number => ctx.measureText(text).width;
      const pills = placeEdgeLabels(layout.edges, measureWorld);
      // Drawn no larger than the exact zoom, so text never outgrows the pill it was measured for.
      const pillTextScale = Math.min(textScale, transform.scale);
      ctx.font = `${(11 * pillTextScale).toFixed(2)}px sans-serif`;
      const collide = edgeLabelsCollide(pills, allTilesOf(layout));
      if (collide !== labelsWouldCollide) setLabelsWouldCollide(collide);
      const labelsShown = showLabels && (labelMode === 'show' || (labelMode === 'auto' && !collide));
      const pillsToDraw: EdgeLabelPill[] = labelsShown ? pills : pills.filter((p) => p.edgeId === hoveredEdgeId);
      const hoveredLast = [...pillsToDraw.filter((p) => p.edgeId !== hoveredEdgeId), ...pillsToDraw.filter((p) => p.edgeId === hoveredEdgeId)];
      const edgeLabelLineHeight = 12 * pillTextScale;
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
      ctx.textAlign = 'left';
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [layout, elementsById, displayNameById, transform, hover, hoveredEdgeId, labelMode, labelsWouldCollide, zoomShowsText, focusedElementId, diff, diffByElementId, diffByRelationshipId]);

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
    if (tile) {
      const element = elementsById.get(tile.elementId);
      setHover(element ? { label: displayNameById.get(tile.elementId) ?? element.name, screenX, screenY } : null);
      setHoveredEdgeId(null);
      return;
    }
    // Rework item 4: pointer on an edge highlights it and, when labels are
    // hidden, reveals its verb — the on-canvas pill itself (`pillsToDraw`'s
    // own `edgeId === hoveredEdgeId` case below), not a second, redundant
    // DOM tooltip showing the identical text right next to it.
    const edgeId = edgeAt(screenX, screenY);
    setHoveredEdgeId(edgeId);
    setHover(null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;

    const tile = tileAt(screenX, screenY);
    if (!tile) {
      // Touch has no hover: a tap on an edge toggles that edge's label
      // (rework item 4's "show on hover/tap") — the on-canvas pill, not a
      // second DOM tooltip (`handlePointerMove`'s own comment).
      const edgeId = edgeAt(screenX, screenY);
      const next = edgeId && edgeId !== hoveredEdgeId ? edgeId : null;
      setHoveredEdgeId(next);
      setHover(null);
      // V2b: a background tap (not on a tile, not on an edge) clears the
      // current focus — same "empty canvas clears focus" convention
      // `LandscapeCanvas.tsx` already uses.
      if (!next && focusedElementId !== null) onClearFocus();
      return;
    }
    if (tile.elementId === group.hub.element_id) {
      void navigate(elementHref(tile.elementId));
      return;
    }
    // V2b: click-to-focus — the first tap on a neighbour opens the
    // Inspector without navigating; tapping the *already*-focused tile
    // again navigates, exactly `ContextDiagramCanvasProps`' own
    // `focusedElementId` doc comment.
    if (tile.elementId !== focusedElementId) {
      onFocusElement(tile.elementId);
      return;
    }
    const element = elementsById.get(tile.elementId);
    // V3: a container neighbour now has a Context view of its own too, the
    // same as a system — only an actor still has no context page to go to.
    if (isSystemLikeType(element?.element_type ?? '')) void navigate(neighbourContextHref(tile.elementId));
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
    // `wheelZoomFactor` (`landscape/zoom.ts`) scales the step by how much of
    // a single wheel "notch" this event's own deltaY represents — see its
    // own comment for the bug this fixes (a burst of small-delta events,
    // from a trackpad or a high-resolution mouse, used to each get the same
    // full step as one real notch and could compound to MIN/MAX_SCALE, and
    // therefore off-screen, in a fraction of a second) — `LandscapeCanvas.tsx`'s
    // own `handleWheel` fixed this first; this canvas had the identical bug.
    zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode), { x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>): void {
    if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === '0') fitToView();
    else if (e.key === 'l') setLabelMode(edgeLabelsVisible ? 'hide' : 'show');
    else if (e.key === 'Escape' && focusedElementId !== null) onClearFocus();
  }

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      data-scale={transform.scale}
      data-tx={transform.tx}
      data-ty={transform.ty}
      data-edge-labels={edgeLabelsVisible ? 'visible' : 'hidden'}
      data-edge-labels-collide={labelsWouldCollide ? 'true' : 'false'}
      data-focused-element-id={focusedElementId ?? ''}
      // Context layout v2, rework item 3: the number of *routed* edges — a
      // two-way neighbour's own opposing pair merges into one, so this is
      // lower than the raw relationship count whenever a bidirectional pair
      // exists. Canvas pixels aren't Playwright-inspectable (this
      // component's own module comment); this count is, and is the one
      // DOM-observable proof a merge actually happened rather than drawing
      // two separately routed lines.
      data-edge-count={layout.edges.length}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Context diagram: ${group.hubDisplayName} and ${String(group.internal.length + group.external.length)} connected systems, containers or people. Use the element page for an accessible, list-based view of any of these.`}
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
          aria-label="Show line labels"
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
