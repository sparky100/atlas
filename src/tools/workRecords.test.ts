import { describe, expect, it } from 'vitest';
import type { GoalRow } from '../contracts/goals';
import type { ChangeSummary } from '../db/changeSummary';
import type { BranchRow, DecisionRow, ProjectRow } from '../db/types';
import { runAsk } from './askLoop';
import type { AskModelClient } from './askLoop';
import { callTool } from './index';
import { estateContext, uid } from './fixtures/estateSnapshot';
import type { ToolResult } from './types';

type Rec = Record<string, unknown>;
const data = (r: ToolResult): Rec => {
  if (!r.ok) throw new Error(r.error);
  return r.data as Rec;
};

function branch(n: number, over: Partial<BranchRow> = {}): BranchRow {
  return { id: uid(n), org_id: uid(900), model_id: uid(901), name: `change-${String(n)}`, kind: 'change', status: 'draft', base_commit_id: uid(903), head_commit_id: uid(904), shared_for_review: false, title: `Change ${String(n)}`, description: 'Does a thing', target_date: '2026-12-01', split_from: null, created_by: uid(902), updated_at: '', cancel_reason: null, cancelled_at: null, cancelled_by: null, dismissed_identity_pairs: [], intent: 'propose', project_id: null, ...over };
}
function decision(n: number, over: Partial<DecisionRow> = {}): DecisionRow {
  return { id: uid(n), org_id: uid(900), model_id: uid(901), title: `Decision ${String(n)}`, statement: 'Which way?', status: 'proposed', owner_id: uid(902), needed_by: '2026-12-15', source_finding_key: null, lens_map_url: null, decided_by: null, decided_at: null, cancel_reason: null, branch_id: null, superseded_decision_id: null, project_id: null, created_by: uid(902), created_at: '', ...over };
}
function project(n: number, over: Partial<ProjectRow> = {}): ProjectRow {
  return { id: uid(n), org_id: uid(900), model_id: uid(901), title: `Project ${String(n)}`, purpose: 'Retire the legacy estate', owner_id: uid(902), project_manager_id: null, project_manager_name: null, status: 'active', start_date: '2026-01-01', target_date: '2027-01-01', source_finding_key: null, closed_by: null, closed_at: null, close_reason: null, created_by: uid(902), created_at: '', ...over };
}

describe('list_changes', () => {
  const changes = [branch(500), branch(501, { status: 'merged' }), branch(502, { status: 'cancelled' }), branch(503, { status: 'in_review' })];

  it('lists open changes by default and all of them on request, with a true total', async () => {
    const ctx = estateContext({ changes });
    const open = data(await callTool(ctx, 'list_changes', {})) as { changes: { changeId: string; status: string }[] };
    expect(open.changes.map((c) => c.status).sort()).toEqual(['draft', 'in_review']);
    const all = await callTool(ctx, 'list_changes', { scope: 'all', limit: 2 });
    expect(all.ok && all.total).toBe(4);
    expect(all.ok && all.truncated).toBe(true);
  });

  it('never calls a change `id`, so it cannot be cited as an element', async () => {
    const result = data(await callTool(estateContext({ changes }), 'list_changes', {}));
    expect(JSON.stringify(result)).not.toMatch(/"id":/);
  });
});

describe('change_impact', () => {
  const change = branch(510);
  const summary = {
    subjects: [
      { subjectType: 'element', elementType: 'system', subjectId: uid(10), name: 'CRM Platform', deltas: [] },
      { subjectType: 'relationship', relationshipType: 'uses', subjectId: uid(106), name: 'uses CRM → Data Warehouse', deltas: [] },
    ],
    affectedCapabilities: [
      {
        capability: { element_id: uid(1), element_type: 'capability', name: 'Customer Onboarding', parent_id: null, attributes: {}, exists_delta_id: uid(999) },
        viaSystems: [{ element_id: uid(10), element_type: 'system', name: 'CRM Platform', parent_id: null, attributes: {}, exists_delta_id: uid(999) }],
        reasons: [{ kind: 'edited', systemName: 'CRM Platform' }],
      },
    ],
    affectedValueStreams: [],
    otherOpenChanges: [{ branch: branch(511, { status: 'proposed' }), sharedElementNames: ['CRM Platform'] }],
    impactProblems: { capabilitiesLeftWithoutSystem: [], providerProblems: [] },
    captureDraftOverlaps: [],
    sourcesById: new Map(),
    projectScopeIds: null,
  } as unknown as ChangeSummary;

  it('names what a change touches, who it affects, and which other changes overlap', async () => {
    const ctx = estateContext({ changes: [change], impact: { [change.id]: summary } });
    const out = data(await callTool(ctx, 'change_impact', { changeId: change.id })) as { touched: Rec[]; affectedCapabilities: Rec[]; otherOpenChanges: Rec[]; counts: Rec };
    expect(out.touched).toEqual([{ id: uid(10), type: 'system', name: 'CRM Platform' }, { relationship: 'uses', name: 'uses CRM → Data Warehouse' }]);
    expect(out.affectedCapabilities[0]).toMatchObject({ id: uid(1), name: 'Customer Onboarding', reasons: [{ kind: 'edited', systemName: 'CRM Platform' }] });
    expect(out.otherOpenChanges[0]).toMatchObject({ changeId: uid(511), sharedElements: ['CRM Platform'] });
    expect(out.counts).toMatchObject({ touched: 2, affectedCapabilities: 1 });
  });

  it('says so when a change has made no edits yet, and refuses an unknown change', async () => {
    const ctx = estateContext({ changes: [change] });
    expect(data(await callTool(ctx, 'change_impact', { changeId: change.id })).note).toMatch(/not made any edits/);
    const unknown = await callTool(ctx, 'change_impact', { changeId: uid(999) });
    expect(unknown.ok).toBe(false);
  });
});

