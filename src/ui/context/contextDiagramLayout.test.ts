import { describe, expect, it } from 'vitest';
import {
  allTilesOf,
  computeContextDiagramLayout,
  edgeLabelsCollide,
  edgeNear,
  fanGapFor,
  LANE_PITCH,
  MIN_DIAGRAM_WIDTH,
  placeEdgeLabels,
  spreadAlong,
  tileTopAnchor,
  truncateToWidth,
  type ContextDiagramLayout,
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
  return [tileRect(layout.hub), ...[...layout.internalNeighbours, ...layout.externalNeighbours].map(tileRect)];
}

/** The standing fixture (`fixtures/sapContext.ts`), laid out at a given width. */
function pmLayout(widthHint = 1280): ContextDiagramLayout {
  const inputs = scenarioLayoutInputs();
  return computeContextDiagramLayout(inputs.hubId, inputs.internal, inputs.external, widthHint, inputs.edges);
}

describe('computeContextDiagramLayout — tiles', () => {
  it('the hub always gets the standard node size — V3 dropped the one case that widened it, a platform\'s own module row (PlatformStructureView.tsx has that now)', () => {
    const layout = computeContextDiagramLayout('hub', [], []);
    expect(layout.hub.w).toBe(NODE_WIDTH);
    expect(layout.hub.h).toBe(NODE_HEIGHT);
  });

  it('the hub is horizontally centred within the diagram width', () => {
    const layout = computeContextDiagramLayout('hub', [], []);
    expect(layout.hub.x + layout.hub.w / 2).toBeCloseTo(layout.width / 2, 0);
  });

  it('the boundary encloses the hub and internal neighbours; external neighbours sit below it', () => {
    const layout = computeContextDiagramLayout('hub', ['internal-1'], ['external-1']);
    expect(layout.boundary.top).toBeLessThanOrEqual(layout.hub.y);
    expect(layout.boundary.bottom).toBeGreaterThanOrEqual((layout.internalNeighbours[0]?.y ?? 0) + NODE_HEIGHT);
    expect(layout.externalNeighbours[0]?.y ?? 0).toBeGreaterThan(layout.boundary.bottom);
  });

  it('wraps onto a second row only when even the minimum gutter cannot fit every tile', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`);
    const layout = computeContextDiagramLayout('hub', many, [], 960);
    const rowsUsed = new Set(layout.internalNeighbours.map((t) => t.y));
    expect(rowsUsed.size).toBeGreaterThan(1);
    expect(layout.rows.filter((r) => !r.external)).toHaveLength(rowsUsed.size);
  });

  it('a wider diagram fits more tiles per row than the minimum floor', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`);
    const narrow = computeContextDiagramLayout('hub', many, [], 960);
    const wide = computeContextDiagramLayout('hub', many, [], 2400);
    expect(new Set(wide.internalNeighbours.map((t) => t.y)).size).toBeLessThan(new Set(narrow.internalNeighbours.map((t) => t.y)).size);
  });

  it('is deterministic — the same inputs always produce the same layout, routes included', () => {
    const inputs = scenarioLayoutInputs();
    const a = computeContextDiagramLayout(inputs.hubId, inputs.internal, inputs.external, 1280, inputs.edges);
    const b = computeContextDiagramLayout(inputs.hubId, inputs.internal, inputs.external, 1280, inputs.edges);
    expect(b).toEqual(a);
  });

  it('has no minimum floor smaller than MIN_DIAGRAM_WIDTH even with a narrower hint', () => {
    const layout = computeContextDiagramLayout('hub', [], [], 400);
    expect(layout.width).toBe(MIN_DIAGRAM_WIDTH);
  });

  it('a short row of neighbours is centred within the diagram width, not left-hugging', () => {
    const layout = computeContextDiagramLayout('hub', ['n1', 'n2', 'n3'], []);
    const left = Math.min(...layout.internalNeighbours.map((t) => t.x));
    const right = Math.max(...layout.internalNeighbours.map((t) => t.x + t.w));
    expect((left + right) / 2).toBeCloseTo(layout.width / 2, 0);
  });

  it('centre-weighted layout still wraps and centres each row independently when neighbours overflow one row', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`);
    const layout = computeContextDiagramLayout('hub', many, [], 960);
    const rows = new Map<number, DiagramTile[]>();
    for (const tile of layout.internalNeighbours) {
      const row = rows.get(tile.y) ?? [];
      row.push(tile);
      rows.set(tile.y, row);
    }
    for (const row of rows.values()) {
      const leftEdge = Math.min(...row.map((t) => t.x));
      const rightEdge = Math.max(...row.map((t) => t.x + t.w));
      expect((leftEdge + rightEdge) / 2).toBeCloseTo(layout.width / 2, 0);
    }
  });
});

describe('allTilesOf', () => {
  it('flattens every region into one list, hub included', () => {
    const layout = computeContextDiagramLayout('hub', ['internal-1'], ['external-1']);
    const ids = allTilesOf(layout).map((t) => t.elementId);
    expect(ids).toEqual(expect.arrayContaining(['hub', 'internal-1', 'external-1']));
    expect(ids).toHaveLength(3);
  });
});

describe('tileTopAnchor', () => {
  it("V1 polish, \"leaving neighbours from above\": anchors at a tile's own top-centre", () => {
    const layout = computeContextDiagramLayout('hub', ['n1'], []);
    const neighbour = layout.internalNeighbours[0];
    if (!neighbour) throw new Error('expected a neighbour tile');
    expect(tileTopAnchor(neighbour)).toEqual({ x: neighbour.x + neighbour.w / 2, y: neighbour.y });
  });
});

describe('fan (rework item 1)', () => {
  it('the gap between neighbours grows with their count, capped', () => {
    expect(fanGapFor(1)).toBe(24);
    expect(fanGapFor(2)).toBe(44);
    expect(fanGapFor(5)).toBe(104);
    expect(fanGapFor(50)).toBe(120);
  });

  it('five neighbours spread wider than two — not the same layout compressed', () => {
    const two = computeContextDiagramLayout('hub', ['a', 'b'], [], 1280);
    const five = computeContextDiagramLayout('hub', ['a', 'b', 'c', 'd', 'e'], [], 1280);
    const gapOf = (layout: ContextDiagramLayout) => {
      const xs = [...layout.internalNeighbours].sort((p, q) => p.x - q.x);
      return (xs[1]?.x ?? 0) - ((xs[0]?.x ?? 0) + (xs[0]?.w ?? 0));
    };
    expect(gapOf(two)).toBe(fanGapFor(2));
    expect(gapOf(five)).toBe(fanGapFor(5));
    expect(gapOf(five)).toBeGreaterThan(gapOf(two));
    expect(five.rows[0]?.gap).toBe(fanGapFor(5));
  });

  it('shrinks the gap toward the minimum gutter before wrapping when the fan would overflow', () => {
    // Five NODE_WIDTH tiles fit the minimum width only at the minimum gutter (5 × 160 + 4 × 24 = 896 = 960 − 2 × 32) — the fan gap for five (104) would overflow, so the gap shrinks rather than the row wrapping.
    const five = Array.from({ length: 5 }, (_, i) => `n${String(i)}`);
    const layout = computeContextDiagramLayout('hub', five, [], MIN_DIAGRAM_WIDTH);
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
    expect(layout.rows[0]?.gap).toBeLessThan(fanGapFor(5));
    expect(layout.rows[0]?.gap).toBeGreaterThanOrEqual(24);
    for (const tile of layout.internalNeighbours) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(layout.width);
    }
  });

  it('with no edges at all, every neighbour still lands in one plain fanned row, sorted by id', () => {
    const layout = computeContextDiagramLayout('hub', ['n3', 'n1', 'n2'], []);
    expect(layout.internalNeighbours).toHaveLength(3);
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
    expect([...layout.internalNeighbours].sort((a, b) => a.x - b.x).map((t) => t.elementId)).toEqual(['n1', 'n2', 'n3']);
  });
});

describe('spreadAlong', () => {
  it('places count attach points evenly inside a span, never on its ends', () => {
    expect(spreadAlong(0, 100, 0, 1)).toBe(50);
    expect([0, 1, 2].map((i) => spreadAlong(0, 100, i, 3))).toEqual([25, 50, 75]);
  });
});

describe('SAP PM context fixture — the standing density case (fixtures/sapContext.ts)', () => {
  const inputs = scenarioLayoutInputs();
  const layout = pmLayout(1280);
  const measure = fixedWidthMeasurer(6);

  it('is the scenario the fixture describes: 4 internal neighbours with 1–2 flows each, 1 external actor', () => {
    expect(inputs.internal).toHaveLength(4);
    expect(inputs.external).toHaveLength(1);
    for (const neighbour of PM_CONTEXT_SCENARIO.neighbours.filter((n) => !n.isExternal)) {
      expect(neighbour.flows.length).toBeGreaterThanOrEqual(1);
      expect(neighbour.flows.length).toBeLessThanOrEqual(2);
    }
    expect(layout.edges).toHaveLength(inputs.edges.length);
  });

  it('places all four internal neighbours in one fanned row at the four-neighbour gap, with no two tiles overlapping', () => {
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
    expect(layout.rows[0]?.gap).toBe(fanGapFor(4));
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

  it('gives every laned edge its own lane, LANE_PITCH apart, and every edge its own attach point at both ends (rework item 2: no two edges share a segment)', () => {
    const laned = layout.edges.filter((e) => e.lane !== null);
    expect(laned.length).toBeGreaterThan(0);
    expect(new Set(laned.map((e) => e.lane)).size).toBe(laned.length);
    // The top-channel horizontal is always the segment that ends at the hub attach point — its y is the lane, whichever row the edge started from.
    const laneYs = laned.map((e) => e.points[e.points.length - 2]?.y ?? NaN).sort((a, b) => a - b);
    for (let i = 1; i < laneYs.length; i++) expect((laneYs[i] ?? 0) - (laneYs[i - 1] ?? 0)).toBeCloseTo(LANE_PITCH);
    const hubAttach = layout.edges.map((e) => `${String(e.hubAnchor.x)} ${String(e.hubAnchor.y)}`);
    expect(new Set(hubAttach).size).toBe(hubAttach.length);
    const neighbourAttach = layout.edges.map((e) => `${String(e.neighbourAnchor.x)} ${String(e.neighbourAnchor.y)}`);
    expect(new Set(neighbourAttach).size).toBe(neighbourAttach.length);
  });

  it('no edge segment passes through the interior of any tile (the external actor rises outside the internal row)', () => {
    const rects = allRects(layout);
    for (const edge of layout.edges) {
      for (const [a, b] of segmentsOf(edge)) {
        for (const rect of rects) expect(segmentCrossesInterior(a, b, rect)).toBe(false);
      }
    }
    const ofgem = layout.edges.find((e) => e.neighbourId === 'ofgem');
    expect(ofgem?.points.length).toBe(6);
  });

  it("every edge's lanes sit above its own neighbour's label stack, never through it", () => {
    for (const edge of layout.edges) {
      const row = layout.rows.find((r) => r.tileIds.includes(edge.neighbourId));
      const stackTop = Math.min(...layout.edges.filter((e) => e.neighbourId === edge.neighbourId).map((e) => e.labelAnchor.y)) - 15;
      for (const p of edge.points.slice(1, -1)) {
        if (p.x !== edge.neighbourAnchor.x || p.y !== edge.labelAnchor.y) expect(p.y).toBeLessThanOrEqual(stackTop);
      }
      expect(row).toBeDefined();
    }
  });

  it('places every label on its own edge, inside its own tile span, with no two pills and no pill/tile colliding at 1280 (rework item 3)', () => {
    const pills = placeEdgeLabels(layout.edges, measure);
    expect(pills).toHaveLength(layout.edges.length);
    for (const pill of pills) {
      const edge = layout.edges.find((e) => e.id === pill.edgeId);
      if (!edge) throw new Error('pill without an edge');
      const rect = pillRect(pill);
      // The leader (the edge's own drop) passes through the pill.
      expect(rect.left).toBeLessThanOrEqual(edge.neighbourAnchor.x);
      expect(rect.right).toBeGreaterThanOrEqual(edge.neighbourAnchor.x);
      expect(rect.left).toBeGreaterThanOrEqual(edge.labelAnchor.minX - 0.001);
      expect(rect.right).toBeLessThanOrEqual(edge.labelAnchor.maxX + 0.001);
      // Just above the neighbour tile it leaves.
      const tile = allTilesOf(layout).find((t) => t.elementId === edge.neighbourId);
      expect(rect.bottom).toBeLessThanOrEqual(tile?.y ?? 0);
    }
    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i];
        const b = pills[j];
        if (a && b) expect(rectsOverlap(pillRect(a), pillRect(b))).toBe(false);
      }
    }
    expect(edgeLabelsCollide(pills, allTilesOf(layout))).toBe(false);
  });

  it('still routes cleanly at the minimum width, with labels wrapping rather than the layout degrading', () => {
    const narrow = pmLayout(MIN_DIAGRAM_WIDTH);
    const rects = allRects(narrow);
    for (const edge of narrow.edges) {
      for (const [a, b] of segmentsOf(edge)) {
        for (const rect of rects) expect(segmentCrossesInterior(a, b, rect)).toBe(false);
      }
    }
    const pills = placeEdgeLabels(narrow.edges, measure);
    expect(pills.some((p) => p.lines.length === 2)).toBe(true);
    expect(edgeLabelsCollide(pills, allTilesOf(narrow))).toBe(false);
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
    const layout = computeContextDiagramLayout('hub', ['n1'], [], 1280, [{ id: 'e', neighbourId: 'n1', arrowAtHub: true, label: '⇢ submits reconciliation and payroll adjustment records to the central ledger' }]);
    const [pill] = placeEdgeLabels(layout.edges, measure);
    expect(pill?.lines).toHaveLength(2);
    expect(pill?.width).toBeLessThanOrEqual((layout.edges[0]?.labelAnchor.maxX ?? 0) - (layout.edges[0]?.labelAnchor.minX ?? 0) + 0.001);
    const wide = fixedWidthMeasurer(40);
    const [big] = placeEdgeLabels(layout.edges, wide);
    expect(big?.lines.every((l) => l.length > 0)).toBe(true);
    expect(big?.lines.some((l) => l.endsWith('…'))).toBe(true);
  });

  it('skips an edge with a blank label', () => {
    const layout = computeContextDiagramLayout('hub', ['n1'], [], 1280, [{ id: 'e', neighbourId: 'n1', arrowAtHub: true, label: '   ' }]);
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

describe('edgeNear (hover/tap-to-reveal, rework item 4)', () => {
  const layout = pmLayout(1280);

  it('finds the edge whose polyline passes within tolerance of a point, and nothing for a point in open space', () => {
    const edge = layout.edges[0];
    if (!edge) throw new Error('expected an edge');
    const [a, b] = segmentsOf(edge)[0] ?? [];
    if (!a || !b) throw new Error('expected a segment');
    const mid = { x: (a.x + b.x) / 2 + 2, y: (a.y + b.y) / 2 };
    expect(edgeNear(layout.edges, mid, 6)?.id).toBe(edge.id);
    expect(edgeNear(layout.edges, { x: -500, y: -500 }, 6)).toBeNull();
  });

  it('prefers the nearest edge when two are within tolerance', () => {
    const laned = layout.edges.filter((e) => e.lane !== null).sort((p, q) => (p.lane ?? 0) - (q.lane ?? 0));
    const first = laned[0];
    const second = laned[1];
    if (!first || !second) throw new Error('expected two laned edges');
    const y0 = first.points[1]?.y ?? 0;
    const x = Math.max(Math.min(first.points[1]?.x ?? 0, first.points[2]?.x ?? 0), Math.min(second.points[1]?.x ?? 0, second.points[2]?.x ?? 0)) + 1;
    expect(edgeNear(layout.edges, { x, y: y0 + 1 }, LANE_PITCH)?.id).toBe(first.id);
  });
});
