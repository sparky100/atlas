import { describe, expect, it } from 'vitest';
import { computeLandscapeGroups } from './landscapeGroups';
import { EXTERNAL_LANE_KEY, UNASSIGNED_LANE_KEY } from './layout';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';

function system(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { isExternal }, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string, isExternal = false): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: isExternal ? 'organisation' : 'team', isExternal }, exists_delta_id: `d-${id}` };
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

  it('internal actors are their own leading group, sorted by name then id, separate from every capability lane', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const actors = [actor('act-b', 'Bravo Team'), actor('act-a', 'Alpha Team')];
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), actors, []);
    expect(groups.actors.map((a) => a.element_id)).toEqual(['act-a', 'act-b']);
    expect(groups.groups.every((g) => g.members.every((m) => m.system.element_type !== 'actor'))).toBe(true);
  });

  it("S1 item 11a: an external actor joins the External group's own members, not the leading Actors group", () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const actors = [actor('act-int', 'Ops Team'), actor('act-ext', 'Ofgem', true)];
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), actors, []);
    expect(groups.actors.map((a) => a.element_id)).toEqual(['act-int']);
    const externalGroup = groups.groups.find((g) => g.region === 'external');
    expect(externalGroup?.members.map((m) => m.system.element_id)).toEqual(['act-ext']);
  });

  it('S1 item 11a: the External group exists purely for an external actor, even with zero external systems', () => {
    const cap = capability('cap-1', 'Payments');
    const sys = system('sys-1', 'Billing Service');
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-1')], new Map([['cap-1', cap]]), [actor('act-ext', 'Ofgem', true)], []);
    const externalGroup = groups.groups.find((g) => g.region === 'external');
    expect(externalGroup?.label).toBe('External');
    expect(externalGroup?.members).toHaveLength(1);
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

  it('an empty (reference-only) lane still shows the referencing systems ("shared-system chips") — and, secondary-supporter wording, lists them as real secondary members too', () => {
    const capA = capability('cap-a', 'Alpha');
    const capB = capability('cap-b', 'Beta');
    const sys = system('sys-1', 'Multi-homed');
    const l1AncestorByCapabilityId = new Map([['cap-a', capA], ['cap-b', capB]]);
    const edges = [supports('sys-1', 'cap-a', 'primary'), supports('sys-1', 'cap-b', 'secondary')];
    const groups = computeLandscapeGroups([sys], edges, l1AncestorByCapabilityId, [], []);
    const laneB = groups.groups.find((g) => g.key === 'cap-b');
    if (!laneB) throw new Error('expected a Beta lane');
    expect(laneB.members).toEqual([{ system: sys, usesCount: 0, usedByCount: 0, role: 'secondary' }]);
    expect(laneB.referencedBy.map((s) => s.element_id)).toEqual(['sys-1']);
  });

  it('a fallback-placed system carries the same extraLaneCount computeLandscapeLayout would give its tile', () => {
    const capA = capability('cap-a', 'Alpha');
    const capZ = capability('cap-z', 'Zeta');
    const sys = system('sys-1', 'Multi-homed Service');
    const l1AncestorByCapabilityId = new Map([['cap-a', capA], ['cap-z', capZ]]);
    const edges = [supports('sys-1', 'cap-a'), supports('sys-1', 'cap-z')];
    const groups = computeLandscapeGroups([sys], edges, l1AncestorByCapabilityId, [], []);
    // Secondary-supporter wording: `sys-1` now appears twice — once as its
    // anchored (primary) lane's own member, carrying `extraLaneCount`, and
    // once more as the *other* lane's `secondary` member (never carrying
    // it, this member field's own doc comment) — disambiguated the same
    // way a caller actually would, by which one has the `+N` marker at all.
    const member = groups.groups.flatMap((g) => g.members).find((m) => m.system.element_id === 'sys-1' && m.extraLaneCount !== undefined);
    expect(member?.extraLaneCount).toBe(1);
  });

  it('secondary-supporter wording: an anchored member carries role "primary", a merged secondary-lane member carries "secondary"', () => {
    const capA = capability('cap-a', 'Alpha');
    const capB = capability('cap-b', 'Beta');
    const sys = system('sys-1', 'Multi-homed');
    const l1AncestorByCapabilityId = new Map([['cap-a', capA], ['cap-b', capB]]);
    const edges = [supports('sys-1', 'cap-a', 'primary'), supports('sys-1', 'cap-b', 'secondary')];
    const groups = computeLandscapeGroups([sys], edges, l1AncestorByCapabilityId, [], []);
    const laneA = groups.groups.find((g) => g.key === 'cap-a');
    const laneB = groups.groups.find((g) => g.key === 'cap-b');
    expect(laneA?.members[0]?.role).toBe('primary');
    expect(laneB?.members[0]?.role).toBe('secondary');
  });

  it('bug fix: a primary edge to a *child* capability still reports the anchored member as "primary" (the lane key is the level-1 ancestor, not the edge\'s own target)', () => {
    const capA = capability('cap-a', 'Information Management'); // the level-1 lane
    const sys = system('sys-1', 'Informatica');
    // The edge targets the *child*; `l1AncestorByCapabilityId` maps that
    // child to `cap-a`, the same shape `layout.ts`'s own caller builds —
    // `cap-child` never appears as a map key pointing to itself.
    const l1AncestorByCapabilityId = new Map([['cap-child', capA]]);
    const groups = computeLandscapeGroups([sys], [supports('sys-1', 'cap-child', 'primary')], l1AncestorByCapabilityId, [], []);
    const laneA = groups.groups.find((g) => g.key === 'cap-a');
    if (!laneA) throw new Error('expected an Information Management lane');
    expect(laneA.members[0]?.role).toBe('primary');
  });

  it('the four non-capability lanes (Unassigned/External/OT/Platforms) never carry a role — there is no single `supports` edge to name one from', () => {
    const sys = system('sys-1', 'No Capability', false);
    const groups = computeLandscapeGroups([sys], [], new Map(), [], []);
    const unassigned = groups.groups.find((g) => g.key === UNASSIGNED_LANE_KEY);
    expect(unassigned?.members[0]?.role).toBeUndefined();
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
