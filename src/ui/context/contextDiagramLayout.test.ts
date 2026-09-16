import { describe, expect, it } from 'vitest';
import { allTilesOf, computeContextDiagramLayout, curveBetween, hubBottomAnchor, MIN_DIAGRAM_WIDTH, resolveEdgeLabelOverlaps, tileTopAnchor, type DiagramTile, type EdgeLabelPlacement, type ResolvedEdgeLabel } from './contextDiagramLayout';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

/** A fixed-width-per-character stand-in for `ctx.measureText(text).width` — deterministic and easy to reason about (e.g. "reads customer records from" at 7px/char is 196px), unlike a real font's own kerning-dependent metrics. */
function fixedWidthMeasurer(pxPerChar: number): (text: string) => number {
  return (text) => text.length * pxPerChar;
}

/** Two axis-aligned rects (pill bounding boxes, centre + size) overlap on both axes at once. */
function pillsOverlap(a: ResolvedEdgeLabel, b: ResolvedEdgeLabel): boolean {
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  const aTop = a.y - a.height / 2;
  const aBottom = a.y + a.height / 2;
  const bTop = b.y - b.height / 2;
  const bBottom = b.y + b.height / 2;
  return aLeft < bRight && bLeft < aRight && aTop < bBottom && bTop < aBottom;
}

