import { describe, expect, it } from 'vitest';
import {
  allTilesOf,
  bandIndexOf,
  classifyNeighbourGroup,
  computeContextDiagramLayout,
  edgeLabelsCollide,
  edgeNear,
  MIN_DIAGRAM_WIDTH,
  placeEdgeLabels,
  spreadAlong,
  truncateToWidth,
  type ContextDiagramLayout,
  type ContextEdgeInput,
  type ContextNeighbourInput,
  type DiagramTile,
  type EdgeLabelPill,
  type Point,
  type RoutedEdge,
} from './contextDiagramLayout';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';
import { PM_CONTEXT_SCENARIO, scenarioLayoutInputs } from './fixtures/sapContext';

/** A fixed-width-per-character stand-in for `ctx.measureText(text).width / scale` — deterministic, unlike a real font's kerning. 6px/char is close to an 11px sans-serif at scale 1. */
function fixedWidthMeasurer(pxPerChar: number): (text: string) => number {
  return (text) => text.length * pxPerChar;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function tileRect(t: DiagramTile): Rect {
  return { left: t.x, right: t.x + t.w, top: t.y, bottom: t.y + t.h };
}

function pillRect(p: EdgeLabelPill): Rect {
  return { left: p.x - p.width / 2, right: p.x + p.width / 2, top: p.y - p.height / 2, bottom: p.y + p.height / 2 };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function tilesOverlap(a: DiagramTile | undefined, b: DiagramTile | undefined): boolean {
  if (!a || !b) throw new Error('expected both tiles to exist');
  return rectsOverlap(tileRect(a), tileRect(b));
}

/** True when the axis-aligned segment `a`–`b` passes through the *interior* of `rect` (touching its border, as an anchor does, doesn't count). */
function segmentCrossesInterior(a: Point, b: Point, rect: Rect): boolean {
  const eps = 0.001;
  if (a.x === b.x) {
    const x = a.x;
    if (x <= rect.left + eps || x >= rect.right - eps) return false;
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return y1 < rect.bottom - eps && y2 > rect.top + eps;
  }
  if (a.y === b.y) {
    const y = a.y;
    if (y <= rect.top + eps || y >= rect.bottom - eps) return false;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    return x1 < rect.right - eps && x2 > rect.left + eps;
  }
  throw new Error('expected an axis-aligned segment');
}

function segmentsOf(edge: RoutedEdge): [Point, Point][] {
  const result: [Point, Point][] = [];
  for (let i = 1; i < edge.points.length; i += 1) {
    const a = edge.points[i - 1];
    const b = edge.points[i];
    if (a && b) result.push([a, b]);
  }
  return result;
}

/** Every obstacle rect a routed edge must never cross the interior of: the hub tile, and every neighbour tile. */
function allRects(layout: ContextDiagramLayout): Rect[] {
  return [tileRect(layout.hub), ...layout.neighbours.map(tileRect)];
}

function neighbour(id: string, opts: Partial<ContextNeighbourInput> = {}): ContextNeighbourInput {
  return { id, isExternal: false, isActor: false, ...opts };
}

/** The standing fixture (`fixtures/sapContext.ts`), laid out at a given width. */
function pmLayout(widthHint = 1280): ContextDiagramLayout {
  const inputs = scenarioLayoutInputs();
  return computeContextDiagramLayout(inputs.hubId, inputs.neighbours, widthHint, inputs.edges);
}

describe('classifyNeighbourGroup', () => {
  const inEdge: ContextEdgeInput = { id: 'e1', neighbourId: 'n', arrowAtHub: true, label: 'in' };
  const outEdge: ContextEdgeInput = { id: 'e2', neighbourId: 'n', arrowAtHub: false, label: 'out' };

  it('is always "actor" for an actor, whatever its own edges say', () => {
    expect(classifyNeighbourGroup(true, [inEdge])).toBe('actor');
    expect(classifyNeighbourGroup(true, [outEdge])).toBe('actor');
    expect(classifyNeighbourGroup(true, [inEdge, outEdge])).toBe('actor');
  });

  it('is "source" when every edge flows into the hub, "target" when every edge flows out', () => {
    expect(classifyNeighbourGroup(false, [inEdge])).toBe('source');
    expect(classifyNeighbourGroup(false, [outEdge])).toBe('target');
  });

  it('is "twoWay" when a non-actor has at least one edge each way', () => {
    expect(classifyNeighbourGroup(false, [inEdge, outEdge])).toBe('twoWay');
  });
});

describe('bandIndexOf', () => {
  it('is 0 for the first MAX_PER_BAND (4) positions, then increments every 4 after that', () => {
    expect([0, 1, 2, 3].map(bandIndexOf)).toEqual([0, 0, 0, 0]);
    expect([4, 5, 6, 7].map(bandIndexOf)).toEqual([1, 1, 1, 1]);
    expect(bandIndexOf(8)).toBe(2);
  });
});

describe('computeContextDiagramLayout — hub and groups', () => {
  it('the hub always gets the standard node size', () => {
    const layout = computeContextDiagramLayout('hub', []);
    expect(layout.hub.w).toBe(NODE_WIDTH);
    expect(layout.hub.h).toBe(NODE_HEIGHT);
  });

  it('a source neighbour (edge flows into the hub) sits to the left; a target neighbour (edge flows out) sits to the right', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('src'), neighbour('tgt')], undefined, [
      { id: 'e1', neighbourId: 'src', arrowAtHub: true, label: 'reports to' },
      { id: 'e2', neighbourId: 'tgt', arrowAtHub: false, label: 'sends to' },
    ]);
    const src = layout.neighbours.find((t) => t.elementId === 'src');
    const tgt = layout.neighbours.find((t) => t.elementId === 'tgt');
    expect(src?.x).toBeLessThan(layout.hub.x);
    expect(tgt?.x).toBeGreaterThan(layout.hub.x + layout.hub.w);
  });

  it('a two-way neighbour (edges both ways) sits below the hub', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('both')], undefined, [
      { id: 'e1', neighbourId: 'both', arrowAtHub: true, label: 'reports to' },
      { id: 'e2', neighbourId: 'both', arrowAtHub: false, label: 'sends to' },
    ]);
    const tile = layout.neighbours.find((t) => t.elementId === 'both');
    expect(tile?.y).toBeGreaterThan(layout.hub.y + layout.hub.h);
    expect((tile?.x ?? 0) + NODE_WIDTH / 2).toBeCloseTo(layout.hub.x + layout.hub.w / 2, 0);
  });

  it('an actor sits above the hub even when its own edge flows into it, same direction a source would otherwise use', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('person', { isActor: true })], undefined, [{ id: 'e1', neighbourId: 'person', arrowAtHub: true, label: 'audits' }]);
    const tile = layout.neighbours.find((t) => t.elementId === 'person');
    expect(tile?.y).toBeLessThan(layout.hub.y);
  });

  it('with no neighbours at all, the layout is just the hub — no boundary to draw', () => {
    const layout = computeContextDiagramLayout('hub', []);
    expect(layout.neighbours).toHaveLength(0);
    expect(layout.boundary).toBeNull();
  });

  it('the boundary encloses the hub and every internal neighbour; an external neighbour in the same group sits outside it', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('int-src'), neighbour('ext-src', { isExternal: true })], undefined, [
      { id: 'e1', neighbourId: 'int-src', arrowAtHub: true, label: 'a' },
      { id: 'e2', neighbourId: 'ext-src', arrowAtHub: true, label: 'b' },
    ]);
    const boundary = layout.boundary;
    if (!boundary) throw new Error('expected a boundary');
    const internalTile = layout.neighbours.find((t) => t.elementId === 'int-src');
    const externalTile = layout.neighbours.find((t) => t.elementId === 'ext-src');
    if (!internalTile || !externalTile) throw new Error('expected both tiles');
    expect(internalTile.x).toBeGreaterThanOrEqual(boundary.left);
    expect(internalTile.x + internalTile.w).toBeLessThanOrEqual(boundary.right);
    // External sits strictly farther from the hub, on the same (left) side, than any internal tile in the same group.
    expect(externalTile.x).toBeLessThan(internalTile.x);
    expect(externalTile.x).toBeLessThan(boundary.left);
  });

  it('is deterministic — the same inputs always produce the same layout, routes included', () => {
    const inputs = scenarioLayoutInputs();
    const a = computeContextDiagramLayout(inputs.hubId, inputs.neighbours, 1280, inputs.edges);
    const b = computeContextDiagramLayout(inputs.hubId, inputs.neighbours, 1280, inputs.edges);
    expect(b).toEqual(a);
  });

  it('has no minimum floor smaller than MIN_DIAGRAM_WIDTH even with a narrower hint', () => {
    const layout = computeContextDiagramLayout('hub', [], 400);
    expect(layout.width).toBe(MIN_DIAGRAM_WIDTH);
  });

  it('never more than MAX_PER_BAND (4) source tiles share a band — a 5th source starts a second, more distant column', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `s${String(i)}`);
    const layout = computeContextDiagramLayout(
      'hub',
      ids.map((id) => neighbour(id)),
      undefined,
      ids.map((id) => ({ id: `e-${id}`, neighbourId: id, arrowAtHub: true, label: 'x' })),
    );
    const xs = new Set(layout.neighbours.map((t) => t.x));
    expect(xs.size).toBe(2);
  });
});

