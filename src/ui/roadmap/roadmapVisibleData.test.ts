import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import { EMPTY_ROADMAP_FILTERS, type RoadmapFilters } from './roadmapFilter';
import type { RoadmapCapabilityGroup, RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapVisibleData } from './roadmapVisibleData';

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

function group(overrides: Partial<RoadmapCapabilityGroup> = {}): RoadmapCapabilityGroup {
  return { key: 'cap-1', capability: undefined, bars: [bar()], ...overrides };
}

function branch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: 'branch-1',
    org_id: 'org-1',
    model_id: 'model-1',
    name: 'change-1',
    kind: 'change',
    status: 'merged',
    base_commit_id: 'commit-1',
    head_commit_id: 'commit-2',
    shared_for_review: false,
    title: 'Change',
    description: null,
    target_date: '2026-03-01',
    split_from: null,
    created_by: 'user-1',
    updated_at: '2026-01-01T00:00:00Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    dismissed_identity_pairs: [],
    intent: 'record',
    ...overrides,
  };
}

describe('computeRoadmapVisibleData', () => {
  it('keeps a group whose bars all match the filters', () => {
    const { filteredGroups } = computeRoadmapVisibleData([group()], [], 'toBe', EMPTY_ROADMAP_FILTERS, NOW);
    expect(filteredGroups).toHaveLength(1);
    expect(filteredGroups[0]?.bars).toHaveLength(1);
  });

  it('drops a group once every one of its bars is filtered out', () => {
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, capabilityIds: ['cap-2'] };
    const { filteredGroups } = computeRoadmapVisibleData([group()], [], 'toBe', filters, NOW);
    expect(filteredGroups).toHaveLength(0);
  });

  it('includes only branches eligible under the given mode', () => {
    const openBranch = branch({ status: 'in_review' });
    const { eligibleEvents } = computeRoadmapVisibleData([], [{ branch: openBranch, events: [] }], 'asIs', EMPTY_ROADMAP_FILTERS, NOW);
    expect(eligibleEvents).toHaveLength(0);

    const { eligibleEvents: toBeEvents } = computeRoadmapVisibleData([], [{ branch: openBranch, events: [] }], 'toBe', EMPTY_ROADMAP_FILTERS, NOW);
    expect(toBeEvents).toHaveLength(1);
  });

  it('matches RoadmapView\'s own inline logic exactly (regression guard for the extraction)', () => {
    const groups = [group({ key: 'cap-1', bars: [bar({ systemId: 'a', criticality: 'critical' }), bar({ systemId: 'b', criticality: 'low' })] })];
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, criticalities: ['critical'] };
    const { filteredGroups } = computeRoadmapVisibleData(groups, [], 'toBe', filters, NOW);
    expect(filteredGroups[0]?.bars.map((b) => b.systemId)).toEqual(['a']);
  });
});