describe('list_decisions', () => {
  it('lists decisions, filters by status, and names the elements an open one concerns', async () => {
    const ctx = estateContext({
      decisions: [decision(520), decision(521, { status: 'accepted', decided_at: '2026-10-01' })],
      decisionLinks: [{ decisionId: uid(520), elementId: uid(10) }],
    });
    const all = data(await callTool(ctx, 'list_decisions', {})) as { decisions: { decisionId: string; concerns: Rec[] }[] };
    expect(all.decisions).toHaveLength(2);
    expect(all.decisions.find((d) => d.decisionId === uid(520))?.concerns).toEqual([{ id: uid(10), type: 'system', name: 'CRM Platform' }]);
    const open = data(await callTool(ctx, 'list_decisions', { status: 'proposed' })) as { decisions: unknown[] };
    expect(open.decisions).toHaveLength(1);
  });
});

function goal(n: number, over: Partial<GoalRow> = {}): GoalRow {
  return { id: uid(n), org_id: uid(900), model_id: uid(901), title: `Goal ${String(n)}`, statement: 'Connect customers faster.', why_now: '', status: 'active', created_by: uid(902), created_at: '', retired_by: null, retired_at: null, ...over };
}

describe('list_goals', () => {
  it('lists active goals with the capabilities that serve them, and names the goal `goalId`', async () => {
    const ctx = estateContext({
      goals: [goal(550, { why_now: 'Regulator deadline.' }), goal(551, { status: 'retired', retired_by: uid(902), retired_at: '2026-11-01' })],
      goalLinks: [{ goal_id: uid(550), capability_id: uid(10), created_by: uid(902), created_at: '' }, { goal_id: uid(550), capability_id: uid(9999), created_by: uid(902), created_at: '' }],
    });
    const result = data(await callTool(ctx, 'list_goals', {})) as { goals: { goalId: string; whyNow: string | null; capabilities: Rec[] }[] };
    expect(result.goals.map((g) => g.goalId)).toEqual([uid(550)]);
    expect(result.goals[0]?.whyNow).toBe('Regulator deadline.');
    expect(result.goals[0]?.capabilities.length).toBeLessThanOrEqual(1);
    const retired = data(await callTool(ctx, 'list_goals', { status: 'retired' })) as { goals: { goalId: string }[] };
    expect(retired.goals.map((g) => g.goalId)).toEqual([uid(551)]);
  });
});

describe('list_projects', () => {
  it('lists projects and filters by status', async () => {
    const ctx = estateContext({ projects: [project(530), project(531, { status: 'closed' })] });
    const active = data(await callTool(ctx, 'list_projects', { status: 'active' })) as { projects: { projectId: string }[] };
    expect(active.projects.map((p) => p.projectId)).toEqual([uid(530)]);
  });
});

describe('citations and non-element ids', () => {
  it('does not accept a change, decision, project or report id as an element citation', async () => {
    const ctx = estateContext({ changes: [branch(540)], decisions: [decision(541)], projects: [project(542)] });
    let step = 0;
    const client: AskModelClient = {
      complete: () => {
        step += 1;
        if (step === 1) {
          return Promise.resolve({ text: '', stopReason: 'tool_use', toolCalls: [{ id: 'a', name: 'list_changes', input: {} }, { id: 'b', name: 'list_decisions', input: {} }, { id: 'c', name: 'list_projects', input: {} }], inputTokens: 1, outputTokens: 1 });
        }
        return Promise.resolve({ text: `[[element:${uid(540)}]] [[element:${uid(541)}]] [[element:${uid(542)}]]`, stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 });
      },
    };
    const result = await runAsk({ client, ctx, history: [], question: 'What work is going on?' });
    expect(result.citations).toEqual([]);
    expect(result.unverifiedRemoved).toBe(3);
  });
});
