import { describe, expect, it } from 'vitest';
import { EMPTY_ROADMAP_FILTERS } from './roadmapFilter';
import {
  parseRoadmapFilters,
  roadmapFiltersToSearchParams,
  parseRoadmapGroupBy,
  roadmapGroupByToSearchParams,
  parseRoadmapGranularity,
  roadmapGranularityToSearchParams,
  parseRoadmapHorizon,
  roadmapHorizonToSearchParams,
  parseRoadmapStartMonth,
  formatRoadmapStartMonth,
  roadmapStartMonthToSearchParams,
} from './roadmapFilterParams';

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

describe('parseRoadmapGroupBy', () => {
  it('defaults to capability for an absent or unknown value', () => {
    expect(parseRoadmapGroupBy(new URLSearchParams())).toBe('capability');
    expect(parseRoadmapGroupBy(new URLSearchParams('groupBy=capability'))).toBe('capability');
    expect(parseRoadmapGroupBy(new URLSearchParams('groupBy=bogus'))).toBe('capability');
  });

  it('reads groupBy=valueStream as valueStream', () => {
    expect(parseRoadmapGroupBy(new URLSearchParams('groupBy=valueStream'))).toBe('valueStream');
  });
});

describe('roadmapGroupByToSearchParams', () => {
  it('writes valueStream, and deletes the param for the capability default', () => {
    expect(roadmapGroupByToSearchParams('valueStream', new URLSearchParams()).get('groupBy')).toBe('valueStream');
    expect(roadmapGroupByToSearchParams('capability', new URLSearchParams('groupBy=valueStream')).has('groupBy')).toBe(false);
  });

  it('never mutates the previous URLSearchParams in place', () => {
    const prev = new URLSearchParams('groupBy=valueStream');
    roadmapGroupByToSearchParams('capability', prev);
    expect(prev.get('groupBy')).toBe('valueStream');
  });
});

describe('parseRoadmapGranularity', () => {
  it('defaults to quarters for an absent or unknown value', () => {
    expect(parseRoadmapGranularity(new URLSearchParams())).toBe('quarters');
    expect(parseRoadmapGranularity(new URLSearchParams('granularity=quarters'))).toBe('quarters');
    expect(parseRoadmapGranularity(new URLSearchParams('granularity=invalid'))).toBe('quarters');
  });

  it('reads months and years values', () => {
    expect(parseRoadmapGranularity(new URLSearchParams('granularity=months'))).toBe('months');
    expect(parseRoadmapGranularity(new URLSearchParams('granularity=years'))).toBe('years');
  });
});

describe('roadmapGranularityToSearchParams', () => {
  it('writes months and years, and deletes the param for the quarters default', () => {
    expect(roadmapGranularityToSearchParams('months', new URLSearchParams()).get('granularity')).toBe('months');
    expect(roadmapGranularityToSearchParams('years', new URLSearchParams()).get('granularity')).toBe('years');
    expect(roadmapGranularityToSearchParams('quarters', new URLSearchParams('granularity=months')).has('granularity')).toBe(false);
  });

  it('never mutates the previous URLSearchParams in place', () => {
    const prev = new URLSearchParams('granularity=months');
    roadmapGranularityToSearchParams('quarters', prev);
    expect(prev.get('granularity')).toBe('months');
  });
});

describe('parseRoadmapHorizon', () => {
  it('defaults to "all" for an absent or unknown value', () => {
    expect(parseRoadmapHorizon(new URLSearchParams())).toBe('all');
    expect(parseRoadmapHorizon(new URLSearchParams('horizon=all'))).toBe('all');
    expect(parseRoadmapHorizon(new URLSearchParams('horizon=bogus'))).toBe('all');
  });

  it('reads 1y and 3y values', () => {
    expect(parseRoadmapHorizon(new URLSearchParams('horizon=1y'))).toBe('1y');
    expect(parseRoadmapHorizon(new URLSearchParams('horizon=3y'))).toBe('3y');
  });
});

describe('roadmapHorizonToSearchParams', () => {
  it('writes 1y/3y and deletes the param for the "all" default', () => {
    expect(roadmapHorizonToSearchParams('1y', new URLSearchParams()).get('horizon')).toBe('1y');
    expect(roadmapHorizonToSearchParams('3y', new URLSearchParams()).get('horizon')).toBe('3y');
    expect(roadmapHorizonToSearchParams('all', new URLSearchParams('horizon=3y')).has('horizon')).toBe(false);
  });
});

describe('parseRoadmapStartMonth', () => {
  it('returns undefined for an absent or invalid value', () => {
    expect(parseRoadmapStartMonth(new URLSearchParams())).toBeUndefined();
    expect(parseRoadmapStartMonth(new URLSearchParams('start=bogus'))).toBeUndefined();
    expect(parseRoadmapStartMonth(new URLSearchParams('start=2026-13'))).toBeUndefined();
  });

  it('parses a valid YYYY-MM into a month-start date', () => {
    const parsed = parseRoadmapStartMonth(new URLSearchParams('start=2026-04'));
    expect(parsed).toEqual(new Date(2026, 3, 1));
  });
});

describe('formatRoadmapStartMonth', () => {
  it('formats a date back to YYYY-MM', () => {
    expect(formatRoadmapStartMonth(new Date(2026, 3, 1))).toBe('2026-04');
    expect(formatRoadmapStartMonth(new Date(2025, 10, 1))).toBe('2025-11');
  });
});

describe('roadmapStartMonthToSearchParams', () => {
  it('writes start and deletes it when undefined', () => {
    expect(roadmapStartMonthToSearchParams(new Date(2026, 0, 1), new URLSearchParams()).get('start')).toBe('2026-01');
    expect(roadmapStartMonthToSearchParams(undefined, new URLSearchParams('start=2026-01')).has('start')).toBe(false);
  });

  it('never mutates the previous URLSearchParams in place', () => {
    const prev = new URLSearchParams('start=2026-01');
    roadmapStartMonthToSearchParams(undefined, prev);
    expect(prev.get('start')).toBe('2026-01');
  });
});
