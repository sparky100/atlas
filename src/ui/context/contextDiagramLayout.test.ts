import { describe, expect, it } from 'vitest';
import {
  allTilesOf,
  anchorFor,
  computeContextDiagramLayout,
  edgeLabelsCollide,
  edgeNear,
  fanGapFor,
  LANE_PITCH,
  MIN_DIAGRAM_WIDTH,
  MODULE_WIDTH,
  placeEdgeLabels,
  spreadAlong,
  tileTopAnchor,
  truncateToWidth,
  type ContextDiagramLayout,
  type DiagramTile,
  type DiagramUnitInput,
  type EdgeLabelPill,
  type Point,
  type RoutedEdge,
} from './contextDiagramLayout';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';
import { SAP_CONTEXT_SCENARIO, scenarioLayoutInputs } from './fixtures/sapContext';

/** A fixed-width-per-character stand-in for `ctx.measureText(text).width / scale` — deterministic, unlike a real font's kerning. 6px/char is close to an 11px sans-serif at scale 1. */
function fixedWidthMeasurer(pxPerChar: number): (text: string) => number {
  return (text) => text.length * pxPerChar;
}

function unit(elementId: string, modules: { elementId: string; capabilityName: string | null }[] = [], attachedModuleIds?: string[]): DiagramUnitInput {
  return { elementId, modules, ...(attachedModuleIds ? { attachedModuleIds } : {}) };
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

/** Every obstacle rect: neighbour tiles, and the hub's module sub-tiles. A platform hub's own outer rect is not an obstacle — an edge into a module deliberately enters the platform's padding from below to reach the module's bottom edge ("entering module tiles from below"); a plain hub's rect is. */
function allRects(layout: ContextDiagramLayout): Rect[] {
  const hubRects = layout.hub.modules ? layout.hub.modules.map((m) => ({ left: m.x, right: m.x + m.w, top: m.y, bottom: m.y + m.h })) : [tileRect(layout.hub)];
  return [...hubRects, ...[...layout.internalNeighbours, ...layout.externalNeighbours].map(tileRect)];
}

/** The standing fixture (`fixtures/sapContext.ts`), laid out at a given width. */
function sapLayout(widthHint = 1280): ContextDiagramLayout {
  const inputs = scenarioLayoutInputs();
  return computeContextDiagramLayout(inputs.hub, inputs.internal, inputs.external, widthHint, inputs.edges);
}

describe('computeContextDiagramLayout — tiles', () => {
  it('a plain hub with no modules gets the standard node size', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    expect(layout.hub.w).toBe(NODE_WIDTH);
    expect(layout.hub.h).toBe(NODE_HEIGHT);
    expect(layout.hub.modules).toBeUndefined();
  });

  it('a platform hub widens to fit its own module row, and places each module inside its own bounds', () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: 'Asset Management' }]), [], []);
    expect(layout.hub.w).toBeGreaterThan(NODE_WIDTH);
    expect(layout.hub.modules).toHaveLength(2);
    for (const module of layout.hub.modules ?? []) {
      expect(module.x).toBeGreaterThanOrEqual(layout.hub.x);
      expect(module.x + module.w).toBeLessThanOrEqual(layout.hub.x + layout.hub.w);
      expect(module.y).toBeGreaterThanOrEqual(layout.hub.y);
      expect(module.y + module.h).toBeLessThanOrEqual(layout.hub.y + layout.hub.h);
    }
    expect(layout.hub.modules?.map((m) => m.capabilityName)).toEqual(['Finance', 'Asset Management']);
  });

  it('an 8-module platform tile fits every module at MODULE_WIDTH, a fixed gutter apart, none overlapping', () => {
    const modules = Array.from({ length: 8 }, (_, i) => ({ elementId: `m${String(i)}`, capabilityName: i === 0 ? 'Regulatory Compliance & Price-Control Reporting' : null }));
    const layout = computeContextDiagramLayout(unit('sap', modules), [], []);
    const placed = layout.hub.modules ?? [];
    expect(placed).toHaveLength(8);
    for (const module of placed) expect(module.w).toBe(MODULE_WIDTH);
    const sorted = [...placed].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i]?.x ?? 0) - ((sorted[i - 1]?.x ?? 0) + (sorted[i - 1]?.w ?? 0));
      expect(gap).toBeCloseTo(4);
      expect(tilesOverlap(sorted[i - 1], sorted[i])).toBe(false);
    }
  });

  it('the hub is horizontally centred within the diagram width', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    expect(layout.hub.x + layout.hub.w / 2).toBeCloseTo(layout.width / 2, 0);
  });

  it('the boundary encloses the hub and internal neighbours; external neighbours sit below it', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('internal-1')], [unit('external-1')]);
    expect(layout.boundary.top).toBeLessThanOrEqual(layout.hub.y);
    expect(layout.boundary.bottom).toBeGreaterThanOrEqual((layout.internalNeighbours[0]?.y ?? 0) + NODE_HEIGHT);
    expect(layout.externalNeighbours[0]?.y ?? 0).toBeGreaterThan(layout.boundary.bottom);
  });

  it('wraps onto a second row only when even the minimum gutter cannot fit every tile', () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`n${String(i)}`));
    const layout = computeContextDiagramLayout(unit('hub'), many, [], 960);
    const rowsUsed = new Set(layout.internalNeighbours.map((t) => t.y));
    expect(rowsUsed.size).toBeGreaterThan(1);
    expect(layout.rows.filter((r) => !r.external)).toHaveLength(rowsUsed.size);
  });

  it('a wider diagram fits more tiles per row than the minimum floor', () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`n${String(i)}`));
    const narrow = computeContextDiagramLayout(unit('hub'), many, [], 960);
    const wide = computeContextDiagramLayout(unit('hub'), many, [], 2400);
    expect(new Set(wide.internalNeighbours.map((t) => t.y)).size).toBeLessThan(new Set(narrow.internalNeighbours.map((t) => t.y)).size);
  });

  it('is deterministic — the same inputs always produce the same layout, routes included', () => {
    const inputs = scenarioLayoutInputs();
    const a = computeContextDiagramLayout(inputs.hub, inputs.internal, inputs.external, 1280, inputs.edges);
    const b = computeContextDiagramLayout(inputs.hub, inputs.internal, inputs.external, 1280, inputs.edges);
    expect(b).toEqual(a);
  });

  it('has no minimum floor smaller than MIN_DIAGRAM_WIDTH even with a narrower hint', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], [], 400);
    expect(layout.width).toBe(MIN_DIAGRAM_WIDTH);
  });

  it('a short row of neighbours is centred within the diagram width, not left-hugging', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1'), unit('n2'), unit('n3')], []);
    const left = Math.min(...layout.internalNeighbours.map((t) => t.x));
    const right = Math.max(...layout.internalNeighbours.map((t) => t.x + t.w));
    expect((left + right) / 2).toBeCloseTo(layout.width / 2, 0);
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
    const hub = unit('hub');
    const two = computeContextDiagramLayout(hub, [unit('a'), unit('b')], [], 1280);
    const five = computeContextDiagramLayout(hub, ['a', 'b', 'c', 'd', 'e'].map((id) => unit(id)), [], 1280);
    const gapOf = (layout: ContextDiagramLayout) => {
      const xs = [...layout.internalNeighbours].sort((p, q) => p.x - q.x);
      return (xs[1]?.x ?? 0) - ((xs[0]?.x ?? 0) + (xs[0]?.w ?? 0));
    };
    expect(gapOf(two)).toBe(fanGapFor(2));
    expect(gapOf(five)).toBe(fanGapFor(5));
    expect(gapOf(five)).toBeGreaterThan(gapOf(two));
    expect(five.rows[0]?.gap).toBe(fanGapFor(5));
  });

  it('orders neighbours by the centre of the hub modules they attach to, so a neighbour under FI sits left of one under PM, and one attached to both sits between', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: 'Asset Management' }, { elementId: 'bw', capabilityName: 'Reporting' }]);
    const neighbours = [unit('z-bw', [], ['bw']), unit('m-both', [], ['fi', 'bw']), unit('a-fi', [], ['fi'])];
    const layout = computeContextDiagramLayout(sap, neighbours, [], 1280);
    const xOf = (id: string) => layout.internalNeighbours.find((t) => t.elementId === id)?.x ?? NaN;
    expect(xOf('a-fi')).toBeLessThan(xOf('m-both'));
    expect(xOf('m-both')).toBeLessThan(xOf('z-bw'));
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
  });

  it('shrinks the gap toward the minimum gutter before wrapping when the fan would overflow', () => {
    const hub = unit('hub');
    // Five NODE_WIDTH tiles fit the minimum width only at the minimum gutter (5 × 160 + 4 × 24 = 896 = 960 − 2 × 32) — the fan gap for five (104) would overflow, so the gap shrinks rather than the row wrapping.
    const five = Array.from({ length: 5 }, (_, i) => unit(`n${String(i)}`));
    const layout = computeContextDiagramLayout(hub, five, [], MIN_DIAGRAM_WIDTH);
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
    expect(layout.rows[0]?.gap).toBeLessThan(fanGapFor(5));
    expect(layout.rows[0]?.gap).toBeGreaterThanOrEqual(24);
    for (const tile of layout.internalNeighbours) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(layout.width);
    }
  });

  it('with no hub modules at all, every neighbour is unattached and sits in one plain row', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1'), unit('n2'), unit('n3')], []);
    expect(layout.internalNeighbours).toHaveLength(3);
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
  });
});

