/**
 * Sprint U4-2b item 9: "edges do not cross unrelated tiles." Canvas 2D has
 * no DOM for a test to inspect after the fact, so this exercises the exact
 * geometry `LandscapeCanvas.tsx` draws from — `computeLandscapeLayout` for
 * placement, `computeLandscapeChannels`/`routeLandscapeEdge` for the path —
 * directly, the same way `layout.test.ts` already does for placement alone.
 *
 * The property under test: for every possible (from, to) pair among a
 * layout's own nodes, the routed polyline never enters any *other* node's
 * tile — checked with `segmentCrossesRect`, the very primitive
 * `routeLandscapeEdge` itself uses to decide whether a straight line is
 * good enough. That's not circular: `routeLandscapeEdge` only checks the
 * *direct* line before choosing a route; this test re-checks the *actual
 * emitted* polyline (every one of its segments) against *every* other
 * node, including ones a channel-based detour could in principle still
 * clip if the channel math were wrong — the real regression this item
 * guards against.
 */
import { describe, expect, it } from 'vitest';
import {
  computeLandscapeChannels,
  computeLandscapeLayout,
  MIN_LAYOUT_WIDTH,
  NODE_HEIGHT,
  NODE_WIDTH,
  routeLandscapeEdge,
  segmentCrossesRect,
  type LandscapeLayout,
  type LandscapeNodePosition,
} from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function supports(fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: { role: 'primary' }, exists_delta_id: `d-r-${fromId}-${toId}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: 'team' }, exists_delta_id: `d-${id}` };
}

/** Every routed segment, for every possible pair of nodes in `layout`, crosses no *other* node's tile. Deterministic — every input is fixed test data, no randomness (CLAUDE.md rule 6). */
function assertNoEdgeCrossesAnyOtherTile(layout: LandscapeLayout): void {
  const all: LandscapeNodePosition[] = [...layout.nodes, ...layout.actorNodes];
  const channels = computeLandscapeChannels(layout);

  for (const from of all) {
    for (const to of all) {
      if (from.elementId === to.elementId) continue;
      const obstacles = all.filter((n) => n.elementId !== from.elementId && n.elementId !== to.elementId);
      const points = routeLandscapeEdge(from, to, obstacles, channels, layout.lanes);

      for (const obstacle of obstacles) {
        const rect = { x: obstacle.x, y: obstacle.y, w: NODE_WIDTH, h: NODE_HEIGHT };
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i];
          const b = points[i + 1];
          if (!a || !b) continue;
          const crosses = segmentCrossesRect(a.x, a.y, b.x, b.y, rect);
          if (crosses) {
            throw new Error(
              `edge ${from.elementId} -> ${to.elementId} crosses ${obstacle.elementId}'s tile: segment (${String(a.x)},${String(a.y)})-(${String(b.x)},${String(b.y)}) vs rect at (${String(obstacle.x)},${String(obstacle.y)})`,
            );
          }
        }
      }
    }
  }
}

