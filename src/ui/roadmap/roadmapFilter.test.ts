import { describe, expect, it } from 'vitest';
import type { RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { EMPTY_ROADMAP_FILTERS, hasActiveRoadmapFilters, matchesRoadmapFilters, type RoadmapFilters } from './roadmapFilter';

const NOW = new Date('2026-06-15T00:00:00Z');

function bar(overrides: Partial<RoadmapLifecycleBar> = {}): RoadmapLifecycleBar {
  return {
    systemId: 'sys-1',
    name: 'System',
    introduced: undefined,
    plannedEnd: undefined,
    supportEndsAt: undefined,
    criticality: undefined,
    lifecycleStatus: undefined,
    ownerActorIds: [],
    ...overrides,
  };
}

describe('hasActiveRoadmapFilters', () => {
  it('is false for the empty filter set', () => {
    expect(hasActiveRoadmapFilters(EMPTY_ROADMAP_FILTERS)).toBe(false);
  });

  it('is true when any one facet is set', () => {
    expect(hasActiveRoadmapFilters({ ...EMPTY_ROADMAP_FILTERS, supportEndingSoon: true })).toBe(true);
  });
});

describe('matchesRoadmapFilters', () => {
  it('matches everything when no filter is active', () => {
    expect(matchesRoadmapFilters(bar(), 'cap-1', EMPTY_ROADMAP_FILTERS, NOW)).toBe(true);
  });

  it('capability facet matches the bar\'s own group key', () => {
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, capabilityIds: ['cap-1'] };
    expect(matchesRoadmapFilters(bar(), 'cap-1', filters, NOW)).toBe(true);
    expect(matchesRoadmapFilters(bar(), 'cap-2', filters, NOW)).toBe(false);
  });

  it('owner facet matches any of the bar\'s own owner actor ids', () => {
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, ownerIds: ['actor-1'] };
    expect(matchesRoadmapFilters(bar({ ownerActorIds: ['actor-1', 'actor-2'] }), 'cap-1', filters, NOW)).toBe(true);
    expect(matchesRoadmapFilters(bar({ ownerActorIds: ['actor-2'] }), 'cap-1', filters, NOW)).toBe(false);
  });

  it('criticality facet excludes a bar with no recorded criticality, not exempts it', () => {
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, criticalities: ['critical'] };
    expect(matchesRoadmapFilters(bar(), 'cap-1', filters, NOW)).toBe(false);
    expect(matchesRoadmapFilters(bar({ criticality: 'critical' }), 'cap-1', filters, NOW)).toBe(true);
  });

  it('support-ending-soon matches within STALE_AFTER_MONTHS (12) of now, not beyond it', () => {
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, supportEndingSoon: true };
    expect(matchesRoadmapFilters(bar({ supportEndsAt: '2027-01-01' }), 'cap-1', filters, NOW)).toBe(true); // ~6.5 months out
    expect(matchesRoadmapFilters(bar({ supportEndsAt: '2029-01-01' }), 'cap-1', filters, NOW)).toBe(false);
    expect(matchesRoadmapFilters(bar(), 'cap-1', filters, NOW)).toBe(false); // no supportEndsAt at all
  });
});
