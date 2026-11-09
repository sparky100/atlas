import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, Json, RelationshipsHeadRow } from '../../contracts/rows';
import { groupBarsByProject, groupBarsByValueStream, groupRoadmapLifecycleBars,
  roadmapBarCaption, NO_PROJECT_LABEL, UNASSIGNED_GROUP_KEY } from './roadmapLifecycleRows';

const href = (id: string): string => `/e/${id}`;

function capability(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function system(id: string, name: string, attrs: Record<string, Json> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: attrs, exists_delta_id: `d-${id}` };
}

function valueStream(id: string, name: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'value_stream', name, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

function supports(systemId: string, capabilityId: string, role?: string): RelationshipsHeadRow {
  const attrs: Record<string, Json> = role === undefined ? {} : { role };
  return { relationship_id: `r-${systemId}-${capabilityId}`, relationship_type: 'supports', from_element_id: systemId, to_element_id: capabilityId, attributes: attrs, exists_delta_id: `d-r-${systemId}` };
}

function enables(capabilityId: string, stageId: string): RelationshipsHeadRow {
  return { relationship_id: `e-${capabilityId}-${stageId}`, relationship_type: 'enables', from_element_id: capabilityId, to_element_id: stageId, attributes: {}, exists_delta_id: `d-e-${capabilityId}` };
}

function owns(actorId: string, systemId: string): RelationshipsHeadRow {
  return { relationship_id: `o-${actorId}-${systemId}`, relationship_type: 'owns', from_element_id: actorId, to_element_id: systemId, attributes: { role: 'business' }, exists_delta_id: `d-o-${actorId}` };
}

describe('groupRoadmapLifecycleBars', () => {
  it('drops a system with none of the three lifecycle dates recorded', () => {
    const groups = groupRoadmapLifecycleBars([system('sys-1', 'No Dates')], [], [], new Map(), href);
    expect(groups).toEqual([]);
  });

  it('includes a system with at least one of the three dates recorded', () => {
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01', plannedEnd: '2028-01-01', supportEndsAt: '2026-06-01' });
    const groups = groupRoadmapLifecycleBars([sys], [], [], new Map(), href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.bars[0]).toMatchObject({ systemId: 'sys-1', introduced: '2020-01-01', plannedEnd: '2028-01-01', supportEndsAt: '2026-06-01' });
  });

  it('groups a system under its primary supports edge\'s level-1 capability ancestor', () => {
    const capsById = new Map([
      ['cap-l1', capability('cap-l1', 'Digital Services')],
      ['cap-l2', capability('cap-l2', 'Housing', 'cap-l1')],
    ]);
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [supports('sys-1', 'cap-l2', 'primary')], [], capsById, href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('cap-l1');
    expect(groups[0]?.label).toBe('Digital Services');
    expect(groups[0]?.href).toBe('/e/cap-l1');
  });

  it('groups under an Also capability when no supports edge is marked Main', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [supports('sys-1', 'cap-1', 'secondary')], [], capsById, href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('cap-1');
    expect(groups[0]?.bars[0]?.capabilityKey).toBe('cap-1');
  });

  it('falls into the not-linked group only when the system supports no capability', () => {
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [], [], new Map(), href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(UNASSIGNED_GROUP_KEY);
    expect(groups[0]?.label).toBe('Not linked to a capability');
    expect(groups[0]?.href).toBeNull();
  });

  it('captions a bar with what its ends mean', () => {
    expect(roadmapBarCaption({ introduced: '2016-12-01', plannedEnd: undefined, supportEndsAt: undefined })).toBe('From 2016-12-01, no end date planned');
    expect(roadmapBarCaption({ introduced: undefined, plannedEnd: '2028-01-01', supportEndsAt: '2026-06-01' })).toBe('Start date not recorded, to 2028-01-01 · vendor support ends 2026-06-01');
  });

  it('sorts the unassigned group last, real groups alphabetically by capability name', () => {
    const capsById = new Map([
      ['cap-z', capability('cap-z', 'Zebra Domain')],
      ['cap-a', capability('cap-a', 'Alpha Domain')],
    ]);
    const systems = [system('sys-z', 'Z System', { introduced: '2020-01-01' }), system('sys-a', 'A System', { introduced: '2020-01-01' }), system('sys-u', 'Unassigned System', { introduced: '2020-01-01' })];
    const edges = [supports('sys-z', 'cap-z', 'primary'), supports('sys-a', 'cap-a', 'primary')];
    const groups = groupRoadmapLifecycleBars(systems, edges, [], capsById, href);
    expect(groups.map((g) => g.key)).toEqual(['cap-a', 'cap-z', UNASSIGNED_GROUP_KEY]);
  });

  it('collects every owner actor id for a system\'s own owner filter', () => {
    const sys = system('sys-1', 'Housing Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [], [owns('actor-1', 'sys-1'), owns('actor-2', 'sys-1')], new Map(), href);
    expect(groups[0]?.bars[0]?.ownerActorIds).toEqual(['actor-1', 'actor-2']);
  });

  it('sets each bar\'s capabilityKey to its own level-1 capability id', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const sys = system('sys-1', 'Portal', { introduced: '2020-01-01' });
    const groups = groupRoadmapLifecycleBars([sys], [supports('sys-1', 'cap-1', 'primary')], [], capsById, href);
    expect(groups[0]?.bars[0]?.capabilityKey).toBe('cap-1');
  });
});

