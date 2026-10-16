/**
 * Integration platform context's own layout: a pure, deterministic
 * function (CLAUDE.md rule 6) producing tile positions and two-segment
 * routed edges for `IntegrationPlatformDiagramCanvas.tsx`. Reuses
 * `contextDiagramLayout.ts`'s tile size constants (`NODE_WIDTH`/
 * `NODE_HEIGHT`) and its `spreadAlong` attach-point helper, but is
 * otherwise its own, deliberately simpler engine — this diagram's shape
 * (three fixed columns: sources, the platform, targets) has none of the
 * fan/wrap/riser problems that file's own module comment describes for a
 * single hub with a row of neighbours below it. Two scope simplifications
 * relative to that engine, both worth naming rather than leaving implicit:
 *
 * - No row wrapping. A column's own height is free to grow (the canvas
 *   pans/zooms into view, same as an unusually tall ordinary Context
 *   diagram already can), so there's no viewport-width constraint forcing
 *   a column to wrap into two the way a neighbour *row* would.
 * - No label-collision audit. `contextDiagramLayout.ts`'s `placeEdgeLabels`/
 *   `edgeLabelsCollide` pair (auto-hiding labels at high edge density) is
 *   real engineering this simpler diagram doesn't reuse — a genuinely
 *   crowded platform (many sources/targets, each with several edges) can
 *   in principle show crowded label pills. Acceptable for a first build,
 *   same "not the whole of it" stance this product's other pure-scope
 *   notes take (`docs/HANDOFF-7d-architect-door.md`'s own precedent) —
 *   revisit if a real model's platform diagram turns out dense enough for
 *   it to matter in practice.
 */
import type { UUID } from '../../contracts/delta';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';
import { spreadAlong, type Point } from './contextDiagramLayout';

const PADDING = 32;
/** Vertical gap between two tiles stacked in the same column. */
const TILE_GUTTER_Y = 24;
/**
 * Horizontal distance between a column and the platform tile. Each half is the run a label pill sits on (the verb on the source side, the data classification on the target side), so it holds a label pill (up to `PILL_RUN_WIDTH`) *beside* its tile rather than over it — at the original 140 the pills spilled across the tile edge they were meant to label.
 */
const COLUMN_GAP = 340;
/** Vertical room each edge attached to a tile gets: a label pill is 18px tall, so adjacent attach points need clearly more than that or two pills on one tile sit on top of each other. */
const ATTACH_PITCH = 26;
/** Gap between a tile's edge and the start of the verb pill beside it. */
const LABEL_INSET = 10;
/** The longest a label pill may run beside its tile, in world units: the whole half-gap's run to the platform and a little past the elbow, leaving `LABEL_INSET` clear at each end. The canvas scales it with the zoom, so a label is cut only when it would really run into the next column. */
export const PILL_RUN_WIDTH = COLUMN_GAP - LABEL_INSET * 4;
/** ADR-026: the platform's own name sits in this strip at the top of its tile when interface bands fill the rest. */
const HUB_HEADER = 26;

/** A tile's height: the standard tile, or taller once it carries enough edges that their attach points would otherwise sit closer than `ATTACH_PITCH` (the platform itself, which every flow touches, grows the most — it is the bus). */
function tileHeightFor(edgeCount: number): number {
  return Math.max(NODE_HEIGHT, (edgeCount + 1) * ATTACH_PITCH);
}

