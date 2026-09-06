import { describe, expect, it } from 'vitest';
import { computeLandscapeLayout, EXTERNAL_LANE_KEY, UNASSIGNED_LANE_KEY } from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { isExternal }, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

function supports(fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-r-${fromId}` };
}

describe('computeLandscapeLayout', () => {
  it('places a system in the lane of the capability it supports', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(layout.lanes).toHaveLength(1);
    expect(layout.lanes[0]).toMatchObject({ key: 'cap-1', label: 'Payments' });
    expect(layout.nodes).toEqual([{ elementId: 'sys-1', x: expect.any(Number), y: expect.any(Number) }]);
  });

  it('groups a system with no supports edge into the unassigned lane, not the external lane', () => {
    const sys = system('sys-1', 'Orphan Service');
    const layout = computeLandscapeLayout([sys], [], new Map());
    expect(layout.lanes.map((l) => l.key)).toEqual([UNASSIGNED_LANE_KEY]);
  });

  it('puts every external system in the external lane regardless of supports edges', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Vendor API', true);
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]));
    expect(layout.lanes.map((l) => l.key)).toEqual([EXTERNAL_LANE_KEY]);
  });

  it('orders lanes: capability lanes by name, then unassigned, then external always last', () => {
    const capZ = capability('cap-z', 'Zeta');
    const capA = capability('cap-a', 'Alpha');
    const systems = [system('sys-z', 'S-Zeta'), system('sys-a', 'S-Alpha'), system('sys-u', 'S-Unassigned'), system('sys-e', 'S-External', true)];
    const supportsEdges = [supports('sys-z', 'cap-z'), supports('sys-a', 'cap-a')];
    const layout = computeLandscapeLayout(systems, supportsEdges, new Map([['cap-z', capZ], ['cap-a', capA]]));
    expect(layout.lanes.map((l) => l.key)).toEqual(['cap-a', 'cap-z', UNASSIGNED_LANE_KEY, EXTERNAL_LANE_KEY]);
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

  it('picks the alphabetically-first supported capability when a system supports more than one', () => {
    const capZ = capability('cap-z', 'Zeta');
    const capA = capability('cap-a', 'Alpha');
    const sys = system('sys-1', 'Multi-homed Service');
    const layout = computeLandscapeLayout([sys], [supports('sys-1', 'cap-z'), supports('sys-1', 'cap-a')], new Map([['cap-z', capZ], ['cap-a', capA]]));
    expect(layout.lanes.map((l) => l.key)).toEqual(['cap-a']);
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
  });
});
