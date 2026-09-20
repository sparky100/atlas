import { describe, expect, it } from 'vitest';
import type { BranchRow } from '../../db/types';
import type { RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { roadmapToCsv } from './roadmapExport';
import { UNASSIGNED_GROUP_KEY, type RoadmapCapabilityGroup, type RoadmapLifecycleBar } from './roadmapLifecycleRows';

function bar(overrides: Partial<RoadmapLifecycleBar> = {}): RoadmapLifecycleBar {
  return {
    systemId: 'sys-1',
    name: 'Legacy CRM',
    introduced: '2020-01-01',
    plannedEnd: '2026-06-01',
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

describe('roadmapToCsv', () => {
  it('emits a header row and one lifecycle row per bar, named by its group', () => {
    const groups: RoadmapCapabilityGroup[] = [{ key: 'cap-1', capability: { element_id: 'cap-1', name: 'Customer Contact' } as never, bars: [bar()] }];
    const csv = roadmapToCsv(groups, []);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Type,Capability,System,Introduced,Planned end,Support ends,Criticality,Lifecycle status,Date,Description');
    expect(lines[1]).toBe('Lifecycle,Customer Contact,Legacy CRM,2020-01-01,2026-06-01,,high,active,,');
  });

  it('labels an unassigned group\'s row "Unassigned"', () => {
    const groups: RoadmapCapabilityGroup[] = [{ key: UNASSIGNED_GROUP_KEY, capability: undefined, bars: [bar()] }];
    const csv = roadmapToCsv(groups, []);
    expect(csv.split('\r\n')[1]).toContain('Lifecycle,Unassigned,Legacy CRM');
  });

  it('emits a change row per event, sorted by the branch\'s own target date', () => {
    const early: RoadmapBranchEvents = { branch: branch({ id: 'b-early', target_date: '2026-01-01' }), events: [{ kind: 'add', elementId: 'sys-2', elementName: 'New CRM' }] };
    const late: RoadmapBranchEvents = { branch: branch({ id: 'b-late', target_date: '2026-06-01' }), events: [{ kind: 'retire', elementId: 'sys-1', elementName: 'Legacy CRM' }] };
    const csv = roadmapToCsv([], [late, early]);
    const lines = csv.split('\r\n').slice(1);
    expect(lines[0]).toBe('Change,,New CRM,,,,,,2026-01-01,New CRM added');
    expect(lines[1]).toBe('Change,,Legacy CRM,,,,,,2026-06-01,Legacy CRM retired');
  });

  it('names the capability and both systems on a replacement row', () => {
    const events: RoadmapBranchEvents = {
      branch: branch(),
      events: [{ kind: 'replace', capabilityId: 'cap-1', capabilityName: 'Customer Contact', fromSystemId: 'sys-1', fromSystemName: 'Legacy CRM', toSystemId: 'sys-2', toSystemName: 'New CRM Platform' }],
    };
    const csv = roadmapToCsv([], [events]);
    expect(csv.split('\r\n')[1]).toBe('Change,Customer Contact,New CRM Platform,,,,,,2026-01-15,Legacy CRM replaced by New CRM Platform (Customer Contact)');
  });

  it('quotes a description containing a comma', () => {
    const events: RoadmapBranchEvents = { branch: branch({ target_date: '2026-02-01' }), events: [{ kind: 'add', elementId: 'sys-3', elementName: 'A, B Platform' }] };
    const csv = roadmapToCsv([], [events]);
    expect(csv.split('\r\n')[1]).toContain('"A, B Platform added"');
  });
});
