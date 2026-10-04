import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow, ProfileRow, ProjectRow } from '../../db/types';
import { buildWhatWeAreDoing, displayNameOf } from './whatWeAreDoing';

function branch(overrides: Partial<BranchRow>): BranchRow {
  return {
    id: 'b',
    org_id: 'o',
    model_id: 'm',
    name: 'b',
    kind: 'change',
    status: 'draft',
    base_commit_id: 'c',
    head_commit_id: 'c',
    shared_for_review: false,
    title: null,
    description: null,
    target_date: null,
    split_from: null,
    created_by: 'u',
    updated_at: '2026-10-01T00:00:00Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    dismissed_identity_pairs: [],
    intent: 'propose',
    project_id: 'p',
    ...overrides,
  };
}

function decision(overrides: Partial<DecisionRow>): DecisionRow {
  return {
    id: 'd',
    org_id: 'o',
    model_id: 'm',
    title: 'd',
    statement: '',
    status: 'proposed',
    owner_id: 'u',
    needed_by: null,
    source_finding_key: null,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    cancel_reason: null,
    branch_id: null,
    superseded_decision_id: null,
    project_id: 'p',
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function project(overrides: Partial<ProjectRow>): ProjectRow {
  return {
    id: 'p',
    org_id: 'o',
    model_id: 'm',
    title: 'p',
    purpose: '',
    owner_id: 'u',
    status: 'active',
    start_date: null,
    target_date: null,
    source_finding_key: null,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function profile(userId: string, displayName: string | null, handle = `h-${userId}`): ProfileRow {
  return { user_id: userId, display_name: displayName, handle, avatar_url: null, updated_at: '2026-10-01T00:00:00Z' };
}

const TODAY = '2026-10-04';
const NO_PROFILES = new Map<string, ProfileRow>();

describe('buildWhatWeAreDoing', () => {
  it('lists projects in hand only — active, then on hold — never closed or cancelled ones', () => {
    const projects = [
      project({ id: 'p-held', title: 'Held', status: 'on_hold' }),
      project({ id: 'p-closed', title: 'Closed', status: 'closed' }),
      project({ id: 'p-cancelled', title: 'Cancelled', status: 'cancelled' }),
      project({ id: 'p-active', title: 'Active', status: 'active' }),
    ];
    const result = buildWhatWeAreDoing(projects, [], [], NO_PROFILES, TODAY);
    expect(result.projects.map((p) => p.project.id)).toEqual(['p-active', 'p-held']);
  });

  it('orders projects of the same status by target date, none last, then title', () => {
    const projects = [
      project({ id: 'p-none', title: 'A no date', target_date: null }),
      project({ id: 'p-late', title: 'Late', target_date: '2027-06-01' }),
      project({ id: 'p-soon', title: 'Soon', target_date: '2026-12-01' }),
    ];
    expect(buildWhatWeAreDoing(projects, [], [], NO_PROFILES, TODAY).projects.map((p) => p.project.id)).toEqual(['p-soon', 'p-late', 'p-none']);
  });

  it("counts a project's own changes and decisions only, as progress — every change kind, since they're its design deliverables", () => {
    const projects = [project({ id: 'p1' }), project({ id: 'p2', title: 'Other' })];
    const changes = [
      branch({ id: 'b1', project_id: 'p1', status: 'draft', intent: 'explore' }),
      branch({ id: 'b2', project_id: 'p1', status: 'merged' }),
      branch({ id: 'b3', project_id: 'p2', status: 'in_review' }),
      branch({ id: 'b4', project_id: null, status: 'draft', intent: 'correct' }),
    ];
    const decisions = [decision({ id: 'd1', project_id: 'p1' }), decision({ id: 'd2', project_id: 'p1', status: 'accepted' }), decision({ id: 'd3', project_id: null })];
    const p1 = buildWhatWeAreDoing(projects, decisions, changes, NO_PROFILES, TODAY).projects.find((p) => p.project.id === 'p1');
    expect(p1?.progress).toEqual({ openChanges: 1, mergedChanges: 1, openDecisions: 1, decidedDecisions: 1 });
  });

  it("flags a project's overdue decisions and names the next one due", () => {
    const decisions = [
      decision({ id: 'd-overdue', needed_by: '2026-09-01' }),
      decision({ id: 'd-later', needed_by: '2026-12-01' }),
      decision({ id: 'd-next', needed_by: '2026-11-01' }),
      decision({ id: 'd-decided-late', needed_by: '2026-08-01', status: 'accepted' }),
    ];
    const summary = buildWhatWeAreDoing([project({})], decisions, [], NO_PROFILES, TODAY).projects[0];
    expect(summary?.overdueDecisions).toBe(1);
    expect(summary?.nextDecisionDue).toBe('2026-11-01');
  });

  it('lists open decisions outside any project — overdue first, then by needed-by date (none last), then title', () => {
    const decisions = [
      decision({ id: 'd-in-project', project_id: 'p' }),
      decision({ id: 'd-accepted', project_id: null, status: 'accepted' }),
      decision({ id: 'd-none', title: 'A', project_id: null, needed_by: null }),
      decision({ id: 'd-soon', project_id: null, needed_by: '2026-10-20' }),
      decision({ id: 'd-overdue', project_id: null, needed_by: '2026-09-30' }),
    ];
    const result = buildWhatWeAreDoing([], decisions, [], NO_PROFILES, TODAY).decisionsOutsideProjects;
    expect(result.map((d) => [d.decision.id, d.overdue])).toEqual([
      ['d-overdue', true],
      ['d-soon', false],
      ['d-none', false],
    ]);
  });

  it('names owners from their profiles', () => {
    const profiles = new Map([['u-1', profile('u-1', 'Sam Lee')]]);
    const result = buildWhatWeAreDoing([project({ owner_id: 'u-1' })], [decision({ project_id: null, owner_id: 'u-1' })], [], profiles, TODAY);
    expect(result.projects[0]?.ownerDisplay).toBe('Sam Lee');
    expect(result.decisionsOutsideProjects[0]?.ownerDisplay).toBe('Sam Lee');
  });
});

describe('displayNameOf', () => {
  it('prefers the display name, then the handle, then the bare id', () => {
    const profiles = new Map([
      ['u-1', profile('u-1', 'Sam Lee')],
      ['u-2', profile('u-2', null, 'sam2')],
    ]);
    expect(displayNameOf('u-1', profiles)).toBe('Sam Lee');
    expect(displayNameOf('u-2', profiles)).toBe('sam2');
    expect(displayNameOf('u-3', profiles)).toBe('u-3');
  });
});
