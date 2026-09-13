import { describe, expect, it } from 'vitest';
import { allTilesOf, anchorFor, computeContextDiagramLayout, curveBetween, MIN_DIAGRAM_WIDTH, MODULE_WIDTH, resolveEdgeLabelOverlaps, tileTopAnchor, type DiagramTile, type DiagramUnitInput, type EdgeLabelPlacement, type ResolvedEdgeLabel } from './contextDiagramLayout';
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

function unit(elementId: string, modules: { elementId: string; capabilityName: string | null }[] = []): DiagramUnitInput {
  return { elementId, modules };
}

/** Two axis-aligned rects overlap on both axes at once — the exact "same box" bug report's own failure condition. */
function tilesOverlap(a: DiagramTile | undefined, b: DiagramTile | undefined): boolean {
  if (!a || !b) throw new Error('expected both tiles to exist');
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('computeContextDiagramLayout', () => {
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

  it('the hub is horizontally centred within the diagram width', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    const hubCentre = layout.hub.x + layout.hub.w / 2;
    expect(hubCentre).toBeCloseTo(layout.width / 2, 0);
  });

  it('the boundary encloses the hub and internal neighbours, external neighbours sit below it', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('internal-1')], [unit('external-1')]);
    expect(layout.boundary.top).toBeLessThanOrEqual(layout.hub.y);
    expect(layout.boundary.bottom).toBeGreaterThanOrEqual((layout.internalNeighbours[0]?.y ?? 0) + NODE_HEIGHT);
    expect(layout.externalNeighbours[0]?.y ?? 0).toBeGreaterThan(layout.boundary.bottom);
  });

  it('wraps a row onto a second line when tiles would overflow the available width', () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`n${String(i)}`));
    const layout = computeContextDiagramLayout(unit('hub'), many, [], 960);
    const rowYs = new Set(layout.internalNeighbours.map((t) => t.y));
    expect(rowYs.size).toBeGreaterThan(1);
  });

  it('a wider diagram width fits more tiles per row than the minimum floor', () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`n${String(i)}`));
    const narrow = computeContextDiagramLayout(unit('hub'), many, [], 960);
    const wide = computeContextDiagramLayout(unit('hub'), many, [], 2400);
    const narrowRows = new Set(narrow.internalNeighbours.map((t) => t.y)).size;
    const wideRows = new Set(wide.internalNeighbours.map((t) => t.y)).size;
    expect(wideRows).toBeLessThan(narrowRows);
  });

  it('is deterministic — the same inputs always produce the same layout', () => {
    const a = computeContextDiagramLayout(unit('hub', [{ elementId: 'fi', capabilityName: 'Finance' }]), [unit('n1'), unit('n2')], []);
    const b = computeContextDiagramLayout(unit('hub', [{ elementId: 'fi', capabilityName: 'Finance' }]), [unit('n1'), unit('n2')], []);
    expect(a).toEqual(b);
  });

  it('has no minimum floor smaller than MIN_DIAGRAM_WIDTH even with a narrower hint', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], [], 400);
    expect(layout.width).toBeGreaterThanOrEqual(960);
  });

  it('V1 fix, "centre-weighted layout": a short row of neighbours is centred within the diagram width, not left-hugging', () => {
    // Three plain tiles: nowhere near enough to fill a 960px-wide row, so
    // the old left-packed behaviour would start them flush at PADDING.
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1'), unit('n2'), unit('n3')], []);
    const row = layout.internalNeighbours;
    const leftEdge = Math.min(...row.map((t) => t.x));
    const rightEdge = Math.max(...row.map((t) => t.x + t.w));
    const rowCentre = (leftEdge + rightEdge) / 2;
    expect(rowCentre).toBeCloseTo(layout.width / 2, 0);
    // The old behaviour: left-hugging at PADDING (32) — confirm this isn't it.
    expect(leftEdge).toBeGreaterThan(32);
  });

  it('centre-weighted layout still wraps and centres each row independently when neighbours overflow one row', () => {
    const many = Array.from({ length: 20 }, (_, i) => unit(`n${String(i)}`));
    const layout = computeContextDiagramLayout(unit('hub'), many, [], 960);
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
    const layout = computeContextDiagramLayout(unit('hub'), [unit('internal-1')], [unit('external-1')]);
    const ids = allTilesOf(layout).map((t) => t.elementId);
    expect(ids).toEqual(expect.arrayContaining(['hub', 'internal-1', 'external-1']));
    expect(ids).toHaveLength(3);
  });
});

