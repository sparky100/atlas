import { describe, expect, it } from 'vitest';
import { computeLandscapeGroups } from './landscapeGroups';
import { EXTERNAL_LANE_KEY, UNASSIGNED_LANE_KEY } from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { isExternal }, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: 'team', isExternal: false }, exists_delta_id: `d-${id}` };
}

function capability(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: null, attributes: {}, exists_delta_id: `d-${id}` };
}

let nextDeltaOrdinal = 0;
function supports(fromId: string, toId: string, role?: 'primary' | 'secondary'): RelationshipsHeadRow {
  nextDeltaOrdinal += 1;
  return { relationship_id: `r-${fromId}-${toId}`, relationship_type: 'supports', from_element_id: fromId, to_element_id: toId, attributes: role ? { role } : {}, exists_delta_id: `d-r-${String(nextDeltaOrdinal).padStart(4, '0')}` };
}

function landscapeEdge(type: 'uses' | 'flows_to', fromId: string, toId: string): RelationshipsHeadRow {
  return { relationship_id: `e-${fromId}-${toId}`, relationship_type: type, from_element_id: fromId, to_element_id: toId, attributes: {}, exists_delta_id: `d-e-${fromId}-${toId}` };
}

describe('computeLandscapeGroups (item 13)', () => {
  it('groups a system into the lane of the capability it supports, same as computeLandscapeLayout', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), [], []);
    expect(groups.groups).toHaveLength(1);
    expect(groups.groups[0]).toMatchObject({ key: 'cap-1', label: 'Payments', region: 'capability' });
    expect(groups.groups[0]?.members.map((m) => m.system.element_id)).toEqual(['sys-1']);
  });

  it('orders groups: capability lanes by name, then Unassigned, then External last (item 13\'s own ordering, extended for External)', () => {
    const capZ = capability('cap-z', 'Zeta');
    const capA = capability('cap-a', 'Alpha');
    const systems = [system('sys-z', 'S-Zeta'), system('sys-a', 'S-Alpha'), system('sys-u', 'S-Unassigned'), system('sys-e', 'S-External', true)];
    const supportsEdges = [supports('sys-z', 'cap-z'), supports('sys-a', 'cap-a')];
    const groups = computeLandscapeGroups(systems, supportsEdges, new Map([['cap-z', capZ], ['cap-a', capA]]), [], []);
    expect(groups.groups.map((g) => g.key)).toEqual(['cap-a', 'cap-z', UNASSIGNED_LANE_KEY, EXTERNAL_LANE_KEY]);
  });

  it('actors are their own leading group, sorted by name then id, separate from every capability lane', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const actors = [actor('act-b', 'Bravo Team'), actor('act-a', 'Alpha Team')];
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), actors, []);
    expect(groups.actors.map((a) => a.element_id)).toEqual(['act-a', 'act-b']);
    expect(groups.groups.every((g) => (g.members as { system: ElementsHeadRow }[]).every((m) => m.system.element_type !== 'actor'))).toBe(true);
  });

  it('counts each system\'s own uses/used-by edges, both directions, uses and flows_to together', () => {
    const cap = capability('cap-1', 'Payments');
    const hub = system('hub', 'Hub Service');
    const other1 = system('other1', 'Other One');
    const other2 = system('other2', 'Other Two');
    const supportsEdges = [supports('hub', 'cap-1'), supports('other1', 'cap-1'), supports('other2', 'cap-1')];
    const edges = [landscapeEdge('uses', 'hub', 'other1'), landscapeEdge('flows_to', 'other2', 'hub')];
    const groups = computeLandscapeGroups([hub, other1, other2], supportsEdges, new Map([['cap-1', cap]]), [], edges);
    const hubMember = groups.groups[0]?.members.find((m) => m.system.element_id === 'hub');
    if (!hubMember) throw new Error('expected the hub in the lane');
    expect(hubMember.usesCount).toBe(1); // hub -> other1
    expect(hubMember.usedByCount).toBe(1); // other2 -> hub
  });

  it('an empty (reference-only) lane still shows the referencing systems ("shared-system chips")', () => {
    const capA = capability('cap-a', 'Alpha');
    const capB = capability('cap-b', 'Beta');
    const sys = system('sys-1', 'Multi-homed');
    const l1AncestorByCapabilityId = new Map([['cap-a', capA], ['cap-b', capB]]);
    const edges = [supports('sys-1', 'cap-a', 'primary'), supports('sys-1', 'cap-b', 'secondary')];
    const groups = computeLandscapeGroups([sys], edges, l1AncestorByCapabilityId, [], []);
    const laneB = groups.groups.find((g) => g.key === 'cap-b');
    if (!laneB) throw new Error('expected a Beta lane');
    expect(laneB.members).toEqual([]);
    expect(laneB.referencedBy.map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('a fallback-placed system carries the same extraLaneCount computeLandscapeLayout would give its tile', () => {
    const capA = capability('cap-a', 'Alpha');
    const capZ = capability('cap-z', 'Zeta');
    const sys = system('sys-1', 'Multi-homed Service');
    const l1AncestorByCapabilityId = new Map([['cap-a', capA], ['cap-z', capZ]]);
    const edges = [supports('sys-1', 'cap-a'), supports('sys-1', 'cap-z')];
    const groups = computeLandscapeGroups([sys], edges, l1AncestorByCapabilityId, [], []);
    const member = groups.groups.flatMap((g) => g.members).find((m) => m.system.element_id === 'sys-1');
    expect(member?.extraLaneCount).toBe(1);
  });

  it('is deterministic: the same inputs, in a different array order, produce the same groups', () => {
    const cap = capability('cap-1', 'Payments');
    const systems = [system('sys-a', 'Alpha'), system('sys-b', 'Bravo'), system('sys-c', 'Charlie')];
    const supportsEdges = systems.map((s) => supports(s.element_id, 'cap-1'));
    const capabilitiesById = new Map([['cap-1', cap]]);
    const groupsA = computeLandscapeGroups(systems, supportsEdges, capabilitiesById, [], []);
    const groupsB = computeLandscapeGroups([...systems].reverse(), [...supportsEdges].reverse(), capabilitiesById, [], []);
    expect(groupsB).toEqual(groupsA);
  });

  it('produces no groups and no actors for an empty model, without erroring', () => {
    const groups = computeLandscapeGroups([], [], new Map(), [], []);
    expect(groups.groups).toEqual([]);
    expect(groups.actors).toEqual([]);
  });
});
