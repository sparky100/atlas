import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { computeContextGroup } from './contextGrouping';

function system(id: string, name: string, external = false): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { lifecycleStatus: 'active', isExternal: external }, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { subtype: 'team', isExternal: false }, exists_delta_id: `d-${id}` };
}

function rel(id: string, type: RelationshipsHeadRow['relationship_type'], from: string, to: string): RelationshipsHeadRow {
  return { relationship_id: id, relationship_type: type, from_element_id: from, to_element_id: to, attributes: {}, exists_delta_id: `d-${id}` };
}

describe('computeContextGroup', () => {
  it('groups a uses-neighbour as internal when it is not external', () => {
    const hub = system('hub', 'Hub');
    const neighbour = system('n1', 'Neighbour');
    const group = computeContextGroup(hub, [rel('r1', 'uses', 'hub', 'n1')], new Map([['n1', neighbour]]));
    expect(group.internal.map((n) => n.element.element_id)).toEqual(['n1']);
    expect(group.external).toEqual([]);
  });

  it('groups a flows_to neighbour that is external into the external bucket', () => {
    const hub = system('hub', 'Hub');
    const neighbour = system('ext', 'External System', true);
    const group = computeContextGroup(hub, [rel('r1', 'flows_to', 'ext', 'hub')], new Map([['ext', neighbour]]));
    expect(group.external.map((n) => n.element.element_id)).toEqual(['ext']);
    expect(group.internal).toEqual([]);
  });

  it('never drops a neighbour reached in either direction (from the hub, or to the hub)', () => {
    const hub = system('hub', 'Hub');
    const a = system('a', 'A');
    const b = system('b', 'B');
    const group = computeContextGroup(hub, [rel('r1', 'uses', 'hub', 'a'), rel('r2', 'uses', 'b', 'hub')], new Map([['a', a], ['b', b]]));
    expect(group.internal.map((n) => n.element.element_id).sort()).toEqual(['a', 'b']);
  });

  it('groups an owns-the-hub actor as an owner, with no drawn edge (owns is never a canvas edge)', () => {
    const hub = system('hub', 'Hub');
    const owner = actor('owner1', 'Platform Team');
    const group = computeContextGroup(hub, [rel('r1', 'owns', 'owner1', 'hub')], new Map([['owner1', owner]]));
    expect(group.owners.map((o) => o.element_id)).toEqual(['owner1']);
    expect(group.internal).toEqual([]);
    expect(group.external).toEqual([]);
  });

  it('a supports edge is never a Context node or a drawn edge, but is captured in group.supports (item 12)', () => {
    const hub = system('hub', 'Hub');
    const capability: ElementsHeadRow = { element_id: 'cap1', element_type: 'capability', name: 'Cap', parent_id: null, attributes: {}, exists_delta_id: 'd-cap1' };
    const group = computeContextGroup(hub, [rel('r1', 'supports', 'hub', 'cap1')], new Map([['cap1', capability]]));
    expect(group.internal).toEqual([]);
    expect(group.external).toEqual([]);
    expect(group.owners).toEqual([]);
    expect(group.supports).toEqual([{ capability, primary: false }]);
  });

  it('ignores a supports edge in the other direction (the hub is the capability end, which never actually happens, but this function never assumes it can\'t)', () => {
    const hub = system('hub', 'Hub');
    const other: ElementsHeadRow = { element_id: 'sys1', element_type: 'system', name: 'Other System', parent_id: null, attributes: {}, exists_delta_id: 'd-sys1' };
    const group = computeContextGroup(hub, [rel('r1', 'supports', 'sys1', 'hub')], new Map([['sys1', other]]));
    expect(group.supports).toEqual([]);
    expect(group.internal).toEqual([]);
  });

  it('item 12: supports edges sort primary first, then by name/id', () => {
    const hub = system('hub', 'Hub');
    const capA: ElementsHeadRow = { element_id: 'cap-a', element_type: 'capability', name: 'Alpha', parent_id: null, attributes: {}, exists_delta_id: 'd-cap-a' };
    const capZ: ElementsHeadRow = { element_id: 'cap-z', element_type: 'capability', name: 'Zeta', parent_id: null, attributes: {}, exists_delta_id: 'd-cap-z' };
    const primaryEdge: RelationshipsHeadRow = { relationship_id: 'r2', relationship_type: 'supports', from_element_id: 'hub', to_element_id: 'cap-z', attributes: { role: 'primary' }, exists_delta_id: 'd-r2' };
    const group = computeContextGroup(hub, [rel('r1', 'supports', 'hub', 'cap-a'), primaryEdge], new Map([['cap-a', capA], ['cap-z', capZ]]));
    expect(group.supports.map((s) => s.capability.element_id)).toEqual(['cap-z', 'cap-a']); // primary (Zeta) first, even though Alpha sorts first alphabetically
    expect(group.supports[0]?.primary).toBe(true);
    expect(group.supports[1]?.primary).toBe(false);
  });

  it('item 12: a supports edge naming a capability that never resolved is dropped, not rendered as a gap', () => {
    const hub = system('hub', 'Hub');
    const group = computeContextGroup(hub, [rel('r1', 'supports', 'hub', 'missing-cap')], new Map());
    expect(group.supports).toEqual([]);
  });

  it('ignores an owns edge where the hub is the owner, not the owned (a system never owns anything the model allows)', () => {
    const hub = system('hub', 'Hub');
    const other = system('other', 'Other');
    const group = computeContextGroup(hub, [rel('r1', 'owns', 'hub', 'other')], new Map([['other', other]]));
    expect(group.owners).toEqual([]);
    expect(group.internal).toEqual([]);
  });

  it('collects every edge connecting a neighbour to the hub, not just the first', () => {
    const hub = system('hub', 'Hub');
    const neighbour = system('n1', 'Neighbour');
    const group = computeContextGroup(hub, [rel('r1', 'uses', 'hub', 'n1'), rel('r2', 'flows_to', 'n1', 'hub')], new Map([['n1', neighbour]]));
    expect(group.internal).toHaveLength(1);
    expect(group.internal[0]?.edges.map((e) => e.relationship_id).sort()).toEqual(['r1', 'r2']);
  });

  it('sorts internal/external/owners deterministically by name then id', () => {
    const hub = system('hub', 'Hub');
    const b = system('b', 'Beta');
    const a = system('a', 'Alpha');
    const group = computeContextGroup(hub, [rel('r1', 'uses', 'hub', 'b'), rel('r2', 'uses', 'hub', 'a')], new Map([['a', a], ['b', b]]));
    expect(group.internal.map((n) => n.element.element_id)).toEqual(['a', 'b']);
  });

  it('drops a relationship whose other endpoint never resolved (e.g. retracted since) rather than rendering a node for it', () => {
    const hub = system('hub', 'Hub');
    const group = computeContextGroup(hub, [rel('r1', 'uses', 'hub', 'missing')], new Map());
    expect(group.internal).toEqual([]);
  });
});