describe('spreadAlong', () => {
  it('places count attach points evenly inside a span, never on its ends', () => {
    expect(spreadAlong(0, 100, 0, 1)).toBe(50);
    expect([0, 1, 2].map((i) => spreadAlong(0, 100, i, 3))).toEqual([25, 50, 75]);
  });
});

describe('anchorFor / tileTopAnchor', () => {
  it("anchors to a specific module sub-tile's own bottom edge when the endpoint names that module", () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: null }]), [], []);
    const fi = layout.hub.modules?.find((m) => m.elementId === 'fi');
    const anchor = anchorFor(layout.hub, 'fi');
    expect(anchor).toEqual({ x: (fi?.x ?? 0) + (fi?.w ?? 0) / 2, y: (fi?.y ?? 0) + (fi?.h ?? 0), isPlatformFallback: false });
  });

  it("falls back to the platform tile's own bottom edge, flagged, when the endpoint is the platform itself", () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]), [], []);
    const anchor = anchorFor(layout.hub, 'sap');
    expect(anchor.isPlatformFallback).toBe(true);
    expect(anchor.y).toBe(layout.hub.y + layout.hub.h);
  });

  it('is never flagged as a platform fallback for a plain (no-module) tile', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    expect(anchorFor(layout.hub, 'hub').isPlatformFallback).toBe(false);
  });

  it("tileTopAnchor is a tile's own top-centre", () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1')], []);
    const neighbour = layout.internalNeighbours[0];
    if (!neighbour) throw new Error('expected a neighbour tile');
    expect(tileTopAnchor(neighbour)).toEqual({ x: neighbour.x + neighbour.w / 2, y: neighbour.y });
  });
});

