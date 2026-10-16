import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ActorSubtype, ElementType } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import type { LandscapeColourByMode } from '../../contracts/userPreferences';
import type { ChipTone } from '../components/Chip/Chip';
import type { ElementVersionDiff, RelationshipVersionDiff, VersionDiff } from '../../engine/versionDiff';
import { elementTypeGlyph } from '../components/ElementTypeGlyph/glyph';
import { attributesRecord } from '../elements/attributesRecord';
import { isIntegrationPlatform } from '../elements/systemKind';
import { BOUNDARY_MARGIN, computeLandscapeChannels, laneAt, laneLabelLeftInset, NODE_HEIGHT, NODE_WIDTH, REFERENCE_CHIP_HEIGHT, REFERENCE_CHIP_WIDTH, routeLandscapeEdge, viaPositionFor, type LandscapeLayout, type LandscapeNodePosition } from './layout';
import { landscapeTileColourFor } from './landscapeColour';
import { quantizeScale, wheelZoomFactor } from './zoom';
import { DIFF_MARKER, diffBorderColour, polylineMidpoint } from '../components/DiffBadge/diffCanvas';
import styles from './LandscapeCanvas.module.css';


export interface LandscapeCanvasProps {
  layout: LandscapeLayout;
  systemsById: Map<UUID, ElementsHeadRow>;
  /** Landscape canvas, structural (item 3) — every actor drawn above the top band. */
  actorsById: Map<UUID, ElementsHeadRow>;
  edges: RelationshipsHeadRow[];
  /** UI-principles §6.2/§6.3 — present only when a branch's Diff mode is active; `null` for `main`/`tag` and for As-is/To-be, where there's nothing to highlight against. */
  diff?: VersionDiff | null;
  /** Where clicking a system node navigates to — Sprint U2 step 3's zoom chain: a system's next level down is its Context view, not its element page directly (UI-principles §2.1's "semantic zoom", as a discrete link). Takes the clicked system's id. */
  nodeHref: (elementId: UUID) => string;
  /** Where clicking an actor node navigates to — an actor has no Context view of its own (the zoom chain is system-specific), so this goes straight to the actor's own element page. */
  actorHref: (elementId: UUID) => string;
  /** Item 11: where a link in the "+N other capabilities" popover goes — a lane's own `key` (a level-1 capability's element id, for every lane but `$external`/`$unassigned`, neither of which a node's `extraLaneCount`/`referenceMarkers` ever point at — see `layout.ts`'s own `placementFor`) is the id this takes. */
  capabilityHref: (capabilityId: UUID) => string;
  /**
   * Thread counts per system id (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s
   * Canvas section; M1 close-out item 1 extends it to `{ open, total }`) —
   * `useThreadCounts`'s own batched RPC result. A system absent from the map
   * entirely paints no marker at all; one present with `open > 0` paints the
   * ink marker, and one with `total > 0 && open === 0` (every thread
   * resolved) paints the hollow marker instead. Actors carry no comment
   * markers this sprint.
   */
  threadCounts?: ReadonlyMap<UUID, { open: number; total: number }> | undefined;
  /** Clicking a node's own comment marker (not the rest of the node, which still navigates via `nodeHref`) — opens the comments panel scoped to that system. */
  onCommentMarkerClick?: (elementId: UUID) => void;
  /** `c`/`n` (UI-principles §8.8) act on whichever node is currently hovered — the canvas has no persistent "selected node" of its own yet (only hover and click-to-navigate), so the hovered node is the nearest existing stand-in for "the focused row". `c` with nothing hovered is a no-op the caller may still handle (e.g. closing an already-open panel). */
  onToggleCommentsPanel?: (elementId: UUID | null) => void;
  onNewCommentShortcut?: (elementId: UUID) => void;
  /** §8.8's canvas key table: `f` — "Filter chips" is a real binding as of V2 (it was aspirational before). The canvas has no filter UI of its own (`LandscapeFilterBar.tsx` is a DOM sibling on `LandscapePage.tsx`), so this just asks the caller to open it. */
  onOpenFilterBar?: () => void;
  /** M1 close-out item 1: "the per-session 'comments on this view' filter" — every node with no thread at all (`threadCounts` absent or `total === 0`) recedes to a low, diff-style alpha instead of being removed from the layout outright (removing nodes would change lane placement and edge routing for everything else on screen, which this is a read-only lens over, not a re-query). `false`/omitted draws every node at full opacity, same as before this item. */
  commentsOnlyFilter?: boolean | undefined;
  /**
   * Prompt 7k item 1: the landscape's own colour-by mode. Applied only to
   * the plain (no active diff) fill branch of `drawNode` — never mixed
   * with an active diff-state tint, per UI-principles §8.4's "status and
   * diff must not be read across". `undefined`/`'none'` draws every tile
   * with the flat neutral fill this canvas has always used.
   */
  colourBy?: LandscapeColourByMode | undefined;
  /**
   * Prompt 7k item 4: "route via platforms" — off (the default, direct
   * edges) draws every `uses`/`flows_to` edge straight between its two
   * real endpoints, ignoring `via` entirely; on, an edge carrying `via`
   * draws as two legs through that platform's own node instead. Plain,
   * unpersisted view state (`LandscapePage.tsx`'s own `useState`) — never
   * a stored preference, keeping this item's migration footprint at zero.
   */
  routeViaPlatforms?: boolean | undefined;
  /**
   * V2 "landscape focus and filters": the currently-focused system/actor,
   * if any — `null`/`undefined` means no focus is active (every node full
   * opacity, every `uses`/`flows_to` edge subject to `showConnections`
   * alone). While focused, every *other* node fades to 20% opacity
   * (`focusAlpha` in `drawNode`) and only this element's own edges draw
   * (`visibleEdges`), regardless of `showConnections`.
   */
  focusedElementId?: UUID | null | undefined;
  /**
   * "Find on this landscape" (`LandscapeFind.tsx`): bring this tile to the centre of the view, zoomed to at least 100%. A new object each time (not just a new id), so finding the same tile again after panning away re-centres it. Pure view state like the pan/zoom itself — never persisted.
   */
  centreOn?: { elementId: UUID } | null | undefined;
  /** A different tile was clicked while nothing (or someone else) was focused — see `handlePointerUp`'s own click-focus-vs-navigate precedence comment for exactly when this fires instead of a real navigation. */
  onFocusElement?: (elementId: UUID) => void;
  /** Escape, or a click on empty canvas background — decision 2's own "background click clears focus, same as Escape." */
  onClearFocus?: () => void;
  /**
   * V2: "edges hidden by default; 'Show connections' toggle" — off (the
   * default) draws no `uses`/`flows_to` edge at all while nothing is
   * focused; on, draws every one, exactly like this canvas always used to.
   * Meaningless while a focus is active (that always shows the focused
   * element's own edges regardless) — see `visibleEdges`'s own comment.
   */
  showConnections?: boolean | undefined;
}

interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

interface HoverState {
  elementId: UUID;
  elementType: ElementType;
  screenX: number;
  screenY: number;
}