export interface PlatformFlowTile {
  elementId: UUID;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One via-flow to draw — always source → platform → target, the platform itself never an endpoint of the underlying relationship (`useElementContext.ts`'s own `IntegrationPlatformContextData` doc comment). */
export interface PlatformFlowEdgeInput {
  id: UUID;
  sourceId: UUID;
  targetId: UUID;
  /** The relationship's own verb phrase (`edgeLabel`'s formatted output, or an empty string) — shown on the source→platform segment. */
  verbLabel: string;
  /** The relationship's own `dataClassification`, already formatted for display — `null` when unset (`flows_to` only ever carries one; `uses` never does, `relationshipAttributeSchema.ts`'s own schema). Shown on the platform→target segment. */
  classificationLabel: string | null;
  /** ADR-026: the interface this flow's `via` names, when it names one rather than the platform itself — flows are grouped inside the platform tile by it. */
  interfaceId?: UUID | null | undefined;
  /** Prompt's own "IT/OT boundary crossings highlighted" — true when the source and target resolve to opposite sides of the IT/OT boundary (`isBoundaryCrossingPair`/`resolveElementDomain`, `src/db/healthFindings.ts`/`systemDomain.ts`). */
  crossesBoundary: boolean;
}

export interface RoutedPlatformFlowEdge extends PlatformFlowEdgeInput {
  /** Source tile's own right-edge attach point, through the elbow, to the platform's left-edge attach point. */
  sourceSegment: Point[];
  /** The platform's own right-edge attach point, through the elbow, to the target tile's left-edge attach point. */
  targetSegment: Point[];
  /** Left end of the verb label pill, on the source segment's own leaving-the-source run — the pill is drawn rightwards from here. */
  verbLabelAnchor: Point;
  /** Centre of the target segment's own arriving-at-the-target run — where the target-side pill sits (the flow's number, and its data classification when it has one). */
  classificationLabelAnchor: Point;
  /**
   * This flow's number, shown on both its source-side and target-side pill. A flow is source → platform → target, drawn as two separate lines meeting at the platform, so with more than a couple of apps nothing else says which line out the right belongs to which line in on the left. Numbered top to bottom by where the flow leaves its source (the order the left-hand pills read in), from 1.
   */
  flowNumber: number;
}

/** ADR-026: one interface's band inside the platform tile — the vertical span its flows attach across. `interfaceId` null is the "via the platform itself" group, drawn only when interfaces exist too. */
export interface InterfaceBand {
  interfaceId: UUID | null;
  top: number;
  bottom: number;
}

export interface IntegrationPlatformContextLayout {
  hub: PlatformFlowTile;
  /** Empty unless at least one flow names an interface. */
  interfaceBands: InterfaceBand[];
  /** Room at the top of the platform tile for its own name when bands are drawn inside it. */
  hubHeaderHeight: number;
  sources: PlatformFlowTile[];
  targets: PlatformFlowTile[];
  edges: RoutedPlatformFlowEdge[];
  width: number;
  height: number;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One column's own tiles, stacked top to bottom, sorted by id for a deterministic tie-break (CLAUDE.md rule 6 — there's no other ordering signal once every tile is the same fixed size). */
function stackColumn(ids: readonly UUID[], x: number, top: number, heightOf: (id: UUID) => number): PlatformFlowTile[] {
  let y = top;
  return [...ids].sort(compareIds).map((elementId) => {
    const h = heightOf(elementId);
    const tile = { elementId, x, y, w: NODE_WIDTH, h };
    y += h + TILE_GUTTER_Y;
    return tile;
  });
}

/** This column's own total height — every tile plus every gutter between them; 0 for an empty column. */
function columnHeight(ids: readonly UUID[], heightOf: (id: UUID) => number): number {
  return ids.length === 0 ? 0 : [...ids].reduce((sum, id) => sum + heightOf(id), 0) + (ids.length - 1) * TILE_GUTTER_Y;
}

/**
 * @param hubId The `kind: 'integration_platform'` system this Context view is scoped to.
 * @param sourceIds Distinct `from_element_id`s across every via-flow — the left column.
 * @param targetIds Distinct `to_element_id`s across every via-flow — the right column. An id can legally appear in both (the same element is a source of one flow and a target of another through the same platform) — it simply gets its own tile in each column.
 * @param edges Every via-flow to route. Empty is a valid (edgeless) layout.
 */
export function computeIntegrationPlatformContextLayout(
  hubId: UUID,
  sourceIds: readonly UUID[],
  targetIds: readonly UUID[],
  edges: readonly PlatformFlowEdgeInput[],
): IntegrationPlatformContextLayout {
  // How many drawn edges touch each tile decides how tall it is (`tileHeightFor`): the platform carries every one, a source or target only its own.
  const sourceIdSet = new Set(sourceIds);
  const targetIdSet = new Set(targetIds);
  const drawn = edges.filter((e) => sourceIdSet.has(e.sourceId) && targetIdSet.has(e.targetId));
  const sourceEdgeCount = new Map<UUID, number>();
  const targetEdgeCount = new Map<UUID, number>();
  for (const edge of drawn) {
    sourceEdgeCount.set(edge.sourceId, (sourceEdgeCount.get(edge.sourceId) ?? 0) + 1);
    targetEdgeCount.set(edge.targetId, (targetEdgeCount.get(edge.targetId) ?? 0) + 1);
  }
  const sourceHeight = (id: UUID): number => tileHeightFor(sourceEdgeCount.get(id) ?? 0);
  const targetHeight = (id: UUID): number => tileHeightFor(targetEdgeCount.get(id) ?? 0);
  const grouped = drawn.some((e) => e.interfaceId != null);
  const hubHeaderHeight = grouped ? HUB_HEADER : 0;
  const hubHeight = tileHeightFor(drawn.length) + hubHeaderHeight;
  const sourcesHeight = columnHeight(sourceIds, sourceHeight);
  const targetsHeight = columnHeight(targetIds, targetHeight);
  const contentHeight = Math.max(hubHeight, sourcesHeight, targetsHeight);

  const sourcesX = PADDING;
  const hubX = sourcesX + NODE_WIDTH + COLUMN_GAP;
  const targetsX = hubX + NODE_WIDTH + COLUMN_GAP;

  const sources = stackColumn(sourceIds, sourcesX, PADDING + (contentHeight - sourcesHeight) / 2, sourceHeight);
  const targets = stackColumn(targetIds, targetsX, PADDING + (contentHeight - targetsHeight) / 2, targetHeight);
  const hub: PlatformFlowTile = { elementId: hubId, x: hubX, y: PADDING + (contentHeight - hubHeight) / 2, w: NODE_WIDTH, h: hubHeight };

  const sourceById = new Map(sources.map((t) => [t.elementId, t]));
  const targetById = new Map(targets.map((t) => [t.elementId, t]));

  // Attach order at a source/target tile: by edge id, spread along the
  // tile's own height (`spreadAlong`, shared with the ordinary Context
  // diagram's own neighbour-attach spacing) — more than one edge can leave
  // the same source or arrive at the same target (this layout's own
  // Playwright fixture: two sources sharing one target).
  const edgesFromSource = new Map<UUID, PlatformFlowEdgeInput[]>();
  const edgesToTarget = new Map<UUID, PlatformFlowEdgeInput[]>();
  for (const edge of edges) {
    if (!sourceById.has(edge.sourceId) || !targetById.has(edge.targetId)) continue;
    const fromList = edgesFromSource.get(edge.sourceId) ?? [];
    fromList.push(edge);
    edgesFromSource.set(edge.sourceId, fromList);
    const toList = edgesToTarget.get(edge.targetId) ?? [];
    toList.push(edge);
    edgesToTarget.set(edge.targetId, toList);
  }
  const sourceAttachY = new Map<UUID, number>();
  for (const [sourceId, list] of edgesFromSource) {
    const tile = sourceById.get(sourceId);
    if (!tile) continue;
    const ordered = [...list].sort((a, b) => compareIds(a.id, b.id));
    ordered.forEach((edge, i) => sourceAttachY.set(edge.id, spreadAlong(tile.y, tile.h, i, ordered.length)));
  }
  const targetAttachY = new Map<UUID, number>();
  for (const [targetId, list] of edgesToTarget) {
    const tile = targetById.get(targetId);
    if (!tile) continue;
    const ordered = [...list].sort((a, b) => compareIds(a.id, b.id));
    ordered.forEach((edge, i) => targetAttachY.set(edge.id, spreadAlong(tile.y, tile.h, i, ordered.length)));
  }

  // Attach order at the hub's own two edges: the left edge (one point per
  // incoming edge, ordered by the source's own attach y so lines never
  // needlessly cross), the right edge symmetrically for outgoing edges.
  const routableEdges = edges.filter((e) => sourceById.has(e.sourceId) && targetById.has(e.targetId));
  // ADR-026: when flows name interfaces, both of the platform's edges list them group by group (interfaces in order of their first flow down the left, "via the platform itself" last), so each group's flows enter and leave across the same band of the tile.
  const groupRank = new Map<UUID | null, number>();
  if (grouped) {
    const bySourceY = [...routableEdges].sort((a, b) => (sourceAttachY.get(a.id) ?? 0) - (sourceAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
    for (const edge of bySourceY) if (edge.interfaceId != null && !groupRank.has(edge.interfaceId)) groupRank.set(edge.interfaceId, groupRank.size);
    groupRank.set(null, groupRank.size);
  }
  const rankOf = (edge: PlatformFlowEdgeInput): number => (grouped ? (groupRank.get(edge.interfaceId ?? null) ?? 0) : 0);
  const attachTop = hub.y + hubHeaderHeight;
  const attachHeight = hub.h - hubHeaderHeight;
  const hubLeftOrder = [...routableEdges].sort((a, b) => rankOf(a) - rankOf(b) || (sourceAttachY.get(a.id) ?? 0) - (sourceAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
  const hubLeftY = new Map<UUID, number>(hubLeftOrder.map((edge, i) => [edge.id, spreadAlong(attachTop, attachHeight, i, hubLeftOrder.length)]));
  const hubRightOrder = [...routableEdges].sort((a, b) => rankOf(a) - rankOf(b) || (targetAttachY.get(a.id) ?? 0) - (targetAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
  const hubRightY = new Map<UUID, number>(hubRightOrder.map((edge, i) => [edge.id, spreadAlong(attachTop, attachHeight, i, hubRightOrder.length)]));
  // One band per group: from half a pitch above its first attach point to half a pitch below its last (left and right lists hold each group at the same positions, so one span serves both edges of the tile).
  const pitch = attachHeight / (hubLeftOrder.length + 1);
  const interfaceBands: InterfaceBand[] = [];
  if (grouped) {
    for (const [interfaceId] of [...groupRank.entries()].sort((a, b) => a[1] - b[1])) {
      const ys = hubLeftOrder.filter((e) => (e.interfaceId ?? null) === interfaceId).map((e) => hubLeftY.get(e.id) ?? 0);
      if (ys.length === 0) continue;
      interfaceBands.push({ interfaceId, top: Math.min(...ys) - pitch / 2, bottom: Math.max(...ys) + pitch / 2 });
    }
  }

  const sourceMidX = sourcesX + NODE_WIDTH + COLUMN_GAP / 2;
  const targetMidX = hubX + NODE_WIDTH + COLUMN_GAP / 2;

  const routed: RoutedPlatformFlowEdge[] = routableEdges.flatMap((edge) => {
    const sourceTile = sourceById.get(edge.sourceId);
    const targetTile = targetById.get(edge.targetId);
    if (!sourceTile || !targetTile) return [];
    const sy = sourceAttachY.get(edge.id) ?? sourceTile.y + sourceTile.h / 2;
    const hly = hubLeftY.get(edge.id) ?? hub.y + hub.h / 2;
    const hry = hubRightY.get(edge.id) ?? hub.y + hub.h / 2;
    const ty = targetAttachY.get(edge.id) ?? targetTile.y + targetTile.h / 2;

    const sourceStart: Point = { x: sourceTile.x + sourceTile.w, y: sy };
    const hubLeft: Point = { x: hub.x, y: hly };
    const hubRight: Point = { x: hub.x + hub.w, y: hry };
    const targetEnd: Point = { x: targetTile.x, y: ty };

    // Manhattan elbow: out horizontally from the tile at its own attach y,
    // turn at the column midline, arrive horizontally at the other tile's
    // attach y — a straight line needs no elbow at all when both ends
    // already share a y.
    const sourceSegment: Point[] = sy === hly ? [sourceStart, hubLeft] : [sourceStart, { x: sourceMidX, y: sy }, { x: sourceMidX, y: hly }, hubLeft];
    const targetSegment: Point[] = hry === ty ? [hubRight, targetEnd] : [hubRight, { x: targetMidX, y: hry }, { x: targetMidX, y: ty }, targetEnd];

    return [
      {
        ...edge,
        sourceSegment,
        targetSegment,
        // The pill's left end, just clear of the source tile (the canvas draws it from here to the right), so a long verb runs along the line instead of back over the tile it labels.
        verbLabelAnchor: { x: sourceStart.x + LABEL_INSET, y: sy },
        classificationLabelAnchor: { x: (targetMidX + targetEnd.x) / 2, y: ty },
        flowNumber: 0,
      },
    ];
  });
  routed.sort((a, b) => compareIds(a.id, b.id));
  // Numbered in the order the left-hand pills read, top to bottom (by the source's attach y, then id) — not the platform's grouped order — so the numbers on the left run 1, 2, 3 …
  const readingOrder = [...routableEdges].sort((a, b) => (sourceAttachY.get(a.id) ?? 0) - (sourceAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
  const numberByEdgeId = new Map(readingOrder.map((edge, i) => [edge.id, i + 1]));
  for (const edge of routed) edge.flowNumber = numberByEdgeId.get(edge.id) ?? 0;

  return {
    hub,
    interfaceBands,
    hubHeaderHeight,
    sources,
    targets,
    edges: routed,
    width: targetsX + NODE_WIDTH + PADDING,
    height: contentHeight + 2 * PADDING,
  };
}

/** Every tile in a completed layout, hub included — the flat list the canvas needs for hit-testing (mirrors `contextDiagramLayout.ts`'s `allTilesOf`). */
export function allPlatformFlowTilesOf(layout: IntegrationPlatformContextLayout): PlatformFlowTile[] {
  return [layout.hub, ...layout.sources, ...layout.targets];
}
