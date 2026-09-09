import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { ElementVersionDiff, RelationshipVersionDiff, VersionDiff, VersionDiffState } from '../../engine/versionDiff';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { NODE_HEIGHT, NODE_WIDTH, type LandscapeLayout } from './layout';
import { quantizeScale } from './zoom';
import styles from './LandscapeCanvas.module.css';

const DIFF_MARKER: Record<VersionDiffState, string> = { unchanged: '', added: '+', removed: '−', changed: '~', moved: '⤴' };

export interface LandscapeCanvasProps {
  layout: LandscapeLayout;
  systemsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active; `null` for `main`/`tag` and for As-is/To-be, where there's nothing to highlight against. */
  diff?: VersionDiff | null;
  /** Where clicking a node navigates to — Sprint U2 step 3's zoom chain: a system's next level down is its Context view, not its element page directly (UI-principles §2.1's "semantic zoom", as a discrete link). Takes the clicked system's id. */
  nodeHref: (elementId: UUID) => string;
  /** Unresolved comment-thread count per system id (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s Canvas section) — `useUnresolvedCommentCounts`'s own batched RPC result. A system absent from the map has zero unresolved threads and paints no marker. */
  unresolvedCommentCounts?: ReadonlyMap<UUID, number> | undefined;
  /** Clicking a node's own comment marker (not the rest of the node, which still navigates via `nodeHref`) — opens the comments panel scoped to that system. */
  onCommentMarkerClick?: (elementId: UUID) => void;
  /** `c`/`n` (UI-principles §8.8) act on whichever node is currently hovered — the canvas has no persistent "selected node" of its own yet (only hover and click-to-navigate), so the hovered node is the nearest existing stand-in for "the focused row". `c` with nothing hovered is a no-op the caller may still handle (e.g. closing an already-open panel). */
  onToggleCommentsPanel?: (elementId: UUID | null) => void;
  onNewCommentShortcut?: (elementId: UUID) => void;
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
  diffNone: string;
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
    accent: v('--accent'),
    diffNone: v('--diff-none'),
    diffAdded: v('--diff-added'),
    diffRemoved: v('--diff-removed'),
    diffChanged: v('--diff-changed'),
  };
}

/** The node's own diff border colour (§6.3's colour token column) — `null` for `unchanged`, which uses the same neutral border every non-diff render already draws. */
function diffBorderColour(state: VersionDiffState, tokens: CanvasTokens): string | null {
  if (state === 'added') return tokens.diffAdded;
  if (state === 'removed') return tokens.diffRemoved;
  if (state === 'changed' || state === 'moved') return tokens.diffChanged;
  return null;
}