/** Landscape canvas, structural (item 1): "clamped 0.25×–4×." */
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const CLICK_DRAG_THRESHOLD_PX = 4;
/** Fit-to-view leaves this much breathing room around the diagram's own bounds rather than touching the wrapper's edges exactly. */
const FIT_MARGIN_PX = 24;

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
  /** Prompt 7k item 1's colour-by tint — the same `--status-*` tokens `Chip.module.css` already maps `ChipTone` onto, read here as resolved values for the same `var()`-doesn't-work-in-`fillStyle` reason as every other token in this interface. */
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
    accent: v('--accent'),
    diffNone: v('--diff-none'),
    diffAdded: v('--diff-added'),
    diffRemoved: v('--diff-removed'),
    diffChanged: v('--diff-changed'),
    statusOk: v('--status-ok'),
    statusWarn: v('--status-warn'),
    statusDanger: v('--status-danger'),
    statusInfo: v('--status-info'),
    statusNeutral: v('--status-neutral'),
  };
}

/** `ChipTone` → the matching resolved `--status-*` token — the canvas's own version of `Chip.module.css`'s `styles[tone]` class lookup, since a 2D context can't use CSS classes. */
function statusColourFor(tone: ChipTone, tokens: CanvasTokens): string {
  switch (tone) {
    case 'ok':
      return tokens.statusOk;
    case 'warn':
      return tokens.statusWarn;
    case 'danger':
      return tokens.statusDanger;
    case 'info':
      return tokens.statusInfo;
    case 'neutral':
      return tokens.statusNeutral;
  }
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

/** Fit-to-view (item 1): the scale/offset pair that fits the diagram's own world bounds inside a `displayWidth`×`displayHeight` viewport, centred, clamped to `[MIN_SCALE, MAX_SCALE]` — never past `1` even when the diagram is small enough to zoom in past it, since "fit" means "see the whole thing," not "fill the screen." */
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

const COMMENT_MARKER_WIDTH = 18;
const COMMENT_MARKER_HEIGHT = 16;
const COMMENT_MARKER_INSET = 4;
/** Item 11's "+N" marker hit region — a world-space radius around its drawn centre, generous relative to the ~8px-radius circle drawn at scale 1. */
const EXTRA_LANE_MARKER_HIT_RADIUS = 12;

/**
 * The landscape's renderer (UI-principles §6.1/§8.6): Canvas 2D for
 * lanes/nodes/edges/labels, DOM only for the hover tooltip and the zoom
 * toolbar. Layout itself runs in a Web Worker (layoutWorkerClient.ts); this
 * component's own §8.6 work is viewport culling (a node/edge outside the
 * visible rect, +20% margin, is skipped entirely — no path built, no fill,
 * no stroke), quantised-zoom text sizing (zoom.ts — 8 discrete steps, not a
 * continuous scale, so text doesn't visibly jitter during a smooth zoom
 * gesture), and the label/edge LOD thresholds below. Diff highlighting and
 * annotations are later steps, not skipped, named.
 *
 * Landscape canvas, structural (item 1): wheel zooms about the cursor
 * (unchanged), clamped to `[MIN_SCALE, MAX_SCALE]` = 0.25×–4×; the diagram
 * fits to view on first draw and whenever `layout` changes identity (every
 * load recomputes a fresh layout now — Sprint U4-2b item 6 removed the old
 * "same picture until Reset layout" persistence, see `useLandscape.ts`'s
 * own comment), via `computeFitTransform`. `+`/`−`/Fit are now real on-canvas buttons in
 * the top-right corner (`styles.toolbar`) as well as the existing `+`/`-`/
 * `0` keyboard shortcuts (§8.8's canvas key table) — `0` now fits rather
 * than resetting to an arbitrary identity transform. `data-scale`/
 * `data-tx`/`data-ty` on the wrapper expose the live transform for
 * Playwright to assert against without reaching into component state.
 *
 * Full keyboard node-by-node traversal is not built here: §8.7 is explicit
 * that "the element page and the relationships list *are* the accessible
 * view of any diagram" — clicking a node still navigates somewhere
 * accessible, just to its Context view (`nodeHref`) rather than its
 * element page directly for a system, since Sprint U2 step 3's zoom chain
 * makes Context the landscape's next level down (UI-principles §2.1); an
 * actor (item 3) has no Context view of its own, so `actorHref` goes
 * straight to its element page.
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
 *
 * Comments (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s Canvas section):
 * a node with at least one unresolved comment thread draws a small
 * bottom-right "ink plate" (`commentMarkers` below) — the one corner
 * nothing else claims (`+N` keeps top-right) — clicking it opens the
 * comments panel instead of navigating; `c`/`n` act on whichever node is
 * currently hovered. Actors carry no comment markers this sprint (`layout.
 * actorNodes` never contributes to `commentMarkers`).
 */
export function LandscapeCanvas({
  layout,
  systemsById,
  actorsById,
  edges,
  diff = null,
  nodeHref,
  actorHref,
  capabilityHref,
  threadCounts,
  onCommentMarkerClick,
  onToggleCommentsPanel,
  onNewCommentShortcut,
  onOpenFilterBar,
  commentsOnlyFilter = false,
  colourBy = 'none',
  routeViaPlatforms = false,
  focusedElementId = null,
  centreOn = null,
  onFocusElement,
  onClearFocus,
  showConnections = false,
}: LandscapeCanvasProps) {
  const navigate = useNavigate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<Transform>({ scale: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  // Item 11: which node's "+N" popover is open, if any — stays open across
  // hover changes (unlike `.tooltip`) until dismissed; see this state's own
  // render-site comment for the dismiss paths.
  const [extraLanesPopover, setExtraLanesPopover] = useState<{ elementId: UUID; screenX: number; screenY: number } | null>(null);
  // Secondary-supporter wording: the reference chip's own tooltip/tap state
  // — a plain hover on desktop (cleared the moment the pointer leaves it,
  // same as `hover`'s own node tooltip), or a tap-to-toggle on touch, which
  // has no hover at all (same dual mouse/touch handling `extraLanesPopover`
  // above already needs, for the identical reason).
  const [hoverReference, setHoverReference] = useState<{ elementId: UUID; screenX: number; screenY: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startTransform: Transform; moved: boolean } | null>(null);

  const diffByElementId = useMemo(() => new Map<UUID, ElementVersionDiff>(diff?.elements.map((e) => [e.elementId, e]) ?? []), [diff]);
  const diffByRelationshipId = useMemo(() => new Map<UUID, RelationshipVersionDiff>(diff?.relationships.map((r) => [r.relationshipId, r]) ?? []), [diff]);

  // Integration platform context prompt: "with 'Route via platforms' on, a
  // focused integration platform highlights every via-flow through it" —
  // such a flow's own endpoints are the source/target, never the platform
  // (`via` names it as a third party, `useElementContext.ts`'s own
  // `IntegrationPlatformContextData` doc comment), so it would otherwise
  // never match the ordinary "touches the focused element" test below.
  const focusedSystem = focusedElementId != null ? systemsById.get(focusedElementId) : undefined;
  const focusedIsIntegrationPlatform = routeViaPlatforms && focusedSystem !== undefined && isIntegrationPlatform(focusedSystem);
  const isViaFlowThroughFocus = useCallback((edge: RelationshipsHeadRow): boolean => focusedIsIntegrationPlatform && attributesRecord(edge.attributes).via === focusedElementId, [focusedIsIntegrationPlatform, focusedElementId]);

  // V2 "landscape focus and filters": "edges hidden by default; 'Show
  // connections' toggle" — off (and no focus active) means no edge draws
  // at all. Focus overrides `showConnections` entirely rather than
  // combining with it: the whole point of focus is "show me this one
  // subject's own connections regardless of the global toggle."
  const visibleEdges = useMemo(() => {
    if (focusedElementId != null) return edges.filter((e) => e.from_element_id === focusedElementId || e.to_element_id === focusedElementId || isViaFlowThroughFocus(e));
    return showConnections ? edges : [];
  }, [edges, focusedElementId, showConnections, isViaFlowThroughFocus]);

  // V2: every element one `uses`/`flows_to` hop from the focused element,
  // either direction — computed off the real edge graph, never the routed
  // (possibly via-adjusted) one, so a "route via platforms" leg doesn't
  // itself count as a neighbour hop. A via-flow through a focused platform
  // is the one exception: both its own endpoints are exactly what the
  // prompt's own "highlights every via-flow through it" means to surface.
  const focusNeighbourIds = useMemo(() => {
    const result = new Set<UUID>();
    if (focusedElementId == null) return result;
    for (const edge of edges) {
      if (edge.from_element_id === focusedElementId) result.add(edge.to_element_id);
      else if (edge.to_element_id === focusedElementId) result.add(edge.from_element_id);
      else if (isViaFlowThroughFocus(edge)) {
        result.add(edge.from_element_id);
        result.add(edge.to_element_id);
      }
    }
    return result;
  }, [edges, focusedElementId, isViaFlowThroughFocus]);

  // Item 9: routed once per `layout`/`visibleEdges` change, not per draw —
  // a straight line when nothing's in the way (the common case), an
  // orthogonal detour through a clear channel otherwise (`layout.ts`'s own
  // comment on `routeLandscapeEdge`). Recomputing this per animation frame
  // during a pan/zoom drag would repeat the same O(edges × nodes) obstacle
  // check every frame for no reason — §8.6's performance budget applies
  // here exactly like viewport culling and LOD already do below.
  const routedEdges = useMemo(() => {
    const allPositions: LandscapeNodePosition[] = [...layout.nodes, ...layout.actorNodes];
    // S1 item 11a: an actor can now be a `uses` edge's own `from` endpoint
    // — this map used to be systems-only (every edge source was a system
    // or container), so an actor-sourced edge silently found no position
    // and was dropped. `allPositions` already combines both for obstacle
    // purposes; edge endpoint lookup needs the same combination.
    const positionById = new Map(allPositions.map((n) => [n.elementId, n]));
    const channels = computeLandscapeChannels(layout);
    const segments: { edge: RelationshipsHeadRow; points: { x: number; y: number }[] }[] = [];
    // V2: "edges to platforms end at a lane-edge chip unless the platform
    // is in focus" — a small fake `LandscapeNodePosition` centred exactly
    // on that lane's own top edge (so `routeLandscapeEdge`'s `NODE_WIDTH/
    // HEIGHT`-based centre math lands the edge, and the drawn pill below,
    // on the same point), keyed by the *real* node so the routing's own
    // per-node obstacle exclusion still works. `null` when this endpoint
    // isn't in the platform band, or is itself the focused element (focus
    // wants the real edge into the real tile, not a chip standing in for
    // it).
    const platformChipsByElementId = new Map<UUID, { elementId: UUID; name: string; x: number; y: number }>();
    const chipPositionFor = (position: LandscapeNodePosition): LandscapeNodePosition | null => {
      if (position.elementId === focusedElementId) return null;
      const lane = laneAt(position.y + NODE_HEIGHT / 2, layout.lanes);
      if (lane?.region !== 'platform') return null;
      const centreX = position.x + NODE_WIDTH / 2;
      const centreY = lane.y;
      if (!platformChipsByElementId.has(position.elementId)) {
        platformChipsByElementId.set(position.elementId, {
          elementId: position.elementId,
          name: systemsById.get(position.elementId)?.name ?? '',
          x: centreX - REFERENCE_CHIP_WIDTH / 2,
          y: centreY - REFERENCE_CHIP_HEIGHT / 2,
        });
      }
      return { elementId: position.elementId, x: centreX - NODE_WIDTH / 2, y: centreY - NODE_HEIGHT / 2 };
    };

    for (const edge of visibleEdges) {
      const from = positionById.get(edge.from_element_id);
      const to = positionById.get(edge.to_element_id);
      if (!from || !to) continue;

      // Prompt 7k item 4's "route via platforms" toggle: off (the default)
      // draws the direct edge regardless of `via` — on, and a `via`
      // resolving to a node actually on this map, draws two legs
      // (from→via, via→to) instead of one, each independently routed
      // around obstacles the same way a direct edge already is. A `via`
      // that doesn't resolve on this map (the platform system exists but
      // isn't itself placed here — shouldn't happen in practice, since the
      // platform is a system too, but not asserted away) falls back to the
      // direct edge rather than drawing nothing. Deliberately not subject
      // to the platform-chip redirection below: routing "via" a platform
      // is the one case that's supposed to visibly enter it.
      const via = attributesRecord(edge.attributes).via;
      const viaPosition = viaPositionFor(typeof via === 'string' ? via : undefined, positionById, routeViaPlatforms);
      if (viaPosition) {
        const obstaclesToVia = allPositions.filter((n) => n.elementId !== edge.from_element_id && n.elementId !== viaPosition.elementId);
        const obstaclesFromVia = allPositions.filter((n) => n.elementId !== viaPosition.elementId && n.elementId !== edge.to_element_id);
        segments.push({ edge, points: routeLandscapeEdge(from, viaPosition, obstaclesToVia, channels, layout.lanes) });
        segments.push({ edge, points: routeLandscapeEdge(viaPosition, to, obstaclesFromVia, channels, layout.lanes) });
        continue;
      }

      const obstacles = allPositions.filter((n) => n.elementId !== edge.from_element_id && n.elementId !== edge.to_element_id);
      const fromChip = chipPositionFor(from);
      const toChip = chipPositionFor(to);
      segments.push({ edge, points: routeLandscapeEdge(fromChip ?? from, toChip ?? to, obstacles, channels, layout.lanes) });
    }
    return { segments, platformEdgeChips: [...platformChipsByElementId.values()] };
  }, [layout, visibleEdges, routeViaPlatforms, focusedElementId, systemsById]);

  const fitToView = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    setTransform(computeFitTransform(layout.width, layout.height, wrapper.clientWidth, wrapper.clientHeight));
  }, [layout.width, layout.height]);

  // Item 1: "fit-to-view on load" — every load computes a fresh `layout`
  // object now (item 6), so this effect, keyed on `layout`'s own identity,
  // fires exactly when it should with nothing else to distinguish.
  useEffect(() => {
    fitToView();
    // Only `layout` itself (a fresh computation) should re-fit — `fitToView`
    // is recreated whenever `layout.width`/`layout.height` change, which is
    // only ever alongside `layout` itself changing anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    if (centreOn === null) return;
    const wrapper = wrapperRef.current;
    const position = layout.nodes.find((n) => n.elementId === centreOn.elementId) ?? layout.actorNodes.find((n) => n.elementId === centreOn.elementId);
    if (!wrapper || !position) return;
    setTransform((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(1, current.scale));
      return { scale, tx: wrapper.clientWidth / 2 - (position.x + NODE_WIDTH / 2) * scale, ty: wrapper.clientHeight / 2 - (position.y + NODE_HEIGHT / 2) * scale };
    });
    // Only a new request moves the view; a re-layout alone must not yank it back to a tile the user has since panned away from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreOn]);

  const nodeAt = useCallback(
    (screenX: number, screenY: number): { elementId: UUID; elementType: 'system' | 'actor' } | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const node of layout.nodes) {
        if (worldX >= node.x && worldX <= node.x + NODE_WIDTH && worldY >= node.y && worldY <= node.y + NODE_HEIGHT) {
          return { elementId: node.elementId, elementType: 'system' };
        }
      }
      for (const node of layout.actorNodes) {
        if (worldX >= node.x && worldX <= node.x + NODE_WIDTH && worldY >= node.y && worldY <= node.y + NODE_HEIGHT) {
          return { elementId: node.elementId, elementType: 'actor' };
        }
      }
      return null;
    },
    [layout, transform],
  );

  /** The comment marker's own hit region — bottom-right, for a system node carrying either marker state (ink, `open > 0`, or hollow, `total > 0 && open === 0` — see the marker's own drawing comment below; either one opens the same panel). Checked before `nodeAt` in the click handler so a marker click opens the panel instead of navigating. Actors never carry a marker (`threadCounts` is system-keyed). Not gated on `showLabels` the way the hollow marker's own drawing is — same fixed world-space region regardless of zoom, matching the ink marker's own "always drawn" hit region; a click where the hollow marker would be, at a zoom too far out to actually see it, is a rare enough miss not worth a second, zoom-aware hit-test path. */
  const commentMarkerAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      if (!threadCounts || threadCounts.size === 0) return null;
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const node of layout.nodes) {
        const counts = threadCounts.get(node.elementId);
        if (!counts || counts.total === 0) continue;
        const markerLeft = node.x + NODE_WIDTH - COMMENT_MARKER_INSET - COMMENT_MARKER_WIDTH;
        const markerTop = node.y + NODE_HEIGHT - COMMENT_MARKER_INSET - COMMENT_MARKER_HEIGHT;
        if (worldX >= markerLeft && worldX <= markerLeft + COMMENT_MARKER_WIDTH && worldY >= markerTop && worldY <= markerTop + COMMENT_MARKER_HEIGHT) {
          return node.elementId;
        }
      }
      return null;
    },
    [layout, transform, threadCounts],
  );

  /** The "+N" marker's own hit region — top-right, only for a node whose lane placement fell back to "most recently added" with other lanes it also touches (`extraLaneCount`, `layout.ts`'s own `placementFor`). A generous fixed *world*-space radius, same reasoning as `COMMENT_MARKER_WIDTH`/`HEIGHT` above: the drawn circle's on-screen size is quantised by zoom step, not worth matching pixel-for-pixel in a hit test. Checked before `nodeAt` (item 11: tapping the chip opens the popover instead of navigating). */
  const extraLaneMarkerAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const node of layout.nodes) {
        if (node.extraLaneCount === undefined) continue;
        const cx = node.x + NODE_WIDTH - 4;
        const cy = node.y + 4;
        if (Math.hypot(worldX - cx, worldY - cy) <= EXTRA_LANE_MARKER_HIT_RADIUS) return node.elementId;
      }
      return null;
    },
    [layout, transform],
  );

  /**
   * Secondary-supporter wording: the reference chip's own hit region —
   * same fixed `108×18` world-space box the drawing pass below lays it out
   * with (`marker.x`/`marker.y` is that box's own top-left corner), not a
   * generous radius the way `extraLaneMarkerAt`'s small circle needs —
   * the chip is already a real rectangle wide enough to hit reliably.
   */
  const referenceMarkerAt = useCallback(
    (screenX: number, screenY: number): UUID | null => {
      const worldX = (screenX - transform.tx) / transform.scale;
      const worldY = (screenY - transform.ty) / transform.scale;
      for (const marker of layout.referenceMarkers) {
        if (worldX >= marker.x && worldX <= marker.x + REFERENCE_CHIP_WIDTH && worldY >= marker.y && worldY <= marker.y + REFERENCE_CHIP_HEIGHT) {
          return marker.elementId;
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

      // Item 3: the enterprise boundary — a rectangle around every
      // capability/unassigned lane (never external, never the actor row
      // above it), drawn before anything else so lanes/nodes layer on top.
      if (layout.boundary.bottom > layout.boundary.top) {
        ctx.save();
        ctx.strokeStyle = tokens.borderStrong;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        roundRectPath(ctx, BOUNDARY_MARGIN, layout.boundary.top - BOUNDARY_MARGIN, layout.width - BOUNDARY_MARGIN * 2, layout.boundary.bottom - layout.boundary.top + BOUNDARY_MARGIN * 2, 12);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Prompt 7k item 3: the OT zone — its own smaller dashed rectangle,
      // inside the enterprise boundary, around just that lane's own
      // y-range. The lane's own label ("OT") already groups it visually
      // like any other lane; this extra rectangle is the "zone" cue the
      // prompt asks for, distinguishing it from an ordinary capability
      // lane the same way the enterprise boundary itself distinguishes
      // internal from external.
      const otLane = layout.lanes.find((lane) => lane.region === 'ot');
      if (otLane) {
        ctx.save();
        ctx.strokeStyle = tokens.statusWarn;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        roundRectPath(ctx, BOUNDARY_MARGIN * 2, otLane.y - BOUNDARY_MARGIN / 2, layout.width - BOUNDARY_MARGIN * 4, otLane.height - BOUNDARY_MARGIN, 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Prompt 7k item 4: the platform band — the same "own smaller dashed
      // rectangle inside the boundary" zone cue as the OT zone above, in
      // `tokens.statusInfo` rather than `statusWarn` (an integration/data
      // platform isn't "needs attention" the way an OT system is — it's
      // just a different kind of system, `systemKind.ts`'s own reasoning).
      const platformLane = layout.lanes.find((lane) => lane.region === 'platform');
      if (platformLane) {
        ctx.save();
        ctx.strokeStyle = tokens.statusInfo;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        roundRectPath(ctx, BOUNDARY_MARGIN * 2, platformLane.y - BOUNDARY_MARGIN / 2, layout.width - BOUNDARY_MARGIN * 4, platformLane.height - BOUNDARY_MARGIN, 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      const laneLabels: { text: string; worldX: number; worldY: number }[] = [];
      const referenceChips: { text: string; x: number; y: number }[] = [];
      for (const lane of layout.lanes) {
        if (lane.y > visible.bottom || lane.y + lane.height < visible.top) continue;
        laneLabels.push({ text: lane.label.toUpperCase(), worldX: laneLabelLeftInset(lane.region), worldY: lane.y + 8 });
        ctx.strokeStyle = tokens.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, lane.y + lane.height - 16);
        ctx.lineTo(layout.width, lane.y + lane.height - 16);
        ctx.stroke();
      }
      // Item 2: reference chips render as their own small shapes at the
      // band's right edge (`layout.ts` already positioned each one) — never
      // folded into the lane label text above.
      for (const marker of layout.referenceMarkers) {
        const system = systemsById.get(marker.elementId);
        if (!system) continue;
        referenceChips.push({ text: `⇢ ${system.name}`, x: marker.x, y: marker.y });
      }
      // V2: the platform lane-edge chip an edge terminates at instead of
      // the real platform tile (`routedEdges`'s own comment) — a `→ {name}`
      // pill, drawn identically to a reference chip's own small pill below
      // but with its own distinct arrow glyph and label, never folded into
      // `referenceChips` itself (a different concept: this marks where an
      // edge stops, not "this system also supports this lane").
      const platformEdgeChips = routedEdges.platformEdgeChips.map((chip) => ({ text: `→ ${chip.name}`, x: chip.x, y: chip.y }));

      const edgeMarkers: { text: string; worldX: number; worldY: number; colour: string }[] = [];
      // S1 item 11a: an actor's own `uses` edge shows its verb phrase
      // ("submits RIIO returns to") right on the canvas — unlike a
      // system-to-system edge, which has never had an on-canvas label
      // (its own description only ever showed on the element page's
      // RelationshipsSection row and the Context view). Scoped to actor-
      // involved edges only, not every edge: this is new drawing surface
      // this item specifically asked for, not a general "label every
      // edge" redesign of the existing, already-dense system web.
      const edgeLabels: { text: string; worldX: number; worldY: number }[] = [];
      if (edgeScreenWidth >= 0.25) {
        const simplified = edgeScreenWidth < 0.5;
        for (const { edge, points } of routedEdges.segments) {
          // Culling against the routed path's own bounding box, not just
          // the two endpoints — item 9's detours can bow out sideways well
          // past the straight-line box between `from`/`to`.
          const xs = points.map((p) => p.x);
          const ys = points.map((p) => p.y);
          const left = Math.min(...xs);
          const top = Math.min(...ys);
          if (!rectIntersects(visible, left, top, Math.max(...xs) - left, Math.max(...ys) - top)) continue;

          const edgeDiff = diffByRelationshipId.get(edge.relationship_id);
          const edgeState = edgeDiff?.state ?? 'unchanged';
          const diffColour = diff && edgeState !== 'unchanged' ? diffBorderColour(edgeState, tokens) : null;
          ctx.save();
          ctx.strokeStyle = diffColour ?? tokens.borderStrong;
          ctx.lineWidth = simplified ? 1 / transform.scale : 1.5;
          ctx.globalAlpha = diff && edgeState === 'unchanged' ? 0.6 : 1;
          if (edgeState === 'removed') ctx.setLineDash([6, 4]);

          ctx.beginPath();
          const [first, ...rest] = points;
          if (first) ctx.moveTo(first.x, first.y);
          for (const point of rest) ctx.lineTo(point.x, point.y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (diff && (edgeState === 'added' || edgeState === 'changed') && !simplified) {
            const mid = polylineMidpoint(points);
            edgeMarkers.push({ text: edgeState === 'added' ? '+' : '~', worldX: mid.x, worldY: mid.y, colour: diffColour ?? tokens.text });
          }

          if (showLabels && !simplified && (actorsById.has(edge.from_element_id) || actorsById.has(edge.to_element_id))) {
            const description = attributesRecord(edge.attributes).description;
            if (typeof description === 'string' && description.trim().length > 0) {
              const mid = polylineMidpoint(points);
              edgeLabels.push({ text: description, worldX: mid.x, worldY: mid.y });
            }
          }

          // "Aggregated": below the 0.5px tier, a plain hairline with no
          // arrowhead stands in for what would otherwise be a dense tangle
          // of individually-indistinguishable direction markers.
          if (simplified) {
            ctx.restore();
            continue;
          }
          // One arrowhead, direction-only semantics (UI-principles §9) —
          // never a per-relationship-type marker style. Oriented off the
          // path's own final segment, not the overall from→to direction,
          // so a routed (non-straight) edge still points the right way
          // into its target.
          const last = points[points.length - 1] ?? { x: 0, y: 0 };
          const beforeLast = points[points.length - 2] ?? last;
          const angle = Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x);
          const arrowX = last.x - Math.cos(angle) * (NODE_WIDTH / 2);
          const arrowY = last.y - Math.sin(angle) * (NODE_HEIGHT / 2);
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
      // claims). The ink (unresolved) marker is always drawn, at every
      // zoom, unlike `showLabels`-gated node labels: "a count nobody can
      // see is a count that does not exist" (`docs/HANDOFF-M1b-comments.md`'s
      // Canvas section) — an open thread is worth surfacing even zoomed
      // out past where names read.
      const commentMarkers: { elementId: UUID; count: number; worldX: number; worldY: number }[] = [];
      // M1 close-out item 1's "hollow" marker — every thread on this
      // anchor resolved (`total > 0 && open === 0`, `atlas.thread_counts`'s
      // own distinction from "no comments at all", where the anchor is
      // simply absent from `threadCounts`). Unlike the ink marker above,
      // gated on `showLabels`: an all-clear signal is reassurance, not an
      // alert, so it's fine for it to recede along with the names at the
      // same zoom-out point rather than staying pinned at every scale.
      const hollowCommentMarkers: { elementId: UUID; worldX: number; worldY: number }[] = [];

      // An arrow function assigned to a `const`, not a hoisted `function`
      // declaration — TS narrows `ctx` to non-null only up to this point in
      // `draw()`'s own body; a nested `function` declaration loses that
      // narrowing across the closure boundary, an arrow function captured
      // by a `const` here does not.
      const drawNode = (elementId: UUID, elementType: 'system' | 'actor', x: number, y: number, extraLaneCount: number | undefined): void => {
        if (!rectIntersects(visible, x, y, NODE_WIDTH, NODE_HEIGHT)) return;
        const element = elementType === 'system' ? systemsById.get(elementId) : actorsById.get(elementId);
        if (!element) return;
        const external = attributesRecord(element.attributes).isExternal === true;
        const isHovered = hover?.elementId === elementId;
        const nodeDiff = elementType === 'system' ? diffByElementId.get(elementId) : undefined;
        const nodeState = nodeDiff?.state ?? 'unchanged';
        const diffColour = diff && elementType === 'system' ? diffBorderColour(nodeState, tokens) : null;

        // M1 close-out item 1's own "comments on this view" filter — a node
        // with no thread at all recedes rather than disappearing outright
        // (`LandscapeCanvasProps.commentsOnlyFilter`'s own comment explains
        // why this stays a lens over the existing layout, not a re-query).
        // Combined multiplicatively with the diff view's own "unchanged"
        // fade above, not replacing it, so a filtered, unchanged node reads
        // fainter still rather than one fade silently overriding the other.
        const threadCountsForNode = elementType === 'system' ? threadCounts?.get(elementId) : undefined;
        const hasAnyThread = (threadCountsForNode?.total ?? 0) > 0;
        const diffAlpha = diff && elementType === 'system' && nodeState === 'unchanged' ? 0.6 : 1;
        const filterAlpha = commentsOnlyFilter && !hasAnyThread ? 0.25 : 1;
        // V2: "subject plus direct neighbours at full opacity, rest at
        // 20%" — a third multiplicative term, composed the same way as the
        // two above rather than replacing them, so a focused-but-filtered
        // node reads fainter still instead of one fade silently overriding
        // the other.
        const focusAlpha = focusedElementId == null || elementId === focusedElementId || focusNeighbourIds.has(elementId) ? 1 : 0.2;

        ctx.save();
        ctx.globalAlpha = diffAlpha * filterAlpha * focusAlpha;
        roundRectPath(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 8);
        if (diff && nodeState === 'removed') {
          const pattern = createHatchPattern(ctx, tokens.diffRemoved);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          if (pattern) {
            roundRectPath(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 8);
            ctx.fillStyle = pattern;
            ctx.fill();
          }
        } else if (diff && diffColour) {
          ctx.fillStyle = `color-mix(in srgb, ${diffColour} 12%, ${tokens.surfaceRaised})`;
          ctx.fill();
        } else {
          // Colour-by only ever applies here — the one fill branch reached
          // when no diff view is active at all — never mixed with a diff
          // tint above, per UI-principles §8.4 ("status and diff must not
          // be read across"). Actors carry neither `criticality` nor
          // `hostingModel`, so `landscapeTileColourFor` naturally returns
          // no tone for them (`attributesRecord` on an actor's attributes
          // just won't have the key).
          const statusTone = !diff && colourBy !== 'none' ? landscapeTileColourFor(colourBy, element).tone : undefined;
          ctx.fillStyle = statusTone ? `color-mix(in srgb, ${statusColourFor(statusTone, tokens)} 16%, ${tokens.surfaceRaised})` : tokens.surfaceRaised;
          ctx.fill();
        }
        ctx.strokeStyle = diffColour ?? (isHovered ? tokens.accent : tokens.borderStrong);
        ctx.lineWidth = diffColour ? 2 : isHovered ? 2 : 1;
        if (nodeState === 'removed' || (external && !diffColour)) ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Comment markers (Sprint M1b) only ever apply to systems —
        // `threadCounts` is keyed by system id.
        const openCount = threadCountsForNode?.open ?? 0;
        const totalCount = threadCountsForNode?.total ?? 0;
        if (showLabels) {
          const glyph = elementType === 'actor' ? elementTypeGlyph('actor', attributesRecord(element.attributes).subtype as ActorSubtype | undefined) : elementTypeGlyph('system');
          nodeLabels.push({ glyph, name: element.name, worldX: x, worldY: y, truncateToNarrow: totalCount > 0 });
        }
        if (diff && elementType === 'system' && DIFF_MARKER[nodeState] !== '') {
          const label = nodeState === 'changed' ? `${DIFF_MARKER[nodeState]}${String(nodeDiff?.changedAttributes.length ?? 0)}` : DIFF_MARKER[nodeState];
          diffMarkers.push({ text: label, worldX: x + 4, worldY: y + 4, colour: diffColour ?? tokens.text });
        }
        if (extraLaneCount !== undefined) {
          extraLaneMarkers.push({ text: `+${String(extraLaneCount)}`, worldX: x + NODE_WIDTH - 4, worldY: y + 4, colour: tokens.textMuted });
        }
        if (openCount > 0) {
          commentMarkers.push({ elementId, count: openCount, worldX: x + NODE_WIDTH - COMMENT_MARKER_INSET, worldY: y + NODE_HEIGHT - COMMENT_MARKER_INSET });
        } else if (totalCount > 0 && showLabels) {
          hollowCommentMarkers.push({ elementId, worldX: x + NODE_WIDTH - COMMENT_MARKER_INSET, worldY: y + NODE_HEIGHT - COMMENT_MARKER_INSET });
        }
      };

      for (const node of layout.actorNodes) drawNode(node.elementId, 'actor', node.x, node.y, undefined);
      for (const node of layout.nodes) drawNode(node.elementId, 'system', node.x, node.y, node.extraLaneCount);

      ctx.restore();

      // Text, in a second pass, entirely in screen space (dpr scale only —
      // not `transform`): quantised zoom (zoom.ts) means text should hold a
      // fixed on-screen size within a zoom step, not scale continuously
      // with the gesture the way node geometry does, so it can't share the
      // world-transformed pass above.
      if (laneLabels.length > 0 || nodeLabels.length > 0 || diffMarkers.length > 0 || edgeMarkers.length > 0 || edgeLabels.length > 0 || extraLaneMarkers.length > 0 || referenceChips.length > 0 || platformEdgeChips.length > 0 || commentMarkers.length > 0 || hollowCommentMarkers.length > 0) {
        const textScale = quantizeScale(transform.scale, MIN_SCALE, MAX_SCALE);
        const toScreen = (worldX: number, worldY: number): [number, number] => [worldX * transform.scale + transform.tx, worldY * transform.scale + transform.ty];
        ctx.textBaseline = 'middle';

        ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillStyle = tokens.textMuted;
        for (const label of laneLabels) {
          const [x, y] = toScreen(label.worldX, label.worldY);
          ctx.fillText(label.text, x, y);
        }

        // Item 2's own small right-edge chips — a filled pill, never text
        // folded into the lane label above.
        ctx.font = `${(10 * textScale).toFixed(2)}px sans-serif`;
        for (const chip of referenceChips) {
          const [x, y] = toScreen(chip.x, chip.y);
          const w = REFERENCE_CHIP_WIDTH * transform.scale;
          const h = REFERENCE_CHIP_HEIGHT * transform.scale;
          roundRectPath(ctx, x, y, w, h, h / 2);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          ctx.strokeStyle = tokens.border;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = tokens.textMuted;
          const truncated = truncate(ctx, chip.text, w - 12 * textScale);
          ctx.fillText(truncated, x + 6 * textScale, y + h / 2);
        }

        // V2's own platform lane-edge chip — same pill shape as a
        // reference chip, distinguished only by its `→ {name}` text (this
        // component's own `routedEdges` comment explains why it's a
        // separate concept, not folded into `referenceChips` above).
        for (const chip of platformEdgeChips) {
          const [x, y] = toScreen(chip.x, chip.y);
          const w = REFERENCE_CHIP_WIDTH * transform.scale;
          const h = REFERENCE_CHIP_HEIGHT * transform.scale;
          roundRectPath(ctx, x, y, w, h, h / 2);
          ctx.fillStyle = tokens.surfaceRaised;
          ctx.fill();
          ctx.strokeStyle = tokens.statusInfo;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = tokens.textMuted;
          const truncated = truncate(ctx, chip.text, w - 12 * textScale);
          ctx.fillText(truncated, x + 6 * textScale, y + h / 2);
        }

        for (const label of nodeLabels) {
          const [x, y] = toScreen(label.worldX, label.worldY);
          const screenNodeHeight = NODE_HEIGHT * transform.scale;
          ctx.fillStyle = tokens.text;
          ctx.font = `${(14 * textScale).toFixed(2)}px sans-serif`;
          // Overflow fix (same root cause as ContextDiagramCanvas.tsx's own
          // "Graphical Design Tool" fix): `textScale` is *quantised*
          // (`zoom.ts`'s own comment — pinned to one of 8 steps so the font
          // itself doesn't jitter mid-zoom) and can land above the real,
          // continuous `transform.scale` at some zoom levels — exactly when
          // the node's own box on screen (always sized by the true
          // `transform.scale`, never `textScale`) is smaller than whatever
          // `textScale` assumes it to be. The glyph offset and the name's
          // own wrap/truncate width both have to track that same real box
          // size, or the name is measured and placed against a box that
          // doesn't match the one actually drawn. Only the font's own
          // rendered size (`ctx.font`, right above/below) stays pinned to
          // `textScale` — that's the one thing quantisation is for.
          ctx.fillText(label.glyph, x + 10 * transform.scale, y + screenNodeHeight / 2);
          ctx.font = `${(12 * textScale).toFixed(2)}px sans-serif`;
          // A node carrying a comment marker reserves the marker's own
          // width (4px inset + 18px box + 4px gap = 26px) so the name
          // never overlaps it (`docs/HANDOFF-M1b-comments.md`'s Canvas
          // section: "truncate to 100px instead").
          const maxWidth = (label.truncateToNarrow ? NODE_WIDTH - 34 - 26 : NODE_WIDTH - 34) * transform.scale;
          const truncated = truncate(ctx, label.name, maxWidth);
          ctx.fillText(truncated, x + 30 * transform.scale, y + screenNodeHeight / 2);
        }

        // S1 item 11a: an actor's own `uses` edge verb phrase, centred on
        // the edge's own midpoint — plain muted text, same treatment as a
        // lane label, not a filled pill (`referenceChips`' own shape):
        // this labels a line, not a small fixed-size marker.
        ctx.font = `${(11 * textScale).toFixed(2)}px sans-serif`;
        ctx.fillStyle = tokens.textMuted;
        ctx.textAlign = 'center';
        for (const label of edgeLabels) {
          const [x, y] = toScreen(label.worldX, label.worldY);
          const truncated = truncate(ctx, label.text, NODE_WIDTH * 1.5 * textScale);
          ctx.fillText(truncated, x, y - 6 * textScale);
        }
        ctx.textAlign = 'left';

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

        // M1 close-out item 1's hollow marker — same plate, but "background
        // reverts to the surface, digit and border to ~82%/45% ink"
        // (`docs/HANDOFF-M1b-comments.md`'s own wording for this exact
        // state): outline only, no fill, no digit at all (an all-resolved
        // thread has nothing left to count) — the empty plate itself is
        // the whole signal. `tokens.textMuted` for the border reads as
        // that ~45% ink against the node's own surface underneath.
        for (const marker of hollowCommentMarkers) {
          const [right, bottom] = toScreen(marker.worldX, marker.worldY);
          const w = COMMENT_MARKER_WIDTH * textScale;
          const h = COMMENT_MARKER_HEIGHT * textScale;
          const left = right - w;
          const top = bottom - h;
          roundRectPath(ctx, left, top, w, h, 2 * textScale);
          ctx.strokeStyle = tokens.textMuted;
          ctx.lineWidth = 1;
          ctx.stroke();
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
  }, [layout, routedEdges, systemsById, actorsById, diff, diffByElementId, diffByRelationshipId, transform, hover, threadCounts, commentsOnlyFilter, colourBy, focusedElementId, focusNeighbourIds]);

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
        setHoverReference(null);
        return;
      }
    }

    // Secondary-supporter wording: checked before `nodeAt` — a reference
    // chip sits in a lane's own margin, never overlapping a real node's
    // hit region, but checking it first keeps this the same precedence
    // every other marker (`extraLaneMarkerAt`/`commentMarkerAt`) already
    // gets over a plain node.
    const referenceElementId = referenceMarkerAt(screenX, screenY);
    if (referenceElementId) {
      setHover(null);
      setHoverReference({ elementId: referenceElementId, screenX, screenY });
      return;
    }
    setHoverReference(null);

    const hit = nodeAt(screenX, screenY);
    setHover(hit ? { elementId: hit.elementId, elementType: hit.elementType, screenX, screenY } : null);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved) return;
    // Item 11: checked first — tapping the "+N" chip opens/closes its own
    // popover instead of navigating, the same precedence the comment
    // marker already gets over a plain node click. Any other click on the
    // canvas closes an already-open popover (the nearest thing this
    // component has to "click outside" — see the popover's own render-site
    // comment for the other dismiss paths).
    const extraLaneElementId = extraLaneMarkerAt(screenX, screenY);
    if (extraLaneElementId) {
      setExtraLanesPopover((prev) => (prev?.elementId === extraLaneElementId ? null : { elementId: extraLaneElementId, screenX, screenY }));
      return;
    }
    setExtraLanesPopover(null);
    // Secondary-supporter wording: same tap-to-toggle a touch device needs
    // for `extraLanesPopover` above — a tap has no preceding hover to have
    // already shown this via `handlePointerMove`.
    const referenceElementId = referenceMarkerAt(screenX, screenY);
    if (referenceElementId) {
      setHoverReference((prev) => (prev?.elementId === referenceElementId ? null : { elementId: referenceElementId, screenX, screenY }));
      return;
    }
    setHoverReference(null);
    const markerElementId = commentMarkerAt(screenX, screenY);
    if (markerElementId) {
      onCommentMarkerClick?.(markerElementId);
      return;
    }
    const hit = nodeAt(screenX, screenY);
    // V2 decision 2: "click focuses; click again navigates." A hit on the
    // already-focused tile is today's exact behaviour, unchanged — it
    // navigates. A hit on any other tile focuses instead of navigating; a
    // miss (empty canvas background) clears focus, same as Escape.
    if (hit) {
      if (hit.elementId === focusedElementId) void navigate(hit.elementType === 'system' ? nodeHref(hit.elementId) : actorHref(hit.elementId));
      else onFocusElement?.(hit.elementId);
    } else {
      onClearFocus?.();
    }
  }

  const zoomBy = useCallback((factor: number, center?: { x: number; y: number }): void => {
    setTransform((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor));
      const wrapper = wrapperRef.current;
      const cx = center?.x ?? (wrapper ? wrapper.clientWidth / 2 : 0);
      const cy = center?.y ?? (wrapper ? wrapper.clientHeight / 2 : 0);
      const worldX = (cx - prev.tx) / prev.scale;
      const worldY = (cy - prev.ty) / prev.scale;
      return { scale: nextScale, tx: cx - worldX * nextScale, ty: cy - worldY * nextScale };
    });
  }, []);

  // A plain React `onWheel` prop is attached by React as a passive native
  // listener (React 17+ default, to keep scrolling smooth), so calling
  // `preventDefault()` from inside it is a no-op that also warns on every
  // event ("Unable to preventDefault inside passive event listener
  // invocation") — this canvas needs the page to *not* scroll while the
  // user zooms it with the wheel, so the listener is attached natively
  // below with `{ passive: false }` instead of via the JSX prop.
  const handleWheel = useCallback(
    (e: WheelEvent): void => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
      // `wheelZoomFactor` (zoom.ts) scales the step by how much of a single
      // wheel "notch" this event's own deltaY represents — see its own
      // comment for the bug this fixes (a burst of small-delta events, from
      // a trackpad or a high-resolution mouse, used to each get the same
      // full step as one real notch and could compound to MIN/MAX_SCALE, and
      // therefore off-screen, in a fraction of a second).
      zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [zoomBy],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>): void {
    if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-') zoomBy(1 / 1.2);
    else if (e.key === '0') fitToView();
    // §8.8's global `c`/`n` — see this component's own `onToggleCommentsPanel`/`onNewCommentShortcut` prop comments for why the hovered node stands in for "the focused row" here.
    else if (e.key === 'c') onToggleCommentsPanel?.(hover?.elementId ?? null);
    else if (e.key === 'n' && hover) onNewCommentShortcut?.(hover.elementId);
    // §8.8's own "Filter chips" row — its first real binding, V2.
    else if (e.key === 'f') onOpenFilterBar?.();
    else if (e.key === 'Escape' && extraLanesPopover) setExtraLanesPopover(null);
    else if (e.key === 'Escape' && hoverReference) setHoverReference(null);
    // V2 decision 2: "Escape clears" focus — appended after the two
    // existing Escape branches above, same style, so a popover/reference
    // tooltip still takes precedence when one happens to be open too.
    else if (e.key === 'Escape' && focusedElementId != null) onClearFocus?.();
  }

  // Secondary-supporter wording: the reference chip's own resolved system
  // name, for the tooltip text below.
  const hoveredReferenceSystem = hoverReference ? systemsById.get(hoverReference.elementId) : undefined;

  const hoveredElement = hover ? (hover.elementType === 'system' ? systemsById.get(hover.elementId) : actorsById.get(hover.elementId)) : undefined;
  // §6.3: "Hover on any marker shows the changed attributes" — base -> new isn't shown here (the canvas has no per-field value, only the diff's element-grain summary); the element page's own history is where that detail lives. Actors carry no diff state (diff is system/relationship-grained).
  const hoveredDiff = diff && hover?.elementType === 'system' ? diffByElementId.get(hover.elementId) : undefined;
  // Colour-by's own tone is never the only place its value is shown (§8.7)
  // — the tooltip is this canvas's one place to put the label text a Chip
  // would otherwise carry. Computed once here, not inline in the JSX
  // below, so its `string | undefined` result narrows cleanly.
  const hoveredColourByLabel = colourBy !== 'none' && hover?.elementType === 'system' && hoveredElement ? landscapeTileColourFor(colourBy, hoveredElement).label : undefined;

  // Item 11: the popover's own content — every other level-1 lane the
  // popover's node also supports (`layout.referenceMarkers`, filtered to
  // this one element id), resolved to that lane's own label via
  // `layout.lanes`. Computed on render, not memoized — it's only ever a
  // handful of entries and only exists while the popover itself is open.
  const extraLanesEntries = extraLanesPopover
    ? layout.referenceMarkers
        .filter((m) => m.elementId === extraLanesPopover.elementId)
        .map((m) => ({ laneKey: m.laneKey, label: layout.lanes.find((l) => l.key === m.laneKey)?.label ?? m.laneKey }))
    : [];
  const extraLanesSystemName = extraLanesPopover ? systemsById.get(extraLanesPopover.elementId)?.name : undefined;

  return (
    <div
      ref={wrapperRef}
      className={styles.wrapper}
      data-scale={transform.scale}
      data-tx={transform.tx}
      data-ty={transform.ty}
      data-layout-width={layout.width}
      data-layout-height={layout.height}
      // V2: Playwright's own hook onto focus state — the `data-scale`/
      // `data-tx`/`data-ty` precedent above, extended so a test can assert
      // the actual computed focused/neighbour set directly rather than
      // inferring it indirectly from click side-effects.
      data-focused-element-id={focusedElementId ?? ''}
      data-focus-neighbour-ids={[...focusNeighbourIds].join(',')}
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={`Landscape diagram: ${String(layout.nodes.length)} systems across ${String(layout.lanes.length)} lanes, ${String(layout.actorNodes.length)} actors, ${String(layout.referenceMarkers.length)} cross-lane reference chips. Use the element page for an accessible, list-based view of any system shown here.`}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setHover(null);
          setHoverReference(null);
        }}
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
      {hoveredElement && hover && (
        <div className={styles.tooltip} style={{ left: hover.screenX, top: hover.screenY }}>
          {hoveredElement.name}
          {attributesRecord(hoveredElement.attributes).isExternal === true ? ' (external)' : ''}
          {hoveredDiff && hoveredDiff.state !== 'unchanged' && hoveredDiff.changedAttributes.length > 0 && ` — changed: ${hoveredDiff.changedAttributes.join(', ')}`}
          {hoveredColourByLabel !== undefined && ` — ${hoveredColourByLabel}`}
        </div>
      )}
      {/* Secondary-supporter wording: the reference chip's own tooltip/tap
          text — a different, purpose-written sentence, not the chip's own
          "⇢ {name}" label re-shown. */}
      {hoveredReferenceSystem && hoverReference && (
        <div className={styles.tooltip} style={{ left: hoverReference.screenX, top: hoverReference.screenY }}>
          {hoveredReferenceSystem.name} also supports this capability (secondary)
        </div>
      )}
      {extraLanesPopover && (
        <div
          className={styles.extraLanesPopover}
          style={{ left: extraLanesPopover.screenX, top: extraLanesPopover.screenY }}
          role="menu"
          aria-label={extraLanesSystemName ? `Other capabilities ${extraLanesSystemName} also supports` : 'Other capabilities'}
        >
          <div className={styles.extraLanesPopoverHeader}>
            <span>{extraLanesSystemName ? `${extraLanesSystemName} also supports` : 'Also supports'}</span>
            <button
              type="button"
              className={styles.extraLanesPopoverClose}
              aria-label="Close"
              onClick={() => {
                setExtraLanesPopover(null);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {extraLanesEntries.map((entry) => (
            <a
              key={entry.laneKey}
              href={capabilityHref(entry.laneKey)}
              className={styles.extraLanesPopoverLink}
              role="menuitem"
              onClick={(clickEvent) => {
                clickEvent.preventDefault();
                setExtraLanesPopover(null);
                void navigate(capabilityHref(entry.laneKey));
              }}
            >
              {entry.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