describe('allTilesOf', () => {
  it('flattens hub and neighbours into one list', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('n1'), neighbour('n2', { isExternal: true })], undefined, [
      { id: 'e1', neighbourId: 'n1', arrowAtHub: true, label: 'x' },
      { id: 'e2', neighbourId: 'n2', arrowAtHub: true, label: 'y' },
    ]);
    const ids = allTilesOf(layout).map((t) => t.elementId);
    expect(ids).toEqual(expect.arrayContaining(['hub', 'n1', 'n2']));
    expect(ids).toHaveLength(3);
  });
});

describe('spreadAlong', () => {
  it('places count attach points evenly inside a span, never on its ends', () => {
    expect(spreadAlong(0, 100, 0, 1)).toBe(50);
    expect([0, 1, 2].map((i) => spreadAlong(0, 100, i, 3))).toEqual([25, 50, 75]);
  });
});

describe('bidirectional pairs merge into one routed edge (rework item 3)', () => {
  it('a two-way neighbour\'s own in/out pair draws as a single edge, arrowheads at both ends, both verbs in one label', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('both')], undefined, [
      { id: 'in', neighbourId: 'both', arrowAtHub: true, label: '← reports to' },
      { id: 'out', neighbourId: 'both', arrowAtHub: false, label: 'sends to →' },
    ]);
    expect(layout.edges).toHaveLength(1);
    const [edge] = layout.edges;
    if (!edge) throw new Error('expected one merged edge');
    expect(edge.arrowAtHub).toBe(true);
    expect(edge.arrowAtNeighbour).toBe(true);
    expect(edge.relationshipIds).toEqual(expect.arrayContaining(['in', 'out']));
    expect(edge.relationshipIds).toHaveLength(2);
    expect(edge.label).toContain('reports to');
    expect(edge.label).toContain('sends to');
  });

  it('an uneven in/out count pairs up what it can and draws the leftover as an ordinary single-direction edge', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('both')], undefined, [
      { id: 'in1', neighbourId: 'both', arrowAtHub: true, label: 'in one' },
      { id: 'in2', neighbourId: 'both', arrowAtHub: true, label: 'in two' },
      { id: 'out1', neighbourId: 'both', arrowAtHub: false, label: 'out one' },
    ]);
    expect(layout.edges).toHaveLength(2);
    const merged = layout.edges.filter((e) => e.arrowAtNeighbour);
    const leftover = layout.edges.filter((e) => !e.arrowAtNeighbour);
    expect(merged).toHaveLength(1);
    expect(leftover).toHaveLength(1);
    expect(leftover[0]?.relationshipIds).toHaveLength(1);
  });

  it('a source or target neighbour (all edges one way) never merges, even with several edges', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('src')], undefined, [
      { id: 'a', neighbourId: 'src', arrowAtHub: true, label: 'one' },
      { id: 'b', neighbourId: 'src', arrowAtHub: true, label: 'two' },
    ]);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.every((e) => !e.arrowAtNeighbour)).toBe(true);
  });
});