describe('SAP context fixture — the standing density case (fixtures/sapContext.ts)', () => {
  const inputs = scenarioLayoutInputs();
  const layout = sapLayout(1280);
  const measure = fixedWidthMeasurer(6);

  it('is the scenario the fixture describes: 8 modules, 5 internal neighbours with 2–4 flows each, 1 external actor', () => {
    expect(SAP_CONTEXT_SCENARIO.modules).toHaveLength(8);
    expect(inputs.internal).toHaveLength(5);
    expect(inputs.external).toHaveLength(1);
    for (const neighbour of SAP_CONTEXT_SCENARIO.neighbours.filter((n) => !n.isExternal)) {
      expect(neighbour.flows.length).toBeGreaterThanOrEqual(2);
      expect(neighbour.flows.length).toBeLessThanOrEqual(4);
    }
    expect(layout.edges).toHaveLength(inputs.edges.length);
    expect(layout.hub.modules).toHaveLength(8);
  });

  it('places all five internal neighbours in one fanned row at the five-neighbour gap, with no two tiles overlapping', () => {
    expect(new Set(layout.internalNeighbours.map((t) => t.y)).size).toBe(1);
    expect(layout.rows[0]?.gap).toBe(fanGapFor(5));
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

  it('no edge segment passes through the interior of any tile or module (the external actor rises outside the internal row)', () => {
    const rects = allRects(layout);
    for (const edge of layout.edges) {
      for (const [a, b] of segmentsOf(edge)) {
        for (const rect of rects) expect(segmentCrossesInterior(a, b, rect)).toBe(false);
      }
    }
    const ofgem = layout.edges.find((e) => e.neighbourId === 'ofgem');
    expect(ofgem?.points.length).toBe(6);
    expect(ofgem?.hubAnchor.isPlatformFallback).toBe(true);
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
    const narrow = sapLayout(MIN_DIAGRAM_WIDTH);
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
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]);
    const layout = computeContextDiagramLayout(sap, [unit('n1', [], ['fi'])], [], 1280, [{ id: 'e', neighbourId: 'n1', hubEndpointId: 'fi', arrowAtHub: true, label: '⇢ submits reconciliation and payroll adjustment records to the central ledger' }]);
    const [pill] = placeEdgeLabels(layout.edges, measure);
    expect(pill?.lines).toHaveLength(2);
    expect(pill?.width).toBeLessThanOrEqual((layout.edges[0]?.labelAnchor.maxX ?? 0) - (layout.edges[0]?.labelAnchor.minX ?? 0) + 0.001);
    const wide = fixedWidthMeasurer(40);
    const [big] = placeEdgeLabels(layout.edges, wide);
    expect(big?.lines.every((l) => l.length > 0)).toBe(true);
    expect(big?.lines.some((l) => l.endsWith('…'))).toBe(true);
  });

  it('skips an edge with a blank label', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1')], [], 1280, [{ id: 'e', neighbourId: 'n1', hubEndpointId: 'hub', arrowAtHub: true, label: '   ' }]);
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
  const layout = sapLayout(1280);

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
