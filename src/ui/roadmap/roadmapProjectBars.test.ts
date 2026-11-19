import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { attachProjectBars } from './roadmapProjectBars';
import type { RoadmapGroup } from './roadmapLifecycleRows';

function capability(id: string, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: 'capability', name: `Cap ${id}`, parent_id: parentId, attributes: {}, exists_delta_id: `d-${id}` };
}

const capabilitiesById = new Map([capability('connect'), capability('quote', 'connect'), capability('bill')].map((c) => [c.element_id, c]));
const elementHref = (id: string) => `/e/${id}`;
const projectHref = (id: string) => `/p/${id}`;
const project = (id: string, over: Partial<{ status: string; start_date: string | null; target_date: string | null }> = {}) => ({ id, title: `Project ${id}`, status: 'active', start_date: '2026-12-01', target_date: '2027-03-01', ...over });
const emptyGroups: RoadmapGroup[] = [];

describe('attachProjectBars (plan A3)', () => {
  it('puts a project on the level-1 domain of a sub-capability it serves, spanning its own dates', () => {
    const { groups, unplaced } = attachProjectBars(emptyGroups, { projects: [project('p1')], scope: [{ projectId: 'p1', elementId: 'quote' }], capabilitiesById, elementHref, projectHref });
    expect(unplaced).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'connect', label: 'Cap connect', bars: [] });
    expect(groups[0]?.projectBars).toEqual([{ projectId: 'p1', title: 'Project p1', href: '/p/p1', start: '2026-12-01', target: '2027-03-01' }]);
  });

  it('shows one project on every domain it serves, and once per domain when it names two capabilities there', () => {
    const { groups } = attachProjectBars(emptyGroups, { projects: [project('p1')], scope: [{ projectId: 'p1', elementId: 'connect' }, { projectId: 'p1', elementId: 'quote' }, { projectId: 'p1', elementId: 'bill' }], capabilitiesById, elementHref, projectHref });
    expect(groups.map((g) => [g.key, g.projectBars?.length])).toEqual([['bill', 1], ['connect', 1]]);
  });

  it('adds project bars to an existing system group without disturbing its systems', () => {
    const existing: RoadmapGroup[] = [{ key: 'connect', label: 'Cap connect', href: '/e/connect', bars: [] }];
    const { groups } = attachProjectBars(existing, { projects: [project('p1')], scope: [{ projectId: 'p1', elementId: 'connect' }], capabilitiesById, elementHref, projectHref });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.projectBars).toHaveLength(1);
  });

  it('lists, rather than hides, a project with no dates or no capability', () => {
    const { groups, unplaced } = attachProjectBars(emptyGroups, {
      projects: [project('nodates', { start_date: null, target_date: null }), project('nocap')],
      scope: [{ projectId: 'nodates', elementId: 'connect' }],
      capabilitiesById,
      elementHref,
      projectHref,
    });
    expect(groups).toEqual([]);
    expect(unplaced.map((u) => [u.projectId, u.reason])).toEqual([['nocap', 'no-capability'], ['nodates', 'no-dates']]);
  });

  it('draws a project with only one date as an open-ended bar', () => {
    const { groups } = attachProjectBars(emptyGroups, { projects: [project('p1', { start_date: null })], scope: [{ projectId: 'p1', elementId: 'connect' }], capabilitiesById, elementHref, projectHref });
    expect(groups[0]?.projectBars?.[0]).toMatchObject({ start: undefined, target: '2027-03-01' });
  });

  it('ignores closed and cancelled projects, and scope that is not a capability', () => {
    const { groups, unplaced } = attachProjectBars(emptyGroups, {
      projects: [project('done', { status: 'closed' }), project('sys')],
      scope: [{ projectId: 'done', elementId: 'connect' }, { projectId: 'sys', elementId: 'some-system' }],
      capabilitiesById,
      elementHref,
      projectHref,
    });
    expect(groups).toEqual([]);
    expect(unplaced.map((u) => u.projectId)).toEqual(['sys']);
  });
});