describe('SAP PM context fixture — the standing density case (fixtures/sapContext.ts)', () => {
  const inputs = scenarioLayoutInputs();
  const layout = pmLayout(1280);
  const measure = fixedWidthMeasurer(6);

  it('is the scenario the fixture describes: 8 neighbours, 12 relationships, 1 external, exactly 1 two-way pair', () => {
    const internal = inputs.neighbours.filter((n) => !n.isExternal);
    const external = inputs.neighbours.filter((n) => n.isExternal);
    expect(inputs.neighbours).toHaveLength(8);
    expect(internal).toHaveLength(7);
    expect(external).toHaveLength(1);
    expect(inputs.edges).toHaveLength(12);
    const twoWay = PM_CONTEXT_SCENARIO.neighbours.filter((n) => new Set(n.flows.map((f) => f.direction)).size === 2);
    expect(twoWay).toHaveLength(1);
    expect(twoWay[0]?.key).toBe('field-service');
  });

  it('places every tile with no two tiles overlapping, hub included', () => {
    const tiles = allTilesOf(layout);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) expect(tilesOverlap(tiles[i], tiles[j])).toBe(false);
    }
  });

  it('routes every edge with axis-aligned segments only, neighbour end first, hub end last', () => {
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(edge.points[0]).toEqual(edge.neighbourAnchor);
      const last = edge.points[edge.points.length - 1];
      expect(last).toEqual({ x: edge.hubAnchor.x, y: edge.hubAnchor.y });
      for (const [a, b] of segmentsOf(edge)) expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('no two edges share a port on the hub tile (or on a neighbour tile)', () => {
    const hubAttach = layout.edges.map((e) => `${String(e.hubAnchor.x)} ${String(e.hubAnchor.y)}`);
    expect(new Set(hubAttach).size).toBe(hubAttach.length);
    const neighbourAttach = layout.edges.map((e) => `${String(e.neighbourAnchor.x)} ${String(e.neighbourAnchor.y)}`);
    expect(new Set(neighbourAttach).size).toBe(neighbourAttach.length);
  });

  it("field-service's own two-way pair renders as one edge, arrowheads at both ends, both verbs in one label — not two separately routed lines", () => {
    const fieldServiceEdges = layout.edges.filter((e) => e.neighbourId === 'field-service');
    expect(fieldServiceEdges).toHaveLength(1);
    const [edge] = fieldServiceEdges;
    if (!edge) throw new Error('expected field-service to have one routed edge');
    expect(edge.arrowAtHub).toBe(true);
    expect(edge.arrowAtNeighbour).toBe(true);
    expect(edge.relationshipIds).toHaveLength(2);
    expect(edge.label).toContain('dispatches work orders to');
    expect(edge.label).toContain('returns job completion and timesheets to');
    // 12 relationships in, 11 routed edges out — the only place the count drops is this one merge.
    expect(inputs.edges).toHaveLength(12);
    expect(layout.edges).toHaveLength(11);
  });

  it('no edge segment passes through the interior of any tile', () => {
    const rects = allRects(layout);
    for (const edge of layout.edges) {
      for (const [a, b] of segmentsOf(edge)) {
        for (const rect of rects) expect(segmentCrossesInterior(a, b, rect)).toBe(false);
      }
    }
  });

  it('places every label with no two pills and no pill/tile colliding at 1280', () => {
    const pills = placeEdgeLabels(layout.edges, measure);
    expect(pills).toHaveLength(layout.edges.length);
    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i];
        const b = pills[j];
        if (a && b) expect(rectsOverlap(pillRect(a), pillRect(b))).toBe(false);
      }
    }
    expect(edgeLabelsCollide(pills, allTilesOf(layout))).toBe(false);
  });

  it('still routes cleanly at the minimum width, with no tile overlap or edge-through-tile', () => {
    const narrow = pmLayout(MIN_DIAGRAM_WIDTH);
    const rects = allRects(narrow);
    for (const edge of narrow.edges) {
      for (const [a, b] of segmentsOf(edge)) {
        for (const rect of rects) expect(segmentCrossesInterior(a, b, rect)).toBe(false);
      }
    }
  });

  it('keeps every routed point inside the diagram bounds', () => {
    for (const edge of layout.edges) {
      for (const p of edge.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(layout.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(layout.height);
      }
    }
  });
});

