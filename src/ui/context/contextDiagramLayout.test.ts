import { describe, expect, it } from 'vitest';
import { allTilesOf, anchorFor, computeContextDiagramLayout, MODULE_WIDTH, type DiagramUnitInput } from './contextDiagramLayout';
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
    const anchor = anchorFor(layout.hub, 'fi');
    expect(anchor.isPlatformFallback).toBe(false);
    const fiModule = layout.hub.modules?.find((m) => m.elementId === 'fi');
    expect(anchor.x).toBeCloseTo((fiModule?.x ?? 0) + MODULE_WIDTH / 2);
  });

  it('falls back to the platform tile\'s own centre, flagged, when the edge endpoint is the platform itself', () => {
    const layout = computeContextDiagramLayout(unit('sap', [{ elementId: 'fi', capabilityName: 'Finance' }]), [], []);
    const anchor = anchorFor(layout.hub, 'sap');
    expect(anchor.isPlatformFallback).toBe(true);
  });

  it('is never flagged as a platform fallback for a plain (no-module) tile', () => {
    const layout = computeContextDiagramLayout(unit('hub'), [], []);
    const anchor = anchorFor(layout.hub, 'hub');
    expect(anchor.isPlatformFallback).toBe(false);
  });
});