describe('computeContextDiagramLayout', () => {
  it('the hub always gets the standard node size — V3 dropped the one case that widened it, a platform\'s own module row (PlatformStructureView.tsx has that now)', () => {
    const layout = computeContextDiagramLayout('hub', [], []);
    expect(layout.hub.w).toBe(NODE_WIDTH);
    expect(layout.hub.h).toBe(NODE_HEIGHT);
  });

  it('the hub is horizontally centred within the diagram width', () => {
    const layout = computeContextDiagramLayout('hub', [], []);
    const hubCentre = layout.hub.x + layout.hub.w / 2;
    expect(hubCentre).toBeCloseTo(layout.width / 2, 0);
  });

  it('the boundary encloses the hub and internal neighbours, external neighbours sit below it', () => {
    const layout = computeContextDiagramLayout('hub', ['internal-1'], ['external-1']);
    expect(layout.boundary.top).toBeLessThanOrEqual(layout.hub.y);
    expect(layout.boundary.bottom).toBeGreaterThanOrEqual((layout.internalNeighbours[0]?.y ?? 0) + NODE_HEIGHT);
    expect(layout.externalNeighbours[0]?.y ?? 0).toBeGreaterThan(layout.boundary.bottom);
  });

  it('wraps a row onto a second line when tiles would overflow the available width', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`);
    const layout = computeContextDiagramLayout('hub', many, [], 960);
    const rowYs = new Set(layout.internalNeighbours.map((t) => t.y));
    expect(rowYs.size).toBeGreaterThan(1);
  });

  it('a wider diagram width fits more tiles per row than the minimum floor', () => {
    const many = Array.from({ length: 20 }, (_, i) => `n${String(i)}`);
    const narrow = computeContextDiagramLayout('hub', many, [], 960);
    const wide = computeContextDiagramLayout('hub', many, [], 2400);
    const narrowRows = new Set(narrow.internalNeighbours.map((t) => t.y)).size;
    const wideRows = new Set(wide.internalNeighbours.map((t) => t.y)).size;
    expect(wideRows).toBeLessThan(narrowRows);
  });

  it('is deterministic — the same inputs always produce the same layout', () => {
    const a = computeContextDiagramLayout('hub', ['n1', 'n2'], []);
    const b = computeContextDiagramLayout('hub', ['n1', 'n2'], []);
    expect(a).toEqual(b);
  });

  it('has no minimum floor smaller than MIN_DIAGRAM_WIDTH even with a narrower hint', () => {
    const layout = computeContextDiagramLayout('hub', [], [], 400);
    expect(layout.width).toBeGreaterThanOrEqual(MIN_DIAGRAM_WIDTH);
  });

  it('V1 fix, "centre-weighted layout": a short row of neighbours is centred within the diagram width, not left-hugging', () => {
    // Three plain tiles: nowhere near enough to fill a 960px-wide row, so
    // the old left-packed behaviour would start them flush at PADDING.
    const layout = computeContextDiagramLayout('hub', ['n1', 'n2', 'n3'], []);
    const row = layout.internalNeighbours;
    const leftEdge = Math.min(...row.map((t) => t.x));
    const rightEdge = Math.max(...row.map((t) => t.x + t.w));
    const rowCentre = (leftEdge + rightEdge) / 2;
    expect(rowCentre).toBeCloseTo(layout.width / 2, 0);
    // The old behaviour: left-hugging at PADDING (32) — confirm this isn't it.
    expect(leftEdge).toBeGreaterThan(32);
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

describe('hubBottomAnchor', () => {
  it("anchors at the hub tile's own bottom-centre — every neighbour this diagram places sits below it", () => {
    const layout = computeContextDiagramLayout('hub', ['n1'], []);
    const anchor = hubBottomAnchor(layout.hub);
    expect(anchor).toEqual({ x: layout.hub.x + layout.hub.w / 2, y: layout.hub.y + layout.hub.h });
  });
});

describe('tileTopAnchor', () => {
  it("V1 polish, \"leaving neighbours from above\": anchors at a tile's own top-centre", () => {
    const layout = computeContextDiagramLayout('hub', ['n1'], []);
    const neighbour = layout.internalNeighbours[0];
    if (!neighbour) throw new Error('expected a neighbour tile');
    const anchor = tileTopAnchor(neighbour);
    expect(anchor).toEqual({ x: neighbour.x + neighbour.w / 2, y: neighbour.y });
  });
});

describe('curveBetween', () => {
  it("has vertical tangents at both ends (cp1 shares lower's x, cp2 shares upper's x)", () => {
    const lower = { x: 100, y: 300 };
    const upper = { x: 160, y: 200 };
    const curve = curveBetween(lower, upper);
    expect(curve.cp1.x).toBe(lower.x);
    expect(curve.cp2.x).toBe(upper.x);
    expect(curve.cp1.y).toBe(curve.cp2.y);
  });

  it("V1 polish, \"label pill on the free segment\": the midpoint always sits exactly halfway between lower.y and upper.y, regardless of x offset", () => {
    const lower = { x: 40, y: 400 };
    const upper = { x: 260, y: 120 };
    const curve = curveBetween(lower, upper);
    expect(curve.mid.y).toBeCloseTo((lower.y + upper.y) / 2);
    expect(curve.mid.x).toBeCloseTo((lower.x + upper.x) / 2);
  });

  it('collapses to a dead-straight vertical line when lower and upper already share an x', () => {
    const lower = { x: 150, y: 400 };
    const upper = { x: 150, y: 200 };
    const curve = curveBetween(lower, upper);
    expect(curve.cp1.x).toBe(150);
    expect(curve.cp2.x).toBe(150);
    expect(curve.mid.x).toBe(150);
  });
});

describe('resolveEdgeLabelOverlaps', () => {
  const measure = fixedWidthMeasurer(7);

  it('leaves a single label exactly where it started', () => {
    const [label] = resolveEdgeLabelOverlaps([{ text: 'reads customer records from', x: 100, y: 200, targetY: 260 }], measure, 1);
    expect(label?.x).toBe(100);
    expect(label?.y).toBe(200);
    expect(label?.lines).toEqual(['reads customer records from']);
  });

  it('leaves two labels alone when they are already far enough apart, in either axis', () => {
    const [a, b] = resolveEdgeLabelOverlaps(
      [
        { text: 'uses', x: 100, y: 200, targetY: 260 },
        { text: 'uses', x: 400, y: 200, targetY: 260 }, // same y band, far apart in x
      ],
      measure,
      1,
    );
    expect(a && b && pillsOverlap(a, b)).toBe(false);
  });

  it("bug fix, \"two neighbours with 25+ character verbs\": two labels starting at the same y, close together in x, push apart and never overlap", () => {
    const placements: EdgeLabelPlacement[] = [
      { text: 'sends billing events across the network to', x: 100, y: 200, targetY: 260 },
      { text: 'submits meter readings and settlement data to', x: 180, y: 200, targetY: 140 }, // pushes the opposite way (its own target is above)
    ];
    const resolved = resolveEdgeLabelOverlaps(placements, measure, 1);
    expect(resolved).toHaveLength(2);
    const [a, b] = resolved as [ResolvedEdgeLabel, ResolvedEdgeLabel];
    expect(pillsOverlap(a, b)).toBe(false);
    // The first label is never moved (nothing placed before it to collide
    // with) — only the second, later one in the caller's own array order.
    expect(a.x).toBe(100);
    expect(a.y).toBe(200);
  });

  it('pushes the later label vertically, toward its own target, before ever wrapping it', () => {
    const placements: EdgeLabelPlacement[] = [
      { text: 'uses', x: 100, y: 200, targetY: 260 },
      { text: 'uses', x: 106, y: 200, targetY: 260 }, // 6px apart in x — well under the 16px min gap, so this is a real collision
    ];
    const resolved = resolveEdgeLabelOverlaps(placements, measure, 1);
    const [a, b] = resolved as [ResolvedEdgeLabel, ResolvedEdgeLabel];
    expect(pillsOverlap(a, b)).toBe(false);
    expect(b.lines).toEqual(['uses']); // still one line — a short label always clears via push alone
    expect(b.y).toBeGreaterThan(200); // pushed down, toward its own targetY (260)
  });

  it('pushes toward a target above, not below, when the edge points the other way', () => {
    const placements: EdgeLabelPlacement[] = [
      { text: 'uses', x: 100, y: 200, targetY: 140 },
      { text: 'uses', x: 106, y: 200, targetY: 140 },
    ];
    const [, b] = resolveEdgeLabelOverlaps(placements, measure, 1);
    expect(b?.y).toBeLessThan(200);
  });

  it('wraps to two lines when two push attempts still leave a genuine collision — a label squeezed between two already-resolved ones directly above and below it, at the same x, so no amount of vertical pushing alone can clear both at once', () => {
    // A (fixed) and B (pushed down twice to clear A) end up
    // `LABEL_PUSH_STEP * 2` apart — exactly the gap two more push attempts
    // can close from either side, so C, starting between them, can clear
    // one but never both within its own two-attempt budget. Its wrap is
    // real (a shorter box than an unwrapped one would be); this
    // deliberately doesn't also assert C ends up clear of both neighbours
    // — `resolveEdgeLabelOverlaps`'s own doc comment is explicit that a
    // genuine vertical squeeze like this "isn't something more width can
    // fix anyway."
    const placements: EdgeLabelPlacement[] = [
      { text: 'uses', x: 100, y: 200, targetY: 260 },
      { text: 'uses', x: 100, y: 200, targetY: 260 },
      { text: 'submits settlement and reconciliation data to', x: 100, y: 200, targetY: 260 },
    ];
    const resolved = resolveEdgeLabelOverlaps(placements, measure, 1);
    const [, , c] = resolved as [ResolvedEdgeLabel, ResolvedEdgeLabel, ResolvedEdgeLabel];
    expect(c.lines.length).toBe(2);
    // Wrapping narrows the box (roughly half the one-line width) rather
    // than widening it.
    const oneLineWidth = measure(placements[2]?.text ?? '') + 12;
    expect(c.width).toBeLessThan(oneLineWidth);
  });

  it('is deterministic — the same inputs always produce the same result', () => {
    const placements: EdgeLabelPlacement[] = [
      { text: 'reads customer records from', x: 100, y: 200, targetY: 260 },
      { text: 'writes billing updates to', x: 130, y: 200, targetY: 260 },
      { text: 'flags overdue accounts to', x: 160, y: 200, targetY: 140 },
    ];
    const first = resolveEdgeLabelOverlaps(placements, measure, 1);
    const second = resolveEdgeLabelOverlaps(placements, measure, 1);
    expect(second).toEqual(first);
  });
});