describe('placeEdgeLabels / edgeLabelsCollide', () => {
  const measure = fixedWidthMeasurer(6);

  it('wraps a label to two lines when it does not fit its span on one, and ellipsizes a line that still does not fit', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('n1')], 1280, [{ id: 'e', neighbourId: 'n1', arrowAtHub: true, label: '⇢ submits reconciliation and payroll adjustment records to the central ledger' }]);
    const [pill] = placeEdgeLabels(layout.edges, measure);
    expect(pill?.lines).toHaveLength(2);
    const wide = fixedWidthMeasurer(40);
    const [big] = placeEdgeLabels(layout.edges, wide);
    expect(big?.lines.every((l) => l.length > 0)).toBe(true);
    expect(big?.lines.some((l) => l.endsWith('…'))).toBe(true);
  });

  it('skips an edge with a blank label', () => {
    const layout = computeContextDiagramLayout('hub', [neighbour('n1')], 1280, [{ id: 'e', neighbourId: 'n1', arrowAtHub: true, label: '   ' }]);
    expect(placeEdgeLabels(layout.edges, measure)).toEqual([]);
  });

  it('reports a collision when two pills crowd each other, and when a pill overlaps a tile', () => {
    const a: EdgeLabelPill = { edgeId: 'a', lines: ['x'], x: 100, y: 100, width: 60, height: 18 };
    const b: EdgeLabelPill = { edgeId: 'b', lines: ['y'], x: 162, y: 100, width: 60, height: 18 }; // 2px apart — crowded
    const far: EdgeLabelPill = { edgeId: 'c', lines: ['z'], x: 300, y: 100, width: 60, height: 18 };
    expect(edgeLabelsCollide([a, b], [])).toBe(true);
    expect(edgeLabelsCollide([a, far], [])).toBe(false);
    const tile: DiagramTile = { elementId: 't', x: 90, y: 95, w: 50, h: 50 };
    expect(edgeLabelsCollide([far], [tile])).toBe(false);
    expect(edgeLabelsCollide([a], [tile])).toBe(true);
  });

  it('truncateToWidth ellipsizes deterministically and leaves fitting text alone', () => {
    expect(truncateToWidth('short', measure, 100)).toBe('short');
    const cut = truncateToWidth('a much longer label than fits', measure, 60);
    expect(cut.endsWith('…')).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(60);
  });
});

describe('edgeNear (hover/tap-to-reveal)', () => {
  const layout = pmLayout(1280);

  it('finds the edge whose polyline passes within tolerance of a point, and nothing for a point in open space', () => {
    const edge = layout.edges[0];
    if (!edge) throw new Error('expected an edge');
    const [a, b] = segmentsOf(edge)[0] ?? [];
    if (!a || !b) throw new Error('expected a segment');
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(edgeNear(layout.edges, mid, 6)?.id).toBe(edge.id);
    expect(edgeNear(layout.edges, { x: -500, y: -500 }, 6)).toBeNull();
  });
});