describe('groupBarsByValueStream', () => {
  it('groups a system under the stream its primary capability enables', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const valueStreamsById = new Map([
      ['stream-1', valueStream('stream-1', 'Customer Outcomes')],
      ['stage-1', valueStream('stage-1', 'Getting Connected', 'stream-1')],
    ]);
    const sys = system('sys-1', 'Portal', { introduced: '2020-01-01' });
    const groups = groupBarsByValueStream([sys], [supports('sys-1', 'cap-1', 'primary')], [], capsById, valueStreamsById, [enables('cap-1', 'stage-1')], href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('stream-1');
    expect(groups[0]?.label).toBe('Customer Outcomes');
    expect(groups[0]?.href).toBe('/e/stream-1');
    expect(groups[0]?.bars[0]?.capabilityKey).toBe('cap-1');
  });

  it('shows a system in both streams when its capability enables stages in two', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const valueStreamsById = new Map([
      ['stream-1', valueStream('stream-1', 'Alpha Stream')],
      ['stream-2', valueStream('stream-2', 'Beta Stream')],
      ['stage-1', valueStream('stage-1', 's1', 'stream-1')],
      ['stage-2', valueStream('stage-2', 's2', 'stream-2')],
    ]);
    const sys = system('sys-1', 'Portal', { introduced: '2020-01-01' });
    const groups = groupBarsByValueStream([sys], [supports('sys-1', 'cap-1', 'primary')], [], capsById, valueStreamsById, [enables('cap-1', 'stage-1'), enables('cap-1', 'stage-2')], href);
    expect(groups.map((g) => g.key)).toEqual(['stream-1', 'stream-2']);
  });

  it('falls into the unassigned group when the primary capability enables no stage', () => {
    const capsById = new Map([['cap-1', capability('cap-1', 'Digital Services')]]);
    const sys = system('sys-1', 'Portal', { introduced: '2020-01-01' });
    const groups = groupBarsByValueStream([sys], [supports('sys-1', 'cap-1', 'primary')], [], capsById, new Map(), [], href);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(UNASSIGNED_GROUP_KEY);
    expect(groups[0]?.label).toBe('Not in a value stream');
    expect(groups[0]?.href).toBeNull();
  });
});

describe('groupBarsByProject (F10 step 6)', () => {
  const projects = new Map([
    ['p1', { id: 'p1', title: 'CRM replacement', href: '/projects/p1' }],
    ['p2', { id: 'p2', title: 'Data platform', href: '/projects/p2' }],
  ]);

  it('groups each system under the projects whose changes touch it, and the rest under "No project"', () => {
    const systems = [system('crm', 'Old CRM', { plannedEnd: '2027-01-01' }), system('new', 'New CRM', { introduced: '2026-12-01' }), system('lake', 'Lake', { introduced: '2026-01-01' }), system('other', 'Other', { introduced: '2025-01-01' })];
    const branchEvents = [
      { branch: { project_id: 'p1' }, events: [{ kind: 'replace' as const, fromSystemId: 'crm', toSystemId: 'new' }] },
      { branch: { project_id: 'p2' }, events: [{ kind: 'add' as const, elementId: 'lake' }, { kind: 'retire' as const, elementId: 'crm' }] },
      { branch: { project_id: null }, events: [{ kind: 'add' as const, elementId: 'other' }] },
    ];
    const groups = groupBarsByProject(systems, [], [], new Map(), branchEvents, projects);
    expect(groups.map((g) => [g.label, g.bars.map((b) => b.name)])).toEqual([
      ['CRM replacement', ['New CRM', 'Old CRM']],
      ['Data platform', ['Lake', 'Old CRM']],
      [NO_PROJECT_LABEL, ['Other']],
    ]);
    expect(groups.find((g) => g.key === 'p1')?.href).toBe('/projects/p1');
    expect(groups.find((g) => g.key === UNASSIGNED_GROUP_KEY)?.href).toBeNull();
  });
});
