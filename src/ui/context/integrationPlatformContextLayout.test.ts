import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, NODE_WIDTH } from '../landscape/layout';
import { allPlatformFlowTilesOf, computeIntegrationPlatformContextLayout, type PlatformFlowEdgeInput, type PlatformFlowTile } from './integrationPlatformContextLayout';

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function tileRect(t: PlatformFlowTile): Rect {
  return { left: t.x, right: t.x + t.w, top: t.y, bottom: t.y + t.h };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('computeIntegrationPlatformContextLayout', () => {
  it('places the hub between the source and target columns, both at fixed x for their own column', () => {
    const layout = computeIntegrationPlatformContextLayout('hub', ['a'], ['b'], []);
    expect(layout.sources[0]?.x).toBeLessThan(layout.hub.x);
    expect(layout.targets[0]?.x).toBeGreaterThan(layout.hub.x + layout.hub.w);
  });

  it('the Playwright fixture: two sources sharing one target, both edges routed through the hub', () => {
    const edges: PlatformFlowEdgeInput[] = [
      { id: 'e1', sourceId: 'a', targetId: 'b', verbLabel: 'reads billing records from', classificationLabel: null, crossesBoundary: false },
      { id: 'e2', sourceId: 'c', targetId: 'b', verbLabel: 'writes invoices to', classificationLabel: null, crossesBoundary: false },
    ];
    const layout = computeIntegrationPlatformContextLayout('m', ['a', 'c'], ['b'], edges);

    expect(layout.sources.map((t) => t.elementId)).toEqual(['a', 'c']);
    expect(layout.targets.map((t) => t.elementId)).toEqual(['b']);
    expect(layout.edges).toHaveLength(2);

    // Every edge's own source segment starts at its own source tile's
    // right edge and ends on the hub's left edge; the target segment
    // starts on the hub's right edge and ends at the shared target tile's
    // left edge.
    for (const edge of layout.edges) {
      const sourceTile = layout.sources.find((t) => t.elementId === edge.sourceId);
      const targetTile = layout.targets.find((t) => t.elementId === edge.targetId);
      if (!sourceTile || !targetTile) throw new Error('expected both a source and a target tile');
      expect(edge.sourceSegment[0]).toEqual({ x: sourceTile.x + NODE_WIDTH, y: expect.any(Number) });
      expect(edge.sourceSegment.at(-1)?.x).toBe(layout.hub.x);
      expect(edge.targetSegment[0]?.x).toBe(layout.hub.x + layout.hub.w);
      expect(edge.targetSegment.at(-1)).toEqual({ x: targetTile.x, y: expect.any(Number) });
    }

    // Both edges attach to the hub at distinct points on each side —
    // spread, not stacked on top of each other.
    const leftYs = layout.edges.map((e) => e.sourceSegment.at(-1)?.y);
    const rightYs = layout.edges.map((e) => e.targetSegment[0]?.y);
    expect(new Set(leftYs).size).toBe(2);
    expect(new Set(rightYs).size).toBe(2);

    // Labels are attached: the verb label sits on the source→hub segment, the classification chip on the hub→target segment.
    const e1 = layout.edges.find((e) => e.id === 'e1');
    const sourceA = layout.sources.find((t) => t.elementId === 'a');
    if (!e1 || !sourceA) throw new Error('expected edge e1 and source a to exist');
    expect(e1.verbLabel).toBe('reads billing records from');
    expect(e1.verbLabelAnchor.x).toBeGreaterThan(sourceA.x);
    expect(e1.verbLabelAnchor.x).toBeLessThan(layout.hub.x);
  });

  it('is deterministic: the same input twice produces an identical layout', () => {
    const edges: PlatformFlowEdgeInput[] = [{ id: 'e1', sourceId: 'a', targetId: 'b', verbLabel: 'uses', classificationLabel: 'internal', crossesBoundary: true }];
    const first = computeIntegrationPlatformContextLayout('m', ['a'], ['b'], edges);
    const second = computeIntegrationPlatformContextLayout('m', ['a'], ['b'], edges);
    expect(first).toEqual(second);
  });

  it('carries the classification label and boundary-crossing flag straight through onto the routed edge', () => {
    const edges: PlatformFlowEdgeInput[] = [{ id: 'e1', sourceId: 'a', targetId: 'b', verbLabel: 'flows to', classificationLabel: 'restricted', crossesBoundary: true }];
    const layout = computeIntegrationPlatformContextLayout('m', ['a'], ['b'], edges);
    expect(layout.edges[0]?.classificationLabel).toBe('restricted');
    expect(layout.edges[0]?.crossesBoundary).toBe(true);
  });

  it('drops an edge whose source or target never made it into either column (named by the edge but not resolved)', () => {
    const edges: PlatformFlowEdgeInput[] = [{ id: 'e1', sourceId: 'missing', targetId: 'b', verbLabel: 'uses', classificationLabel: null, crossesBoundary: false }];
    const layout = computeIntegrationPlatformContextLayout('m', [], ['b'], edges);
    expect(layout.edges).toHaveLength(0);
  });

  it('never overlaps two tiles in the same column, however many share it', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const layout = computeIntegrationPlatformContextLayout('m', ids, [], []);
    for (let i = 0; i < layout.sources.length; i += 1) {
      for (let j = i + 1; j < layout.sources.length; j += 1) {
        const a = layout.sources[i];
        const b = layout.sources[j];
        if (!a || !b) throw new Error('expected two source tiles');
        expect(rectsOverlap(tileRect(a), tileRect(b))).toBe(false);
      }
    }
  });

  it('centres the hub vertically on the taller of the two columns', () => {
    const layout = computeIntegrationPlatformContextLayout('m', ['a', 'b', 'c'], ['x'], []);
    const sourcesTop = Math.min(...layout.sources.map((t) => t.y));
    const sourcesBottom = Math.max(...layout.sources.map((t) => t.y + t.h));
    const hubCentre = layout.hub.y + layout.hub.h / 2;
    expect(hubCentre).toBeCloseTo((sourcesTop + sourcesBottom) / 2, 5);
  });

  it('allPlatformFlowTilesOf returns the hub plus every source and target tile', () => {
    const layout = computeIntegrationPlatformContextLayout('m', ['a'], ['b', 'c'], []);
    expect(allPlatformFlowTilesOf(layout).map((t) => t.elementId).sort()).toEqual(['a', 'b', 'c', 'm'].sort());
  });

  it('handles a hub with no flows at all — a valid, edgeless layout', () => {
    const layout = computeIntegrationPlatformContextLayout('m', [], [], []);
    expect(layout.sources).toEqual([]);
    expect(layout.targets).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.hub.h).toBe(NODE_HEIGHT);
  });
});
