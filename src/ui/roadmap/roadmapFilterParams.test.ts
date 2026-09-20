import { describe, expect, it } from 'vitest';
import { EMPTY_ROADMAP_FILTERS } from './roadmapFilter';
import { parseRoadmapFilters, roadmapFiltersToSearchParams } from './roadmapFilterParams';

describe('parseRoadmapFilters', () => {
  it('returns the shared empty-filters constant when nothing is set', () => {
    expect(parseRoadmapFilters(new URLSearchParams())).toBe(EMPTY_ROADMAP_FILTERS);
  });

  it('parses comma-separated capability and owner ids, unvalidated', () => {
    const params = new URLSearchParams('capabilities=cap-1,cap-2&owners=actor-1');
    expect(parseRoadmapFilters(params)).toEqual({ capabilityIds: ['cap-1', 'cap-2'], ownerIds: ['actor-1'], criticalities: [], supportEndingSoon: false });
  });

  it('drops an unknown criticality token, keeps the valid ones', () => {
    const params = new URLSearchParams('criticality=critical,bogus,high');
    expect(parseRoadmapFilters(params).criticalities).toEqual(['critical', 'high']);
  });

  it('reads supportEnding=1 as true, anything else as false', () => {
    expect(parseRoadmapFilters(new URLSearchParams('supportEnding=1')).supportEndingSoon).toBe(true);
    expect(parseRoadmapFilters(new URLSearchParams('supportEnding=0')).supportEndingSoon).toBe(false);
  });
});

describe('roadmapFiltersToSearchParams', () => {
  it('writes each active facet as its own param', () => {
    const filters = { capabilityIds: ['cap-1'], ownerIds: [], criticalities: ['high' as const], supportEndingSoon: true };
    const params = roadmapFiltersToSearchParams(filters, new URLSearchParams());
    expect(params.get('capabilities')).toBe('cap-1');
    expect(params.get('owners')).toBeNull();
    expect(params.get('criticality')).toBe('high');
    expect(params.get('supportEnding')).toBe('1');
  });

  it('deletes a facet\'s own param when cleared, rather than writing an empty marker', () => {
    const prev = new URLSearchParams('capabilities=cap-1&supportEnding=1');
    const params = roadmapFiltersToSearchParams(EMPTY_ROADMAP_FILTERS, prev);
    expect(params.has('capabilities')).toBe(false);
    expect(params.has('supportEnding')).toBe(false);
  });

  it('never mutates the previous URLSearchParams in place', () => {
    const prev = new URLSearchParams('capabilities=cap-1');
    roadmapFiltersToSearchParams(EMPTY_ROADMAP_FILTERS, prev);
    expect(prev.get('capabilities')).toBe('cap-1');
  });
});
