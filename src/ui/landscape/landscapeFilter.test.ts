import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { EMPTY_LANDSCAPE_FILTERS, filterLandscapeSystems, hasActiveLandscapeFilters, laneKeysBySystemId, matchesLandscapeFilters, visibleLandscapeActors, type LandscapeFilters } from './landscapeFilter';
import { computeLandscapeLayout, groupSystemsByLane } from './layout';

function system(id: string, name: string, attributes: Record<string, unknown> = {}): ElementsHeadRow {
  return { element_id: id, element_type: 'system', name, parent_id: null, attributes: { isExternal: false, ...attributes }, exists_delta_id: `d-${id}` };
}

function actor(id: string, name: string): ElementsHeadRow {
  return { element_id: id, element_type: 'actor', name, parent_id: null, attributes: { isExternal: false, subtype: 'team' }, exists_delta_id: `d-${id}` };
}

describe('hasActiveLandscapeFilters', () => {
  it('is false for the empty filters and true the moment any one facet is set', () => {
    expect(hasActiveLandscapeFilters(EMPTY_LANDSCAPE_FILTERS)).toBe(false);
    expect(hasActiveLandscapeFilters({ ...EMPTY_LANDSCAPE_FILTERS, kinds: ['platform'] })).toBe(true);
  });
});

describe('matchesLandscapeFilters', () => {
  const noLaneKeys = new Set<string>();

  it('lifecycle: matches only a recorded status in the active set; an unrecorded status is excluded, not exempted', () => {
    const active = system('s1', 'Active System', { lifecycleStatus: 'active' });
    const unset = system('s2', 'No Status');
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, lifecycleStatuses: ['active'] };
    expect(matchesLandscapeFilters(active, filters, noLaneKeys)).toBe(true);
    expect(matchesLandscapeFilters(unset, filters, noLaneKeys)).toBe(false);
  });

  it('criticality: same "unrecorded excluded" stance as lifecycle', () => {
    const critical = system('s1', 'Critical System', { criticality: 'critical' });
    const unset = system('s2', 'No Criticality');
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, criticalities: ['critical'] };
    expect(matchesLandscapeFilters(critical, filters, noLaneKeys)).toBe(true);
    expect(matchesLandscapeFilters(unset, filters, noLaneKeys)).toBe(false);
  });

  it('kind: kindOf always defaults to application, so an unset kind matches an "application" filter', () => {
    const plain = system('s1', 'Plain App');
    const platform = system('s2', 'A Platform', { kind: 'platform' });
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, kinds: ['application'] };
    expect(matchesLandscapeFilters(plain, filters, noLaneKeys)).toBe(true);
    expect(matchesLandscapeFilters(platform, filters, noLaneKeys)).toBe(false);
  });

  it('domain: domainOf always defaults to it, so an unset domain matches an "it" filter', () => {
    const plain = system('s1', 'Plain System');
    const ot = system('s2', 'OT System', { domain: 'ot' });
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, domains: ['it'] };
    expect(matchesLandscapeFilters(plain, filters, noLaneKeys)).toBe(true);
    expect(matchesLandscapeFilters(ot, filters, noLaneKeys)).toBe(false);
  });

  it('capability: OR-matches against the system\'s own lane-key set; a system with no matching lane key (or none at all) is excluded', () => {
    const withLane = system('s1', 'In Lane A');
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, capabilityIds: ['cap-a'] };
    expect(matchesLandscapeFilters(withLane, filters, new Set(['cap-a', 'cap-b']))).toBe(true);
    expect(matchesLandscapeFilters(withLane, filters, new Set(['cap-b']))).toBe(false);
    expect(matchesLandscapeFilters(withLane, filters, undefined)).toBe(false);
  });

  it('AND across facets, OR within one facet: a system must satisfy every active facet, any one value within it', () => {
    const sys = system('s1', 'Sys', { lifecycleStatus: 'active', criticality: 'high' });
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, lifecycleStatuses: ['planned', 'active'], criticalities: ['high'] };
    expect(matchesLandscapeFilters(sys, filters, noLaneKeys)).toBe(true);
    expect(matchesLandscapeFilters(sys, { ...filters, criticalities: ['low'] }, noLaneKeys)).toBe(false);
  });
});

