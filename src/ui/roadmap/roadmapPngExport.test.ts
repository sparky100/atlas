import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { EMPTY_ROADMAP_FILTERS, type RoadmapFilters } from './roadmapFilter';
import { UNASSIGNED_GROUP_KEY, type RoadmapGroup, type RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapPngPlan } from './roadmapPngExport';
import { computeRoadmapTimelineRange } from './roadmapTimelineScale';

const NOW = new Date('2026-06-15T00:00:00Z');

function bar(overrides: Partial<RoadmapLifecycleBar> = {}): RoadmapLifecycleBar {
  return {
    systemId: 'sys-1',
    name: 'Legacy CRM',
    introduced: '2025-01-01',
    plannedEnd: '2026-12-01',
    supportEndsAt: undefined,
    criticality: 'high',
    lifecycleStatus: 'active',
    ownerActorIds: [],
    ...overrides,
  };
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
    title: 'Sunset legacy CRM',
    description: null,
    target_date: '2026-01-15',
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

describe('computeRoadmapPngPlan', () => {
  it('lays out one row per bar, taller for more rows and groups', () => {
    const groups: RoadmapGroup[] = [{ key: 'cap-1', label: 'Customer Contact', href: '/e/cap-1', bars: [bar()] }];
    const range = computeRoadmapTimelineRange(['2025-01-01', '2026-12-01'], NOW);
    const plan = computeRoadmapPngPlan(groups, [], 'toBe', EMPTY_ROADMAP_FILTERS, range, NOW);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]?.label).toBe('Customer Contact');
    expect(plan.groups[0]?.rows).toHaveLength(1);
    expect(plan.groups[0]?.rows[0]?.name).toBe('Legacy CRM');
    expect(plan.axisY).not.toBeNull();
    expect(plan.width).toBeGreaterThan(0);
    expect(plan.height).toBeGreaterThan(0);
  });

  it('labels an unassigned group "Unassigned"', () => {
    const groups: RoadmapGroup[] = [{ key: UNASSIGNED_GROUP_KEY, label: 'Unassigned', href: null, bars: [bar()] }];
    const range = computeRoadmapTimelineRange(['2025-01-01'], NOW);
    const plan = computeRoadmapPngPlan(groups, [], 'toBe', EMPTY_ROADMAP_FILTERS, range, NOW);
    expect(plan.groups[0]?.label).toBe('Unassigned');
  });

  it('omits the axis and groups entirely once every group is filtered out, but still lays out the changes list', () => {
    const groups: RoadmapGroup[] = [{ key: 'cap-1', label: 'Cap 1', href: null, bars: [bar()] }];
    const filters: RoadmapFilters = { ...EMPTY_ROADMAP_FILTERS, capabilityIds: ['cap-does-not-match'] };
    const branchEvents: RoadmapBranchEvents[] = [{ branch: branch(), events: [{ kind: 'add', elementId: 'sys-2', elementName: 'New CRM' }] }];
    const range = computeRoadmapTimelineRange(['2025-01-01'], NOW);
    const plan = computeRoadmapPngPlan(groups, branchEvents, 'toBe', filters, range, NOW);
    expect(plan.groups).toHaveLength(0);
    expect(plan.axisY).toBeNull();
    expect(plan.changesHeaderY).not.toBeNull();
    expect(plan.changeLines).toHaveLength(1);
    expect(plan.changeLines[0]?.description).toBe('New CRM added');
  });

  it('places an add marker on the added system\'s own row', () => {
    const groups: RoadmapGroup[] = [{ key: 'cap-1', label: 'Cap 1', href: null, bars: [bar({ systemId: 'sys-2', name: 'New CRM' })] }];
    const branchEvents: RoadmapBranchEvents[] = [{ branch: branch({ target_date: '2026-06-01' }), events: [{ kind: 'add', elementId: 'sys-2', elementName: 'New CRM' }] }];
    const range = computeRoadmapTimelineRange(['2025-01-01', '2026-12-01', '2026-06-01'], NOW);
    const plan = computeRoadmapPngPlan(groups, branchEvents, 'toBe', EMPTY_ROADMAP_FILTERS, range, NOW);
    expect(plan.groups[0]?.rows[0]?.markers).toEqual([{ x: expect.any(Number) as number, kind: 'add' }]);
  });

  it('excludes an as-is-ineligible branch\'s events from the changes list', () => {
    const branchEvents: RoadmapBranchEvents[] = [{ branch: branch({ status: 'in_review' }), events: [{ kind: 'add', elementId: 'sys-2', elementName: 'New CRM' }] }];
    const range = computeRoadmapTimelineRange(['2025-01-01'], NOW);
    const plan = computeRoadmapPngPlan([], branchEvents, 'asIs', EMPTY_ROADMAP_FILTERS, range, NOW);
    expect(plan.changeLines).toHaveLength(0);
    expect(plan.changesHeaderY).toBeNull();
  });
});