describe('anchorFor', () => {
  it("anchors to a specific module sub-tile's own bottom edge when the edge endpoint names that module — V1 polish: \"entering module tiles from below\"", () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: null }]), [], []);
    const anchor = anchorFor(layout.hub, 'fi');
    expect(anchor.isPlatformFallback).toBe(false);
    const fiModule = layout.hub.modules?.find((m) => m.elementId === 'fi');
    expect(anchor.x).toBeCloseTo((fiModule?.x ?? 0) + MODULE_WIDTH / 2);
    expect(anchor.y).toBeCloseTo((fiModule?.y ?? 0) + (fiModule?.h ?? 0));
  });

  it("falls back to the platform tile's own bottom edge, flagged, when the edge endpoint is the platform itself", () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]), [], []);
    const anchor = anchorFor(layout.hub, 'sap');
    expect(anchor.isPlatformFallback).toBe(true);
    expect(anchor.y).toBeCloseTo(layout.hub.y + layout.hub.h);
    expect(anchor.x).toBeCloseTo(layout.hub.x + layout.hub.w / 2);
  });

  it("is never flagged as a platform fallback for a plain (no-module) tile, and still anchors at its own bottom edge", () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    const anchor = anchorFor(layout.hub, 'hub');
    expect(anchor.isPlatformFallback).toBe(false);
    expect(anchor.y).toBeCloseTo(layout.hub.y + layout.hub.h);
  });
});