describe('routeLandscapeEdge / computeLandscapeChannels (item 9)', () => {
  it('draws a plain straight line when nothing is in the way', () => {
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-a', 'Alpha'), system('sys-b', 'Bravo')];
    const layout = computeLandscapeLayout(systems, systems.map((s) => supports(s.element_id, 'cap-1')), new Map([['cap-1', cap]]));
    const channels = computeLandscapeChannels(layout);
    const [a, b] = layout.nodes;
    if (!a || !b) throw new Error('expected two nodes');
    const points = routeLandscapeEdge(a, b, [], channels, layout.lanes);
    expect(points).toHaveLength(2);
  });

  it('routes around a third tile sitting directly between two same-row, same-lane systems', () => {
    // Three systems in one lane, same row (well within the six-per-row
    // capacity at the floor width) — sys-a and sys-c share a y, with sys-b
    // sitting exactly between them, so the direct line from sys-a to sys-c
    // passes straight through sys-b's own tile.
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-a', 'Alpha'), system('sys-b', 'Bravo'), system('sys-c', 'Charlie')];
    const layout = computeLandscapeLayout(systems, systems.map((s) => supports(s.element_id, 'cap-1')), new Map([['cap-1', cap]]));
    const [a, , c] = layout.nodes;
    if (!a || !c) throw new Error('expected three ordered nodes');
    expect(a.y).toBe(c.y); // same row, confirming the setup actually exercises the case

    const channels = computeLandscapeChannels(layout);
    const obstacles = layout.nodes.filter((n) => n.elementId !== a.elementId && n.elementId !== c.elementId);
    const points = routeLandscapeEdge(a, c, obstacles, channels, layout.lanes);

    expect(points.length).toBeGreaterThan(2); // a real detour, not the straight line
    assertNoEdgeCrossesAnyOtherTile(layout);
  });

  it('every edge among ten systems across five lanes avoids every non-endpoint tile', () => {
    const laneCount = 5;
    const capabilities = Array.from({ length: laneCount }, (_, i) => capability(`cap-${String(i)}`, `Capability ${String(i)}`));
    const l1AncestorByCapabilityId = new Map(capabilities.map((c) => [c.element_id, c]));
    // Ten systems, two per lane, so each lane has real (same-row) sibling
    // tiles for a cross-lane edge to potentially clip.
    const systems = Array.from({ length: 10 }, (_, i) => system(`sys-${String(i)}`, `System ${String(i).padStart(2, '0')}`));
    const supportsEdges = systems.map((s, i) => supports(s.element_id, `cap-${String(i % laneCount)}`));
    const layout = computeLandscapeLayout(systems, supportsEdges, l1AncestorByCapabilityId);

    expect(layout.lanes).toHaveLength(laneCount);
    expect(layout.nodes).toHaveLength(10);
    assertNoEdgeCrossesAnyOtherTile(layout);
  });

  it('V2 "never diagonal across a lane": an unobstructed pair in two different lanes still detours, not the straight line', () => {
    // Two lanes, one system each, both the first (index 0) member of their
    // own row — so they share an x-column and, pre-V2, an unobstructed
    // straight vertical line would have connected them directly. Different
    // lanes now force the detour regardless.
    const capA = capability('cap-a', 'Alpha');
    const capB = capability('cap-b', 'Bravo');
    const sysA = system('sys-a', 'Alpha System');
    const sysB = system('sys-b', 'Bravo System');
    const layout = computeLandscapeLayout([sysA, sysB], [supports('sys-a', 'cap-a'), supports('sys-b', 'cap-b')], new Map([['cap-a', capA], ['cap-b', capB]]));
    const nodeA = layout.nodes.find((n) => n.elementId === 'sys-a');
    const nodeB = layout.nodes.find((n) => n.elementId === 'sys-b');
    if (!nodeA || !nodeB) throw new Error('expected both nodes');
    expect(nodeA.x).toBe(nodeB.x); // confirms the setup: same column, so only the lane rule forces a detour
    expect(nodeA.y).not.toBe(nodeB.y); // different lanes really do sit at different y

    const channels = computeLandscapeChannels(layout);
    const points = routeLandscapeEdge(nodeA, nodeB, [], channels, layout.lanes);
    expect(points.length).toBeGreaterThan(2);
  });

  it('V2: an unobstructed pair of actors sharing the top row (above every lane) still gets a straight line', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'System One');
    const actors = [actor('act-1', 'Ops A'), actor('act-2', 'Ops B')];
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), actors);
    const [a, b] = layout.actorNodes;
    if (!a || !b) throw new Error('expected two actor nodes');
    expect(a.y).toBe(b.y); // same row, above every lane

    const channels = computeLandscapeChannels(layout);
    const points = routeLandscapeEdge(a, b, [], channels, layout.lanes);
    expect(points).toHaveLength(2);
  });

  it('still avoids every tile once actors and a wider (item 7) canvas are in play', () => {
    const laneCount = 4;
    const capabilities = Array.from({ length: laneCount }, (_, i) => capability(`cap-${String(i)}`, `Capability ${String(i)}`));
    const l1AncestorByCapabilityId = new Map(capabilities.map((c) => [c.element_id, c]));
    const systems = Array.from({ length: 12 }, (_, i) => system(`sys-${String(i)}`, `System ${String(i).padStart(2, '0')}`));
    const supportsEdges = systems.map((s, i) => supports(s.element_id, `cap-${String(i % laneCount)}`));
    const actors = [{ element_id: 'act-1', element_type: 'actor' as const, name: 'Ops Team', parent_id: null, attributes: { subtype: 'team' }, exists_delta_id: 'd-act-1' }];
    const layout = computeLandscapeLayout(systems, supportsEdges, l1AncestorByCapabilityId, actors, 1920);

    expect(layout.width).toBe(1920);
    assertNoEdgeCrossesAnyOtherTile(layout);
  });
});

describe('computeLandscapeLayout width (item 7)', () => {
  function fixture(systemCount: number, layoutWidthHint?: number) {
    const cap = capability('cap-1', 'Payments');
    const systems = Array.from({ length: systemCount }, (_, i) => system(`sys-${String(i)}`, `System ${String(i).padStart(2, '0')}`));
    return computeLandscapeLayout(systems, systems.map((s) => supports(s.element_id, 'cap-1')), new Map([['cap-1', cap]]), [], layoutWidthHint);
  }

  it('defaults to MIN_LAYOUT_WIDTH with no hint', () => {
    expect(fixture(1).width).toBe(MIN_LAYOUT_WIDTH);
  });

  it('clamps a hint below the floor up to MIN_LAYOUT_WIDTH', () => {
    expect(fixture(1, 800).width).toBe(MIN_LAYOUT_WIDTH);
  });

  it('uses a wider hint as-is', () => {
    expect(fixture(1, 1920).width).toBe(1920);
  });

  it('a wider canvas fits more systems per row before wrapping to a second row', () => {
    // Seven systems wrap to a second row at the 1280 floor (layout.test.ts's
    // own "wraps a lane past its row capacity" case) — the same seven fit
    // on one row at 1920.
    const narrow = fixture(7, MIN_LAYOUT_WIDTH);
    const wide = fixture(7, 1920);
    expect(new Set(narrow.nodes.map((n) => n.y)).size).toBe(2);
    expect(new Set(wide.nodes.map((n) => n.y)).size).toBe(1);
  });

  it('is deterministic for the same width hint', () => {
    const a = fixture(9, 1600);
    const b = fixture(9, 1600);
    expect(b).toEqual(a);
  });
});
