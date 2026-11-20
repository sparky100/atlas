import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow, ProfileRow, ProjectRow } from '../../db/types';
import { buildMyOwnedWork, buildRecentRecords, buildWhatWeAreDoing, displayNameOf } from './whatWeAreDoing';

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
    ai_draft_agent: null,
    ai_drafted_at: null,
    ai_draft_edited: false,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    cancel_reason: null,
    reconsider_if: null, review_by: null, stay_risk: '', stay_reason: '', baseline_branch_id: null, branch_id: null,
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
    project_manager_id: null,
    project_manager_name: null,
    status: 'active',
    start_date: null,
    target_date: null,
    source_finding_key: null,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    created_by: 'u',
    created_at: '2026-10-01T00:00:00Z',
    accepted_by: null,
    accepted_at: null,
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

describe('buildMyOwnedWork', () => {
  it("lists only the viewer's own open decisions — in a project or not — overdue first, then by needed-by date, naming each one's project", () => {
    const projects = [project({ id: 'p1', title: 'CRM replacement', owner_id: 'someone-else' })];
    const decisions = [
      decision({ id: 'd-mine-later', owner_id: 'me', project_id: null, needed_by: '2026-12-01' }),
      decision({ id: 'd-mine-overdue', owner_id: 'me', project_id: 'p1', needed_by: '2026-09-01' }),
      decision({ id: 'd-mine-decided', owner_id: 'me', status: 'accepted' }),
      decision({ id: 'd-theirs', owner_id: 'someone-else', created_by: 'me' }),
    ];
    const result = buildMyOwnedWork(projects, decisions, [], 'me', TODAY).decisions;
    expect(result.map((d) => [d.decision.id, d.overdue, d.projectTitle])).toEqual([
      ['d-mine-overdue', true, 'CRM replacement'],
      ['d-mine-later', false, null],
    ]);
  });

  it("lists only the viewer's own projects in hand, with the same progress Overview counts", () => {
    const projects = [
      project({ id: 'p-mine', owner_id: 'me' }),
      project({ id: 'p-mine-closed', owner_id: 'me', status: 'closed' }),
      project({ id: 'p-theirs', owner_id: 'someone-else', created_by: 'me' }),
    ];
    const decisions = [decision({ id: 'd1', project_id: 'p-mine', owner_id: 'someone-else' })];
    const result = buildMyOwnedWork(projects, decisions, [], 'me', TODAY).projects;
    expect(result.map((p) => p.project.id)).toEqual(['p-mine']);
    expect(result[0]?.progress.openDecisions).toBe(1);
  });
});

describe('buildRecentRecords', () => {
  const SINCE = '2026-09-01T00:00:00Z';

  it('lists decisions made and projects closed or cancelled after the newest version, newest first', () => {
    const decisions = [
      decision({ id: 'd-made', title: 'Made', status: 'accepted', decided_at: '2026-09-10T00:00:00Z' }),
      decision({ id: 'd-before', status: 'accepted', decided_at: '2026-08-10T00:00:00Z' }),
      decision({ id: 'd-cancelled', status: 'rejected', decided_at: null }),
      decision({ id: 'd-open', status: 'proposed' }),
    ];
    const projects = [
      project({ id: 'p-closed', title: 'Closed', status: 'closed', closed_at: '2026-09-20T00:00:00Z' }),
      project({ id: 'p-cancelled', title: 'Cancelled', status: 'cancelled', closed_at: '2026-09-05T00:00:00Z' }),
      project({ id: 'p-before', status: 'closed', closed_at: '2026-08-01T00:00:00Z' }),
      project({ id: 'p-active', status: 'active' }),
    ];
    expect(buildRecentRecords(decisions, projects, SINCE).map((r) => [r.id, r.outcome])).toEqual([
      ['p-closed', 'closed'],
      ['d-made', 'decided'],
      ['p-cancelled', 'cancelled'],
    ]);
  });

  it('with no version tagged yet, lists every decision made and project ended', () => {
    const decisions = [decision({ id: 'd-old', status: 'accepted', decided_at: '2025-01-01T00:00:00Z' })];
    const projects = [project({ id: 'p-old', status: 'closed', closed_at: '2025-02-01T00:00:00Z' })];
    expect(buildRecentRecords(decisions, projects, null).map((r) => r.id)).toEqual(['p-old', 'd-old']);
  });
});
