import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { EMPTY_ROADMAP_FILTERS, type RoadmapFilters } from './roadmapFilter';
import type { RoadmapGroup, RoadmapLifecycleBar } from './roadmapLifecycleRows';
import { computeRoadmapVisibleData, hiddenNoteFor, RECENT_CHANGES_LIMIT, recentRoadmapChanges, roadmapRangeFor } from './roadmapVisibleData';

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

function group(overrides: Partial<RoadmapGroup> = {}): RoadmapGroup {
  return { key: 'cap-1', label: 'Cap 1', href: null, bars: [bar()], ...overrides };
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
    project_id: null,
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
    const openBranch = branch({ status: 'in_review', target_date: '2026-09-01' });
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

describe('recentRoadmapChanges', () => {
  it('returns the most recent changes first, capped at the limit', () => {
    const events: RoadmapBranchEvents[] = [];
    for (let i = 0; i < RECENT_CHANGES_LIMIT + 3; i += 1) {
      events.push({ branch: branch({ id: `b-${String(i)}`, target_date: `2026-0${String(i + 1)}-01` }), events: [{ kind: 'add', elementId: `sys-${String(i)}`, elementName: `System ${String(i)}` }] });
    }
    const rows = recentRoadmapChanges(events);
    expect(rows).toHaveLength(RECENT_CHANGES_LIMIT);
    // Latest target date first.
    expect(rows[0]?.branch.target_date).toBe('2026-09-01');
    expect(rows[rows.length - 1]?.branch.target_date).toBe('2026-04-01');
  });

  it('flattens every event on a branch into its own row', () => {
    const events: RoadmapBranchEvents[] = [
      { branch: branch({ id: 'b-1', target_date: '2026-05-01' }), events: [{ kind: 'add', elementId: 'a', elementName: 'A' }, { kind: 'add', elementId: 'b', elementName: 'B' }] },
    ];
    const rows = recentRoadmapChanges(events);
    expect(rows).toHaveLength(2);
  });
});

describe('the roadmap starts at today', () => {
  const retired = (id: string, plannedEnd: string | undefined) => bar({ systemId: id, name: id, plannedEnd, lifecycleTag: { state: 'retired', plannedEnd } });

  it('hides systems retired before today and counts them once', () => {
    const groups = [group({ bars: [bar({ systemId: 'live' }), retired('old', '2025-01-01')] }), group({ key: 'cap-2', bars: [retired('old', '2025-01-01')] })];
    const { filteredGroups, hiddenRetiredCount } = computeRoadmapVisibleData(groups, [], 'toBe', EMPTY_ROADMAP_FILTERS, NOW);
    expect(filteredGroups).toHaveLength(1);
    expect(filteredGroups[0]?.bars.map((b) => b.systemId)).toEqual(['live']);
    expect(hiddenRetiredCount).toBe(1);
  });

  it('with the past year on, brings back systems retired within it but not older ones', () => {
    const groups = [group({ bars: [retired('recent', '2026-02-01'), retired('ancient', '2024-01-01'), retired('undated', undefined)] })];
    const { filteredGroups, hiddenRetiredCount } = computeRoadmapVisibleData(groups, [], 'toBe', EMPTY_ROADMAP_FILTERS, NOW, true);
    expect(filteredGroups[0]?.bars.map((b) => b.systemId)).toEqual(['recent', 'undated']);
    expect(hiddenRetiredCount).toBe(1);
  });

  it('hides changes delivered before today and counts them, until the past year is on', () => {
    const events = [{ branch: branch({ target_date: '2026-03-01' }), events: [] }, { branch: branch({ id: 'b2', target_date: '2026-09-01' }), events: [] }, { branch: branch({ id: 'b3', target_date: '2024-01-01' }), events: [] }];
    const off = computeRoadmapVisibleData([], events, 'toBe', EMPTY_ROADMAP_FILTERS, NOW);
    expect(off.eligibleEvents.map((e) => e.branch.id)).toEqual(['b2']);
    expect(off.hiddenChangeCount).toBe(2);
    const on = computeRoadmapVisibleData([], events, 'toBe', EMPTY_ROADMAP_FILTERS, NOW, true);
    expect(on.eligibleEvents.map((e) => e.branch.id)).toEqual(['branch-1', 'b2']);
    expect(on.hiddenChangeCount).toBe(1);
  });

  it('starts the range at today and pulls an earlier link start up to it', () => {
    const range = roadmapRangeFor([group({ bars: [bar({ introduced: '2015-01-01', plannedEnd: '2029-01-01' })] })], [], 'toBe', '1y', new Date(2020, 0, 1), NOW, false);
    expect(range.start).toEqual(new Date(2026, 5, 1));
    expect(range.end).toEqual(new Date(2027, 5, 1));
    expect(roadmapRangeFor([group({ bars: [bar({ plannedEnd: '2029-01-01' })] })], [], 'toBe', 'all', undefined, NOW, true).start).toEqual(new Date(2025, 5, 1));
  });

  it('says plainly what was left off', () => {
    expect(hiddenNoteFor(0, 0, false)).toBeNull();
    expect(hiddenNoteFor(1, 0, false)).toBe('1 already-retired system is hidden. Turn on “Show the past year” to see the most recent.');
    expect(hiddenNoteFor(4, 2, false)).toContain('4 already-retired systems and 2 earlier changes are hidden');
    expect(hiddenNoteFor(0, 3, true)).toBe('3 earlier changes from before the past year are not shown.');
  });
});