/** §6.3's "hatched, 50% opacity" removed-node fill — a small diagonal-stripe pattern, tiled. */
function createHatchPattern(ctx: CanvasRenderingContext2D, colour: string): CanvasPattern | null {
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return null;
  tileCtx.strokeStyle = colour;
  tileCtx.globalAlpha = 0.5;
  tileCtx.lineWidth = 2;
  tileCtx.beginPath();
  tileCtx.moveTo(0, 8);
  tileCtx.lineTo(8, 0);
  tileCtx.stroke();
  return ctx.createPattern(tile, 'repeat');
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
 * view of any diagram" — clicking a node still navigates somewhere
 * accessible, just to its Context view (`nodeHref`) rather than its
 * element page directly, since Sprint U2 step 3's zoom chain makes Context
 * the landscape's next level down (UI-principles §2.1); the element page
 * itself is one link away from there. `+`/`-`/`0` (§8.8's canvas key
 * table) zoom/fit, which this does implement.
 *
 * Diff highlighting (Sprint C1, §6.3): `diff`, when given, is looked up per
 * node/edge id for its added/removed/changed/moved/unchanged state — the
 * colour token, marker glyph and border style all come from that one state,
 * together, never colour alone (§6.3's own rule, checked here the same way
 * `DiffBadge` already checks it for the list-based version diff). A `moved`
 * system (parent changed) draws the same as `changed` — systems have no
 * meaningful landscape "parent" to draw a ghost against (their only
 * position is a swim lane, not a nested frame), so the `⤴` marker still
 * fires but §6.3's "ghost at the old position" doesn't apply here the way
 * it would on a nested view.
 */
const COMMENT_MARKER_WIDTH = 18;
const COMMENT_MARKER_HEIGHT = 16;
const COMMENT_MARKER_INSET = 4;

export function LandscapeCanvas({ layout, systemsById, edges, diff = null, nodeHref, unresolvedCommentCounts, onCommentMarkerClick, onToggleCommentsPanel, onNewCommentShortcut }: LandscapeCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);

  const diffByElementId = useMemo(() => new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []), [diff]);
  const diffByRelationshipId = useMemo(() => new Map<UUID, RelationshipVersionDiff>(diff?.relationships.map((r) => [r.relationshipId, r]) ?? []), [diff]);
  // B4's reference chips, grouped by which lane shows them — a lane can
  // reference more than one system (or the same system more than once,
  // never expected but harmless either way).
  const referenceMarkersByLane = useMemo(() => {
    const map = new Map<string, UUID[]>();
    for (const marker of layout.referenceMarkers) {
      const list = map.get(marker.laneKey) ?? [];
      list.push(marker.elementId);
      map.set(marker.laneKey, list);
    }
    return map;
  }, [layout.referenceMarkers]);

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

  /** The comment marker's own hit region — bottom-right, only for a node with at least one unresolved thread (the only state this sprint draws — see the marker's own drawing comment below). Checked before `nodeAt` in the click handler so a marker click opens the panel instead of navigating. */
  const commentMarkerAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      if (!unresolvedCommentCounts || unresolvedCommentCounts.size === 0) return null;
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const node of layout.nodes) {
        const count = unresolvedCommentCounts.get(node.elementId);
        if (!count) continue;
        const markerLeft = node.x + NODE_WIDTH - COMMENT_MARKER_INSET - COMMENT_MARKER_WIDTH;
        const markerTop = node.y + NODE_HEIGHT - COMMENT_MARKER_INSET - COMMENT_MARKER_HEIGHT;
        if (worldX >= markerLeft && worldX <= markerLeft + COMMENT_MARKER_WIDTH && worldY >= markerTop && worldY <= markerTop + COMMENT_MARKER_HEIGHT) {
          return node.elementId;
        }
      }
      return null;
    },
    [layout, transform, unresolvedCommentCounts],
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
        // B4's "other lanes show a linked reference chip, never a
        // duplicate tile": appended to the lane's own label rather than a
        // second drawn shape — the real, clickable tile is one click away
        // (§8.7: the element page/relationships list are this diagram's
        // accessible view regardless), this is only a visual pointer to
        // where a referenced system actually lives.
        const referencedNames = referenceMarkersByLane
          .get(lane.key)
          ?.map((elementId) => systemsById.get(elementId)?.name)
          .filter((name): name is string => name !== undefined);
        const referenceSuffix = referencedNames && referencedNames.length > 0 ? `  ⇢ ${referencedNames.join(', ')}` : '';
        laneLabels.push({ text: lane.label.toUpperCase() + referenceSuffix, worldX: 4, worldY: lane.y + 8 });
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lane.y + lane.height - 16);
        ctx.lineTo(layout.width, lane.y + lane.height - 16);
        ctx.stroke();
      }

      const edgeMarkers: { text: string; worldX: number; worldY: number; colour: string }[] = [];
      if (edgeScreenWidth >= 0.25) {
        const positionById = new Map(layout.nodes.map((n) => [n.elementId, n]));
        const simplified = edgeScreenWidth < 0.5;
        for (const edge of edges) {
          const from = positionById.get(edge.from_element_id);
          const to = positionById.get(edge.to_element_id);
          if (!from || !to) continue;
          const left = Math.min(from.x, to.x);
          const top = Math.min(from.y, to.y);
          if (!rectIntersects(visible, left, top, Math.abs(from.x - to.x) + NODE_WIDTH, Math.abs(from.y - to.y) + NODE_HEIGHT)) continue;

          const edgeDiff = diffByRelationshipId.get(edge.relationship_id);
          const edgeState = edgeDiff?.state ?? 'unchanged';
          const diffColour = diff && edgeState !== 'unchanged' ? diffBorderColour(edgeState, tokens) : null;
          ctx.save();
          ctx.strokeStyle = diffColour ?? tokens.borderStrong;
          ctx.lineWidth = simplified ? 1 / transform.scale : 1.5;
          ctx.globalAlpha = diff && edgeState === 'unchanged' ? 0.6 : 1;
          if (edgeState === 'removed') ctx.setLineDash([6, 4]);

          const fromCx = from.x + NODE_WIDTH / 2;
          const fromCy = from.y + NODE_HEIGHT / 2;
          const toCx = to.x + NODE_WIDTH / 2;
          const toCy = to.y + NODE_HEIGHT / 2;
          ctx.beginPath();
          ctx.moveTo(fromCx, fromCy);
          ctx.lineTo(toCx, toCy);
          ctx.stroke();
          ctx.setLineDash([]);

          if (diff && (edgeState === 'added' || edgeState === 'changed') && !simplified) {
            edgeMarkers.push({ text: edgeState === 'added' ? '+' : '~', worldX: (fromCx + toCx) / 2, worldY: (fromCy + toCy) / 2, colour: diffColour ?? tokens.text });
          }

          // "Aggregated": below the 0.5px tier, a plain hairline with no
          // arrowhead stands in for what would otherwise be a dense tangle
          // of individually-indistinguishable direction markers.
          if (simplified) {
            ctx.restore();
            continue;
          }
          // One arrowhead, direction-only semantics (UI-principles §9) —
          // never a per-relationship-type marker style.
          const angle = Math.atan2(toCy - fromCy, toCx - fromCx);
          const arrowX = toCx - Math.cos(angle) * (NODE_WIDTH / 2);
          const arrowY = toCy - Math.sin(angle) * (NODE_HEIGHT / 2);
          ctx.translate(arrowX, arrowY);
          ctx.rotate(angle);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-8, -4);
          ctx.lineTo(-8, 4);
          ctx.closePath();
          ctx.fillStyle = diffColour ?? tokens.borderStrong;
          ctx.fill();
          ctx.restore();
        }
      }

      const nodeLabels: { glyph: string; name: string; worldX: number; worldY: number; truncateToNarrow: boolean }[] = [];
      const diffMarkers: { text: string; worldX: number; worldY: number; colour: string }[] = [];
      // B4's "no primary -> most recently added decides, with a '+N' chip
      // listing the rest" — top-right corner (diff markers already own
      // top-left), a neutral tone rather than any `--diff-*` token since
      // this isn't a diff state.
      const extraLaneMarkers: { text: string; worldX: number; worldY: number; colour: string }[] = [];
      // Sprint M1b, bottom-right (UI-principles §6.1's corner-assignment
      // rule — "+N" keeps top-right, this is the one corner nothing else
      // claims). Always drawn, at every zoom, unlike `showLabels`-gated
      // node labels: "a count nobody can see is a count that does not
      // exist" (`docs/HANDOFF-M1b-comments.md`'s Canvas section). Only the
      // unresolved (ink) state is drawn this sprint — the "all resolved,
      // hollow" state needs a way to tell "zero unresolved" apart from "no
      // comments at all", which `atlas.unresolved_comment_counts` doesn't
      // return (an anchor with zero unresolved threads is simply absent
      // either way); a follow-up backend addition, tracked in
      // `docs/SPEC-data-model.md` §11, not faked here.
      const commentMarkers: { elementId: UUID; count: number; worldX: number; worldY: number }[] = [];
      for (const node of layout.nodes) {
        if (!rectIntersects(visible, node.x, node.y, NODE_WIDTH, NODE_HEIGHT)) continue;
        const system = systemsById.get(node.elementId);
        if (!system) continue;
        const external = attributesRecord(system.attributes).isExternal === true;
        const isHovered = hover?.elementId === node.elementId;
        const nodeDiff = diffByElementId.get(node.elementId);
        const nodeState = nodeDiff?.state ?? 'unchanged';
        const diffColour = diff ? diffBorderColour(nodeState, tokens) : null;

        ctx.save();
        ctx.globalAlpha = diff && nodeState === 'unchanged' ? 0.6 : 1;
        roundRectPath(ctx, node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8);
        if (diff && nodeState === 'removed') {
          const pattern = createHatchPattern(ctx, tokens.diffRemoved);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          if (pattern) {
            roundRectPath(ctx, node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8);
            ctx.fillStyle = pattern;
            ctx.fill();
          }
        } else if (diff && diffColour) {
          ctx.fillStyle = `color-mix(in srgb, ${diffColour} 12%, ${tokens.surfaceRaised})`;
          ctx.fill();
        } else {
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
        }
        ctx.strokeStyle = diffColour ?? (isHovered ? tokens.accent : tokens.borderStrong);
        ctx.lineWidth = diffColour ? 2 : isHovered ? 2 : 1;
        if (nodeState === 'removed' || (external && !diffColour)) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        const unresolvedCount = unresolvedCommentCounts?.get(node.elementId) ?? 0;
        if (showLabels) nodeLabels.push({ glyph: elementTypeGlyph('system'), name: system.name, worldX: node.x, worldY: node.y, truncateToNarrow: unresolvedCount > 0 });
        if (diff && DIFF_MARKER[nodeState] !== '') {
          const label = nodeState === 'changed' ? `${DIFF_MARKER[nodeState]}${String(nodeDiff?.changedAttributes.length ?? 0)}` : DIFF_MARKER[nodeState];
          diffMarkers.push({ text: label, worldX: node.x + 4, worldY: node.y + 4, colour: diffColour ?? tokens.text });
        }
        if (node.extraLaneCount !== undefined) {
          extraLaneMarkers.push({ text: `+${String(node.extraLaneCount)}`, worldX: node.x + NODE_WIDTH - 4, worldY: node.y + 4, colour: tokens.textMuted });
        }
        if (unresolvedCount > 0) {
          commentMarkers.push({ elementId: node.elementId, count: unresolvedCount, worldX: node.x + NODE_WIDTH - COMMENT_MARKER_INSET, worldY: node.y + NODE_HEIGHT - COMMENT_MARKER_INSET });
        }
      }

      ctx.restore();

      // Text, in a second pass, entirely in screen space (dpr scale only —
      // not `transform`): quantised zoom (zoom.ts) means text should hold a
      // fixed on-screen size within a zoom step, not scale continuously
      // with the gesture the way node geometry does, so it can't share the
      // world-transformed pass above.
      if (laneLabels.length > 0 || nodeLabels.length > 0 || diffMarkers.length > 0 || edgeMarkers.length > 0 || extraLaneMarkers.length > 0 || commentMarkers.length > 0) {
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
          // A node carrying a comment marker reserves the marker's own
          // width (4px inset + 18px box + 4px gap = 26px) so the name
          // never overlaps it (`docs/HANDOFF-M1b-comments.md`'s Canvas
          // section: "truncate to 100px instead").
          const maxWidth = (label.truncateToNarrow ? NODE_WIDTH - 34 - 26 : NODE_WIDTH - 34) * textScale;
          const truncated = truncate(ctx, label.name, maxWidth);
          ctx.fillText(truncated, x + 30 * textScale, y + screenNodeHeight / 2);
        }

        // §6.3's "+"/"−"/"~N"/"⤴" badges — a small filled circle behind the
        // glyph so it reads against any node/edge colour underneath, node
        // markers top-left of the node, edge markers at the edge's midpoint.
        ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
        ctx.textAlign = 'center';
        for (const marker of [...diffMarkers, ...edgeMarkers, ...extraLaneMarkers]) {
          const [x, y] = toScreen(marker.worldX, marker.worldY);
          ctx.beginPath();
          ctx.arc(x, y, 8 * textScale, 0, Math.PI * 2);
          ctx.fillStyle = marker.colour;
          ctx.fill();
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fillText(marker.text, x, y + 1);
        }

        // Sprint M1b's own comment marker (see `commentMarkers`'s own
        // comment above) — a rounded-rect "ink plate", not the circular
        // shape the badges above use, so its 2-digit count has somewhere
        // to sit: 18×16, 2px radius, bottom-right inset.
        for (const marker of commentMarkers) {
          const [right, bottom] = toScreen(marker.worldX, marker.worldY);
          const w = COMMENT_MARKER_WIDTH * textScale;
          const h = COMMENT_MARKER_HEIGHT * textScale;
          const left = right - w;
          const top = bottom - h;
          roundRectPath(ctx, left, top, w, h, 2 * textScale);
          ctx.fillStyle = tokens.text;
          ctx.fill();
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fillText(String(marker.count), left + w / 2, top + h / 2 + 1);
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
  }, [layout, edges, systemsById, diff, diffByElementId, diffByRelationshipId, referenceMarkersByLane, transform, hover, unresolvedCommentCounts]);

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
    const markerElementId = commentMarkerAt(screenX, screenY);
    if (markerElementId) {
      onCommentMarkerClick?.(markerElementId);
      return;
    }
    const elementId = nodeAt(screenX, screenY);
    if (elementId) void navigate(nodeHref(elementId));
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
    // §8.8's global `c`/`n` — see this component's own `onToggleCommentsPanel`/`onNewCommentShortcut` prop comments for why the hovered node stands in for "the focused row" here.
    else if (e.key === 'c') onToggleCommentsPanel?.(hover?.elementId ?? null);
    else if (e.key === 'n' && hover) onNewCommentShortcut?.(hover.elementId);
  }

  const hoveredSystem = hover ? systemsById.get(hover.elementId) : undefined;
  // §6.3: "Hover on any marker shows the changed attributes" — base -> new isn't shown here (the canvas has no per-field value, only the diff's element-grain summary); the element page's own history is where that detail lives.
  const hoveredDiff = diff && hover ? diffByElementId.get(hover.elementId) : undefined;

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
          {hoveredDiff && hoveredDiff.state !== 'unchanged' && hoveredDiff.changedAttributes.length > 0 && ` — changed: ${hoveredDiff.changedAttributes.join(', ')}`}
        </div>
      )}
    </div>
  );
}