describe('tileTopAnchor', () => {
  it("V1 polish, \"leaving neighbours from above\": anchors at a tile's own top-centre", () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1')], []);
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

  it('collapses to a dead-straight vertical line when lower and upper already share an x (the common case: a neighbour column-aligned under its own module)', () => {
    const lower = { x: 150, y: 400 };
    const upper = { x: 150, y: 200 };
    const curve = curveBetween(lower, upper);
    expect(curve.cp1.x).toBe(150);
    expect(curve.cp2.x).toBe(150);
    expect(curve.mid.x).toBe(150);
  });
});

describe('layoutNeighbourBand (via computeContextDiagramLayout)', () => {
  it('V1 polish, "neighbour columns spaced beneath the module they connect to": a neighbour attached to a module is centred directly under that module, not packed into a generic wrapped row', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: 'Asset Management' }]);
    const n1 = { ...unit('n1'), attachedToModuleId: 'pm' };
    const layout = computeContextDiagramLayout(sap, [n1], []);
    const pmModule = layout.hub.modules?.find((m) => m.elementId === 'pm');
    const n1Tile = layout.internalNeighbours.find((t) => t.elementId === 'n1');
    expect(n1Tile).toBeDefined();
    expect(n1Tile?.x).toBeCloseTo((pmModule?.x ?? 0) + (pmModule?.w ?? 0) / 2 - (n1Tile?.w ?? 0) / 2);
  });

  it('stacks two neighbours attached to the same module vertically, both still centred under it', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]);
    const n1 = { ...unit('n1'), attachedToModuleId: 'fi' };
    const n2 = { ...unit('n2'), attachedToModuleId: 'fi' };
    const layout = computeContextDiagramLayout(sap, [n1, n2], []);
    const fiModule = layout.hub.modules?.find((m) => m.elementId === 'fi');
    const t1 = layout.internalNeighbours.find((t) => t.elementId === 'n1');
    const t2 = layout.internalNeighbours.find((t) => t.elementId === 'n2');
    expect(t1?.x).toBeCloseTo(t2?.x ?? 0);
    expect(t1?.x).toBeCloseTo((fiModule?.x ?? 0) + (fiModule?.w ?? 0) / 2 - (t1?.w ?? 0) / 2);
    expect(t1?.y).not.toBeCloseTo(t2?.y ?? 0);
  });

  it('an unattached neighbour still lays out via the centre-weighted band, below any module columns, never overlapping them', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]);
    const attached = { ...unit('n1'), attachedToModuleId: 'fi' };
    const unattached = unit('n2'); // no attachedToModuleId — e.g. an edge straight to the platform itself
    const layout = computeContextDiagramLayout(sap, [attached, unattached], []);
    const attachedTile = layout.internalNeighbours.find((t) => t.elementId === 'n1');
    const unattachedTile = layout.internalNeighbours.find((t) => t.elementId === 'n2');
    expect(attachedTile).toBeDefined();
    expect(unattachedTile).toBeDefined();
    // The unattached tile never occupies the same y-band as the attached column's own tile.
    const overlapsVertically = (attachedTile?.y ?? 0) < (unattachedTile?.y ?? 0) + (unattachedTile?.h ?? 0) && (unattachedTile?.y ?? 0) < (attachedTile?.y ?? 0) + (attachedTile?.h ?? 0);
    expect(overlapsVertically).toBe(false);
  });

  it('with no hub modules at all, every neighbour is unattached and this reduces to the plain centre-weighted band — no regression for an ordinary (non-platform) hub', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [unit('n1'), unit('n2'), unit('n3')], []);
    expect(layout.internalNeighbours).toHaveLength(3);
    const ys = new Set(layout.internalNeighbours.map((t) => t.y));
    expect(ys.size).toBe(1); // one plain row, same as before this polish
  });

  it('bug fix: two neighbours attached to adjacent modules never overlap, even though modules sit far closer together (MODULE_WIDTH + gutter, 80px) than a neighbour tile is wide (NODE_WIDTH, 160px) — the exact geometry that produced "two neighbours render in the same box and their labels concatenate"', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: 'Asset Management' }]);
    const graphicalDesignTool = { ...unit('graphical-design-tool'), attachedToModuleId: 'fi' };
    const crm = { ...unit('crm'), attachedToModuleId: 'pm' };
    const layout = computeContextDiagramLayout(sap, [graphicalDesignTool, crm], []);
    const t1 = layout.internalNeighbours.find((t) => t.elementId === 'graphical-design-tool');
    const t2 = layout.internalNeighbours.find((t) => t.elementId === 'crm');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(tilesOverlap(t1, t2)).toBe(false);
    // Each is its own single-member column (index 0), so a real fix keeps
    // them on the same row — the overlap this test guards against is
    // purely horizontal, not resolved by accidentally landing on different rows.
    expect(t1?.y).toBeCloseTo(t2?.y ?? 0);
  });

  it('bug fix, three or more neighbours across adjacent modules: every column is pairwise non-overlapping, and left-to-right module order is preserved', () => {
    const sap = unit('sap', [
      { elementId: 'fi', capabilityName: 'Finance' },
      { elementId: 'pm', capabilityName: 'Asset Management' },
      { elementId: 'mm', capabilityName: 'Spend Control' },
    ]);
    const neighbours = [
      { ...unit('a'), attachedToModuleId: 'fi' },
      { ...unit('b'), attachedToModuleId: 'pm' },
      { ...unit('c'), attachedToModuleId: 'mm' },
    ];
    const layout = computeContextDiagramLayout(sap, neighbours, []);
    const tiles = ['a', 'b', 'c'].map((id) => layout.internalNeighbours.find((t) => t.elementId === id));
    for (const tile of tiles) expect(tile).toBeDefined();
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(tilesOverlap(tiles[i], tiles[j])).toBe(false);
      }
    }
    expect(tiles[0]?.x ?? 0).toBeLessThanOrEqual(tiles[1]?.x ?? 0);
    expect(tiles[1]?.x ?? 0).toBeLessThanOrEqual(tiles[2]?.x ?? 0);
  });

  it('bug fix: two neighbours on the same module stack vertically with zero overlap, never the horizontal-overlap bug', () => {
    const sap = unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]);
    const n1 = { ...unit('n1'), attachedToModuleId: 'fi' };
    const n2 = { ...unit('n2'), attachedToModuleId: 'fi' };
    const layout = computeContextDiagramLayout(sap, [n1, n2], []);
    const t1 = layout.internalNeighbours.find((t) => t.elementId === 'n1');
    const t2 = layout.internalNeighbours.find((t) => t.elementId === 'n2');
    expect(tilesOverlap(t1, t2)).toBe(false);
    expect(t1?.x).toBeCloseTo(t2?.x ?? 0); // same column
    expect(t1?.y).not.toBeCloseTo(t2?.y ?? 0); // different rows within it
  });

  it("the diagram's own width grows to keep every resolved column inside the boundary, when several adjacent modules each have their own attached neighbour", () => {
    const sap = unit('sap', [
      { elementId: 'fi', capabilityName: 'Finance' },
      { elementId: 'pm', capabilityName: 'Asset Management' },
      { elementId: 'mm', capabilityName: 'Spend Control' },
      { elementId: 'co', capabilityName: 'Compliance' },
      { elementId: 'ps', capabilityName: 'Estates' },
    ]);
    const neighbours = ['fi', 'pm', 'mm', 'co', 'ps'].map((moduleId, i) => ({ ...unit(`n${String(i)}`), attachedToModuleId: moduleId }));
    const layout = computeContextDiagramLayout(sap, neighbours, [], MIN_DIAGRAM_WIDTH);
    for (const tile of layout.internalNeighbours) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(layout.width);
    }
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

  it("bug fix, \"two neighbours connected to adjacent modules with 25+ character verbs\": two labels starting at the same y, close together in x (adjacent-module spacing), push apart and never overlap", () => {
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