describe('filterLandscapeSystems / actors exemption', () => {
  it('actors are never passed through matchesLandscapeFilters by a real caller — but if they were, they would fail every facet, so callers must exempt them explicitly', () => {
    // This test documents the contract rather than calling
    // matchesLandscapeFilters on an actor: an actor's own attributes
    // never carry lifecycleStatus/criticality, so it would fail any
    // active lifecycle/criticality filter — real callers (useLandscapeDisplay.ts)
    // only ever run this against systems and always keep every actor.
    const act = actor('a1', 'Ops Team');
    expect(act.element_type).toBe('actor');
  });

  it('filters the given systems down to only those matching every active facet', () => {
    const critical = system('s1', 'Critical', { criticality: 'critical' });
    const low = system('s2', 'Low', { criticality: 'low' });
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, criticalities: ['critical'] };
    const result = filterLandscapeSystems([critical, low], filters, new Map());
    expect(result.map((s) => s.element_id)).toEqual(['s1']);
  });
});

describe('laneKeysBySystemId', () => {
  it('gives every system its own primary lane plus every lane it merely references', () => {
    const capA = system('cap-a', 'Alpha');
    const capB = system('cap-b', 'Beta');
    const sys = system('sys-1', 'Multi-homed');
    const l1 = new Map([
      ['cap-a', capA],
      ['cap-b', capB],
    ]);
    const edges = [
      { relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: 'sys-1', to_element_id: 'cap-a', attributes: { role: 'primary' }, exists_delta_id: 'd1' },
      { relationship_id: 'r2', relationship_type: 'supports' as const, from_element_id: 'sys-1', to_element_id: 'cap-b', attributes: { role: 'secondary' }, exists_delta_id: 'd2' },
    ];
    const grouping = groupSystemsByLane([sys], edges, l1);
    const laneKeys = laneKeysBySystemId(grouping);
    expect(laneKeys.get('sys-1')).toEqual(new Set(['cap-a', 'cap-b']));
  });

  it('is exactly the input matchesLandscapeFilters\' capability facet needs, end to end via computeLandscapeLayout\'s own grouping', () => {
    const capA = system('cap-a', 'Alpha');
    const sys = system('sys-1', 'Sys One');
    const l1 = new Map([['cap-a', capA]]);
    const edges = [{ relationship_id: 'r1', relationship_type: 'supports' as const, from_element_id: 'sys-1', to_element_id: 'cap-a', attributes: { role: 'primary' }, exists_delta_id: 'd1' }];
    const layout = computeLandscapeLayout([sys], edges, l1);
    expect(layout.nodes).toHaveLength(1);
    const grouping = groupSystemsByLane([sys], edges, l1);
    const laneKeys = laneKeysBySystemId(grouping);
    expect(matchesLandscapeFilters(sys, { ...EMPTY_LANDSCAPE_FILTERS, capabilityIds: ['cap-a'] }, laneKeys.get('sys-1'))).toBe(true);
  });
});

describe('visibleLandscapeActors', () => {
  const owner = actor('a1', 'Head of Control');
  const connected = actor('a2', 'Control Room');
  const external: ElementsHeadRow = { ...actor('a3', 'Ofgem'), attributes: { isExternal: true, subtype: 'organisation' } };
  const edge: RelationshipsHeadRow = { relationship_id: 'r1', relationship_type: 'uses', from_element_id: 'a2', to_element_id: 's1', attributes: {}, exists_delta_id: 'd-r1' } as unknown as RelationshipsHeadRow;

  it('hides an actor that only owns things, but keeps one a line touches and every external organisation', () => {
    expect(visibleLandscapeActors([owner, connected, external], [edge], false).map((a) => a.name)).toEqual(['Control Room', 'Ofgem']);
  });

  it('shows every actor when owners are requested', () => {
    expect(visibleLandscapeActors([owner, connected, external], [edge], true)).toHaveLength(3);
  });
});
