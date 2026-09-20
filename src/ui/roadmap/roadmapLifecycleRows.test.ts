import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { groupRoadmapLifecycleBars, UNASSIGNED_GROUP_KEY } from './roadmapLifecycleRows';

function capability(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function system(id: string, name: string, attrs: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function supports(systemId: string, capabilityId: string, role?: string): RelationshipsHeadRow {
  const attrs: Record<string, Json> = role === undefined ? {} : { role };
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: attrs, exists_delta_id: `d-r-${systemId}` };
}

function owns(actorId: string, systemId: string): RelationshipsHeadRow {
  return { relationship_id: `o-${actorId}-${systemId}`, relationship_type: 'owns', from_element_id: actorId, to_element_id: systemId, attributes: { role: 'business' }, exists_delta_id: `d-o-${actorId}` };
}

describe('groupRoadmapLifecycleBars', () => {
  it('drops a system with none of the three lifecycle dates recorded', () => {
    const groups = groupRoadmapLifecycleBars([system('sys-1', 'No Dates')], [], [], new Map());
    expect(groups).toEqual([]);
  });

  it('includes a system with at least one of the three dates recorded', () => {
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01', plannedEnd: '2028-01-01', supportEndsAt: '2026-06-01' });
    const groups = groupRoadmapLifecycleBars([sys], [], [], new Map());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.bars[0]).toMatchObject({ systemId: 'sys-1', introduced: '2020-01-01', plannedEnd: '2028-01-01', supportEndsAt: '2026-06-01' });
  });

  it('groups a system under its primary supports edge\'s level-1 capability ancestor', () => {
    const capsById = new Map([
      ['cap-l1', capability('cap-l1', 'Digital Services')],
      ['cap-l2', capability('cap-l2', 'Housing', 'cap-l1')],
    ]);
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [supports('sys-1', 'cap-l2', 'primary')], [], capsById);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('cap-l1');
    expect(groups[0]?.capability?.name).toBe('Digital Services');
  });

  it('falls into the unassigned group when no supports edge is marked primary', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    // A secondary-only edge, deliberately not marked primary.
    const groups = groupRoadmapLifecycleBars([sys], [supports('sys-1', 'cap-1', 'secondary')], [], capsById);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(UNASSIGNED_GROUP_KEY);
    expect(groups[0]?.capability).toBeUndefined();
  });

  it('sorts the unassigned group last, real groups alphabetically by capability name', () => {
    const capsById = new Map([
      ['cap-z', capability('cap-z', 'Zebra Domain')],
      ['cap-a', capability('cap-a', 'Alpha Domain')],
    ]);
    const systems = [system('sys-z', 'Z System', { introduced: '2020-01-01' }), system('sys-a', 'A System', { introduced: '2020-01-01' }), system('sys-u', 'Unassigned System', { introduced: '2020-01-01' })];
    const edges = [supports('sys-z', 'cap-z', 'primary'), supports('sys-a', 'cap-a', 'primary')];
    const groups = groupRoadmapLifecycleBars(systems, edges, [], capsById);
    expect(groups.map((g) => g.key)).toEqual(['cap-a', 'cap-z', UNASSIGNED_GROUP_KEY]);
  });

  it('collects every owner actor id for a system\'s own owner filter', () => {
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [], [owns('actor-1', 'sys-1'), owns('actor-2', 'sys-1')], new Map());
    expect(groups[0]?.bars[0]?.ownerActorIds).toEqual(['actor-1', 'actor-2']);
  });
});
