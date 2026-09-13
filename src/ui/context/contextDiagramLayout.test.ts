import { describe, expect, it } from 'vitest';
import { allTilesOf, anchorFor, computeContextDiagramLayout, MODULE_WIDTH, type DiagramTile, type DiagramUnitInput } from './contextDiagramLayout';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';

function unit(elementId: string, modules: { elementId: string; capabilityName: string | null }[] = []): DiagramUnitInput {
  return { elementId, modules };
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
  it('anchors to a specific module sub-tile when the edge endpoint names that module', () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }, { elementId: 'pm', capabilityName: null }]), [], []);
    const towards = { x: layout.hub.x + layout.hub.w / 2, y: layout.hub.y + layout.hub.h + 200 };
    const anchor = anchorFor(layout.hub, 'fi', towards);
    expect(anchor.isPlatformFallback).toBe(false);
    const fiModule = layout.hub.modules?.find((m) => m.elementId === 'fi');
    expect(anchor.x).toBeCloseTo((fiModule?.x ?? 0) + MODULE_WIDTH / 2);
  });

  it('falls back to a point on the platform tile\'s own boundary, flagged, when the edge endpoint is the platform itself — V1 fix: never the tile\'s interior centre, which used to draw the line and marker through the module row', () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]), [], []);
    const towards = { x: layout.hub.x + layout.hub.w / 2, y: layout.hub.y + layout.hub.h + 200 };
    const anchor = anchorFor(layout.hub, 'sap', towards);
    expect(anchor.isPlatformFallback).toBe(true);
    // On the tile's own bottom edge (facing `towards`, which sits straight below), not its interior centre.
    expect(anchor.y).toBeCloseTo(layout.hub.y + layout.hub.h);
    expect(anchor.x).toBeCloseTo(layout.hub.x + layout.hub.w / 2);
  });

  it('is never flagged as a platform fallback for a plain (no-module) tile', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    const towards = { x: layout.hub.x + layout.hub.w + 200, y: layout.hub.y };
    const anchor = anchorFor(layout.hub, 'hub', towards);
    expect(anchor.isPlatformFallback).toBe(false);
  });
});
