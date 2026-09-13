import { describe, expect, it } from 'vitest';
import { EMPTY_LANDSCAPE_FILTERS, type LandscapeFilters } from './landscapeFilter';
import { landscapeFiltersToSearchParams, parseLandscapeFilters } from './landscapeFilterParams';

describe('parseLandscapeFilters', () => {
  it('returns the empty filters for no params at all', () => {
    expect(parseLandscapeFilters(new URLSearchParams())).toEqual(EMPTY_LANDSCAPE_FILTERS);
  });

  it('round-trips a real value for every one of the five facets', () => {
    const params = new URLSearchParams({
      capabilities: 'cap-a,cap-b',
      lifecycle: 'active,retiring',
      criticality: 'critical,high',
      kind: 'platform,application',
      domain: 'it,ot',
    });
    expect(parseLandscapeFilters(params)).toEqual({
      capabilityIds: ['cap-a', 'cap-b'],
      lifecycleStatuses: ['active', 'retiring'],
      criticalities: ['critical', 'high'],
      kinds: ['platform', 'application'],
      domains: ['it', 'ot'],
    });
  });

  it('drops a bad token from an enum facet, silently, rather than erroring or passing it through', () => {
    const params = new URLSearchParams({ lifecycle: 'active,not-a-real-status', criticality: 'nonsense', kind: 'application,bogus', domain: 'it,made-up' });
    expect(parseLandscapeFilters(params)).toEqual({ capabilityIds: [], lifecycleStatuses: ['active'], criticalities: [], kinds: ['application'], domains: ['it'] });
  });

  it('passes a capability id through unvalidated — open-ended, per-model data, not a closed enum', () => {
    const params = new URLSearchParams({ capabilities: 'anything-goes,another-one' });
    expect(parseLandscapeFilters(params)).toEqual({ ...EMPTY_LANDSCAPE_FILTERS, capabilityIds: ['anything-goes', 'another-one'] });
  });

  it('dedupes and trims within a facet', () => {
    const params = new URLSearchParams({ lifecycle: ' active , active,retiring ' });
    expect(parseLandscapeFilters(params).lifecycleStatuses).toEqual(['active', 'retiring']);
  });
});

describe('landscapeFiltersToSearchParams', () => {
  it('round-trips through parseLandscapeFilters for every facet', () => {
    const filters: LandscapeFilters = { capabilityIds: ['cap-a'], lifecycleStatuses: ['active'], criticalities: ['critical'], kinds: ['platform'], domains: ['ot'] };
    const params = landscapeFiltersToSearchParams(filters, new URLSearchParams());
    expect(parseLandscapeFilters(params)).toEqual(filters);
  });

  it('deletes a facet\'s own param entirely once cleared, rather than leaving an empty marker', () => {
    const withFilter = landscapeFiltersToSearchParams({ ...EMPTY_LANDSCAPE_FILTERS, kinds: ['platform'] }, new URLSearchParams());
    expect(withFilter.has('kind')).toBe(true);
    const cleared = landscapeFiltersToSearchParams(EMPTY_LANDSCAPE_FILTERS, withFilter);
    expect(cleared.has('kind')).toBe(false);
    expect(cleared.toString()).toBe('');
  });

  it('copies rather than mutates the given URLSearchParams, preserving an unrelated existing param', () => {
    const prev = new URLSearchParams({ mode: 'diff' });
    const next = landscapeFiltersToSearchParams({ ...EMPTY_LANDSCAPE_FILTERS, domains: ['ot'] }, prev);
    expect(prev.has('domain')).toBe(false);
    expect(next.get('mode')).toBe('diff');
    expect(next.get('domain')).toBe('ot');
  });
});
