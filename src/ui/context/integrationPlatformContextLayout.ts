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
/** Horizontal distance between a column and the platform tile — wide enough for a label pill on each of the two segments meeting there. */
const COLUMN_GAP = 140;

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
  /** Prompt's own "IT/OT boundary crossings highlighted" — true when the source and target resolve to opposite sides of the IT/OT boundary (`isBoundaryCrossingPair`/`resolveElementDomain`, `src/db/healthFindings.ts`/`systemDomain.ts`). */
  crossesBoundary: boolean;
}

export interface RoutedPlatformFlowEdge extends PlatformFlowEdgeInput {
  /** Source tile's own right-edge attach point, through the elbow, to the platform's left-edge attach point. */
  sourceSegment: Point[];
  /** The platform's own right-edge attach point, through the elbow, to the target tile's left-edge attach point. */
  targetSegment: Point[];
  /** Centre of the source segment's own leaving-the-source run — where the verb label pill sits. */
  verbLabelAnchor: Point;
  /** Centre of the target segment's own arriving-at-the-target run — where the classification chip pill sits. */
  classificationLabelAnchor: Point;
}

export interface IntegrationPlatformContextLayout {
  hub: PlatformFlowTile;
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
function stackColumn(ids: readonly UUID[], x: number, top: number): PlatformFlowTile[] {
  return [...ids].sort(compareIds).map((elementId, i) => ({ elementId, x, y: top + i * (NODE_HEIGHT + TILE_GUTTER_Y), w: NODE_WIDTH, h: NODE_HEIGHT }));
}

/** This column's own total height — every tile plus every gutter between them; 0 for an empty column. */
function columnHeight(count: number): number {
  return count === 0 ? 0 : count * NODE_HEIGHT + (count - 1) * TILE_GUTTER_Y;
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
  const contentHeight = Math.max(NODE_HEIGHT, columnHeight(sourceIds.length), columnHeight(targetIds.length));

  const sourcesX = PADDING;
  const hubX = sourcesX + NODE_WIDTH + COLUMN_GAP;
  const targetsX = hubX + NODE_WIDTH + COLUMN_GAP;

  const sources = stackColumn(sourceIds, sourcesX, PADDING + (contentHeight - columnHeight(sourceIds.length)) / 2);
  const targets = stackColumn(targetIds, targetsX, PADDING + (contentHeight - columnHeight(targetIds.length)) / 2);
  const hub: PlatformFlowTile = { elementId: hubId, x: hubX, y: PADDING + (contentHeight - NODE_HEIGHT) / 2, w: NODE_WIDTH, h: NODE_HEIGHT };

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
  const hubLeftOrder = [...routableEdges].sort((a, b) => (sourceAttachY.get(a.id) ?? 0) - (sourceAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
  const hubLeftY = new Map<UUID, number>(hubLeftOrder.map((edge, i) => [edge.id, spreadAlong(hub.y, hub.h, i, hubLeftOrder.length)]));
  const hubRightOrder = [...routableEdges].sort((a, b) => (targetAttachY.get(a.id) ?? 0) - (targetAttachY.get(b.id) ?? 0) || compareIds(a.id, b.id));
  const hubRightY = new Map<UUID, number>(hubRightOrder.map((edge, i) => [edge.id, spreadAlong(hub.y, hub.h, i, hubRightOrder.length)]));

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
        verbLabelAnchor: { x: (sourceStart.x + sourceMidX) / 2, y: sy },
        classificationLabelAnchor: { x: (targetMidX + targetEnd.x) / 2, y: ty },
      },
    ];
  });
  routed.sort((a, b) => compareIds(a.id, b.id));

  return {
    hub,
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
