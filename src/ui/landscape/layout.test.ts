import { describe, expect, it } from 'vitest';
import { computeLandscapeLayout, EXTERNAL_LANE_KEY, LAYOUT_WIDTH, UNASSIGNED_LANE_KEY } from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { isExternal }, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { isExternal, subtype: 'person' }, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

/** `existsDeltaId` is a distinct, increasing (UUID-v7-like) string per call — real delta ids sort chronologically as plain strings, and `computeLandscapeLayout`'s "most recently added" fallback relies on exactly that, so a test fixture needs the same property, not a fixed placeholder shared across every edge. */
let nextDeltaOrdinal = 0;
function supports(fromId: string, toId: string, role?: 'primary' | 'secondary'): RelationshipsHeadRow {
  nextDeltaOrdinal += 1;
  return {
    relationship_id: `r-${fromId}-${toId}`,
    relationship_type: 'supports',
    from_element_id: fromId,
    to_element_id: toId,
    attributes: role ? { role } : {},
    exists_delta_id: `d-r-${String(nextDeltaOrdinal).padStart(4, '0')}`,
  };
}

describe('computeLandscapeLayout', () => {
  it('places a system in the lane of the capability it supports', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(layout.lanes).toHaveLength(1);
    expect(layout.lanes[0]).toMatchObject({ key: 'cap-1', label: 'Payments', region: 'capability' });
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number) }]);
    expect(layout.referenceMarkers).toEqual([]);
  });

  it('groups a system with no supports edge into the unassigned lane, not the external lane', () => {
    const sys = system('sys-1', 'Orphan Service');
    const layout = computeLandscapeLayout([sys], [], new Map());
    expect(layout.lanes.map((l) => l.key)).toEqual([UNASSIGNED_LANE_KEY]);
    expect(layout.lanes[0]?.region).toBe('unassigned');
  });

  it('puts every external system in its own external band, outside the capability/unassigned lane list', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Vendor API', true);
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(layout.lanes.map((l) => l.key)).toEqual([EXTERNAL_LANE_KEY]);
    expect(layout.lanes[0]?.region).toBe('external');
  });

  it('orders lanes: capability lanes by name, then unassigned, then external always last', () => {
    const capZ = capability('cap-z', 'Zeta');
    const capA = capability('cap-a', 'Alpha');
    const systems = [system('sys-z', 'S-Zeta'), system('sys-a', 'S-Alpha'), system('sys-u', 'S-Unassigned'), system('sys-e', 'S-External', true)];
    const supportsEdges = [supports('sys-z', 'cap-z'), supports('sys-a', 'cap-a')];
    const layout = computeLandscapeLayout(systems, supportsEdges, new Map([['cap-z', capZ], ['cap-a', capA]]));
    expect(layout.lanes.map((l) => l.key)).toEqual(['cap-a', 'cap-z', UNASSIGNED_LANE_KEY, EXTERNAL_LANE_KEY]);
    expect(layout.lanes.map((l) => l.region)).toEqual(['capability', 'capability', 'unassigned', 'external']);
  });

  it('orders systems within a lane by name, then id', () => {
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-b', 'Bravo'), system('sys-a', 'Alpha')];
    const supportsEdges = [supports('sys-b', 'cap-1'), supports('sys-a', 'cap-1')];
    const layout = computeLandscapeLayout(systems, supportsEdges, new Map([['cap-1', cap]]));
    const order = layout.nodes.map((n) => n.elementId);
    expect(order).toEqual(['sys-a', 'sys-b']);
    const [alphaNode, bravoNode] = layout.nodes;
    if (!alphaNode || !bravoNode) throw new Error('expected two laid-out nodes');
    expect(alphaNode.x).toBeLessThan(bravoNode.x);
  });

  it('is deterministic: the same inputs (in a different array order) produce the same layout', () => {
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-a', 'Alpha'), system('sys-b', 'Bravo'), system('sys-c', 'Charlie')];
    const supportsEdges = systems.map((s) => supports(s.element_id, 'cap-1'));
    const capabilitiesById = new Map([['cap-1', cap]]);
    const layoutA = computeLandscapeLayout(systems, supportsEdges, capabilitiesById);
    const layoutB = computeLandscapeLayout([...systems].reverse(), [...supportsEdges].reverse(), capabilitiesById);
    expect(layoutB).toEqual(layoutA);
  });

  it('produces empty lanes and nodes for an empty model, without erroring', () => {
    const layout = computeLandscapeLayout([], [], new Map());
    expect(layout.nodes).toEqual([]);
    expect(layout.lanes).toEqual([]);
    expect(layout.referenceMarkers).toEqual([]);
    expect(layout.actorNodes).toEqual([]);
    expect(layout.boundary).toEqual({ top: 32, bottom: 32 }); // PADDING, nothing to enclose
  });

  // --- Sprint U4-1 B4: level-1 rollup, primary placement, reference markers, fallback ---

  it('rolls a level-2 (and level-3) supported capability up to its level-1 ancestor lane', () => {
    const l1 = capability('l1', 'Network Operations');
    const sys = system('sys-1', 'PowerON');
    // The caller resolves every supported capability id to its own level-1
    // ancestor row (capabilityDepth.ts's l1AncestorOf) before calling —
    // 'l2' (Outage & Fault Management) and 'l3' (Fault Diagnosis, l2's own
    // child) both map to the same l1 row here; their own rows don't matter
    // to computeLandscapeLayout, only this resolved mapping does.
    const l1AncestorByCapabilityId = new Map([
      ['l2', l1],
      ['l3', l1],
    ]);
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'l3')], l1AncestorByCapabilityId);
    expect(layout.lanes).toHaveLength(1);
    expect(layout.lanes[0]).toMatchObject({ key: 'l1', label: 'Network Operations' });
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number) }]);
  });

  it('an explicit primary decides the lane; the other lane gets a reference marker (a chip, not a duplicate tile)', () => {
    const assetMgmt = capability('asset-mgmt', 'Asset Management');
    const networkOps = capability('network-ops', 'Network Operations');
    // 'l2-under-network-ops' (Outage & Fault Management, a child of
    // network-ops) resolves to the networkOps row above — its own row
    // doesn't matter to computeLandscapeLayout, only that mapping does.
    const sys = system('sys-1', 'PowerON');
    const l1AncestorByCapabilityId = new Map([
      ['asset-mgmt', assetMgmt],
      ['l2-under-network-ops', networkOps],
    ]);
    const edges = [supports('sys-1', 'l2-under-network-ops', 'secondary'), supports('sys-1', 'asset-mgmt', 'primary')];
    const layout = computeLandscapeLayout([sys], edges, l1AncestorByCapabilityId);

    expect(layout.lanes.map((l) => l.key).sort()).toEqual(['asset-mgmt', 'network-ops']);
    // Exactly one tile, in the primary's lane.
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number) }]);
    const assetMgmtLane = layout.lanes.find((l) => l.key === 'asset-mgmt');
    if (!assetMgmtLane) throw new Error('expected an Asset Management lane');
    expect(layout.nodes[0]?.y).toBe(assetMgmtLane.y + 28); // LANE_LABEL_HEIGHT, placed in the primary's lane
    // A reference in the other lane — not a tile — positioned as a real
    // chip (item 2: at the band's own right edge, never text folded into
    // the lane's own label).
    const networkOpsLane = layout.lanes.find((l) => l.key === 'network-ops');
    if (!networkOpsLane) throw new Error('expected a Network Operations lane');
    expect(layout.referenceMarkers).toEqual([{ elementId: 'sys-1', laneKey: 'network-ops', x: expect.any(Number), y: expect.any(Number) }]);
    const marker = layout.referenceMarkers[0];
    if (!marker) throw new Error('expected a reference marker');
    expect(marker.x + 108).toBeLessThanOrEqual(LAYOUT_WIDTH - 32); // REFERENCE_CHIP_WIDTH, PADDING — anchored inside the band's own right edge
    expect(marker.y).toBeGreaterThanOrEqual(networkOpsLane.y);
    expect(marker.y).toBeLessThan(networkOpsLane.y + 28); // still within the header line's own height, even for a collapsed lane
  });

  it('no primary: the most recently added edge decides, with extraLaneCount ("+N") on that tile', () => {
    const capA = capability('cap-a', 'Alpha');
    const capZ = capability('cap-z', 'Zeta');
    const sys = system('sys-1', 'Multi-homed Service');
    const l1AncestorByCapabilityId = new Map([
      ['cap-a', capA],
      ['cap-z', capZ],
    ]);
    // cap-z's edge is added second — most recent — even though "cap-a"
    // would sort first alphabetically (the old, pre-B4 rule this replaces).
    const edges = [supports('sys-1', 'cap-a'), supports('sys-1', 'cap-z')];
    const layout = computeLandscapeLayout([sys], edges, l1AncestorByCapabilityId);

    expect(layout.lanes.map((l) => l.key).sort()).toEqual(['cap-a', 'cap-z']);
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number), extraLaneCount: 1 }]);
    expect(layout.referenceMarkers).toEqual([{ elementId: 'sys-1', laneKey: 'cap-a', x: expect.any(Number), y: expect.any(Number) }]);
  });

  it('no primary, only one lane touched: no extraLaneCount and no reference marker — nothing else to reference', () => {
    const cap = capability('cap-1', 'Payments');
    // 'l2' (Card Payments, a child of cap-1) resolves to cap above.
    const sys = system('sys-1', 'Billing Service');
    const l1AncestorByCapabilityId = new Map([['l2', cap]]);
    // Two edges, but both roll up to the same single level-1 lane.
    const edges = [supports('sys-1', 'l2'), supports('sys-1', 'l2')];
    const layout = computeLandscapeLayout([sys], edges, l1AncestorByCapabilityId);
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number) }]);
    expect(layout.referenceMarkers).toEqual([]);
  });

  it('an edge to a capability with no resolvable level-1 ancestor is dropped, not crashed on', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    // 'ghost' isn't in the map at all (e.g. nesting deeper than 3 levels,
    // capabilityDepth.ts's own "shown as a gap" stance).
    const l1AncestorByCapabilityId = new Map([['cap-1', cap]]);
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'ghost'), supports('sys-1', 'cap-1')], l1AncestorByCapabilityId);
    expect(layout.lanes.map((l) => l.key)).toEqual(['cap-1']);
    expect(layout.referenceMarkers).toEqual([]);
  });

  // --- Landscape canvas, structural: full-width wrapping bands, empty-lane collapse, boundary, actors ---

  it('every lane spans the full LAYOUT_WIDTH regardless of member count (item 2)', () => {
    const cap = capability('cap-1', 'Payments');
    const empty = computeLandscapeLayout([], [], new Map());
    const populated = computeLandscapeLayout([system('sys-1', 'Billing')], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(empty.width).toBe(LAYOUT_WIDTH);
    expect(populated.width).toBe(LAYOUT_WIDTH);
  });

  it('wraps a lane past its row capacity onto a second row, growing the band height to fit', () => {
    // 160px node + 24px gutter, six per row inside LAYOUT_WIDTH's 1216px
    // available width — a seventh system in the same lane must wrap.
    const cap = capability('cap-1', 'Payments');
    const systems = Array.from({ length: 7 }, (_, i) => system(`sys-${String(i)}`, `System ${String(i).padStart(2, '0')}`));
    const edges = systems.map((s) => supports(s.element_id, 'cap-1'));
    const layout = computeLandscapeLayout(systems, edges, new Map([['cap-1', cap]]));
    const ys = new Set(layout.nodes.map((n) => n.y));
    expect(ys.size).toBe(2); // two distinct rows
    const rowYs = [...ys].sort((a, b) => a - b);
    expect(rowYs[1]).toBe((rowYs[0] ?? 0) + 48 + 16); // NODE_HEIGHT + the row gutter
    expect(layout.lanes[0]?.height).toBeGreaterThan(28 + 48 + 32); // taller than a single-row lane would be
  });

  it('a lane with no primary members — only a reference into it — collapses to its header line, not a full content row', () => {
    const capA = capability('cap-a', 'Alpha');
    const capB = capability('cap-b', 'Beta');
    const sys = system('sys-1', 'Multi-homed');
    const l1AncestorByCapabilityId = new Map([
      ['cap-a', capA],
      ['cap-b', capB],
    ]);
    const edges = [supports('sys-1', 'cap-a', 'primary'), supports('sys-1', 'cap-b', 'secondary')];
    const layout = computeLandscapeLayout([sys], edges, l1AncestorByCapabilityId);
    const laneB = layout.lanes.find((l) => l.key === 'cap-b');
    const laneA = layout.lanes.find((l) => l.key === 'cap-a');
    if (!laneA || !laneB) throw new Error('expected both lanes');
    expect(laneB.height).toBe(28 + 8); // LANE_LABEL_HEIGHT + the collapsed-lane gutter — no node row reserved
    expect(laneA.height).toBeGreaterThan(laneB.height); // the populated lane keeps its full content height
  });

  it('actors get their own wrapped row above the boundary, both external and internal together (item 3)', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const internalActor = actor('act-1', 'Ops Team', false);
    const externalActor = actor('act-2', 'Vendor Contact', true);
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), [internalActor, externalActor]);
    expect(layout.actorNodes.map((n) => n.elementId).sort()).toEqual(['act-1', 'act-2']);
    // Both actors sit on the row's own first line (name-sorted, both fit in
    // one row well within the six-per-row capacity).
    expect(new Set(layout.actorNodes.map((n) => n.y)).size).toBe(1);
    expect(layout.actorNodes[0]?.y).toBe(32); // PADDING — the very top of the canvas
    // Every lane starts below the actor row, not above it.
    for (const lane of layout.lanes) expect(lane.y).toBeGreaterThan(layout.actorNodes[0]?.y ?? 0);
  });

  it('with no actors at all, nothing reserves the actor row\'s own space — lanes start at PADDING', () => {
    const cap = capability('cap-1', 'Payments');
    const layout = computeLandscapeLayout([system('sys-1', 'Billing')], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(layout.actorNodes).toEqual([]);
    expect(layout.lanes[0]?.y).toBe(32); // PADDING
  });

  it('the enterprise boundary spans exactly the capability/unassigned lanes — never the actor row above it or the external band below it (item 3)', () => {
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-1', 'Billing Service'), system('sys-2', 'Vendor API', true)];
    const edges = [supports('sys-1', 'cap-1')];
    const layout = computeLandscapeLayout(systems, edges, new Map([['cap-1', cap]]), [actor('act-1', 'Ops Team')]);

    const capLane = layout.lanes.find((l) => l.region === 'capability');
    const externalLane = layout.lanes.find((l) => l.region === 'external');
    if (!capLane || !externalLane) throw new Error('expected both a capability lane and an external band');

    expect(layout.boundary.top).toBe(capLane.y);
    expect(layout.boundary.bottom).toBe(capLane.y + capLane.height);
    // The external band sits below the boundary, separated by a real gap —
    // never inside the range the boundary itself encloses.
    expect(externalLane.y).toBeGreaterThan(layout.boundary.bottom);
    expect(layout.boundary.bottom).toBeLessThanOrEqual(externalLane.y);
  });
});
