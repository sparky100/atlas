import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionArgumentRow, DecisionLinkRow, DecisionOptionRow, DecisionRow } from '../../db/types';
import { decisionComparisonKey } from './decisionComparisonKey';
import { applyDecisionUpdate, applyNewConcern, applyNewOption, type DecisionPageState } from './useDecision';

const DECISION_ID = 'decision-1';
const BRANCH_ID = 'branch-1';

function makeDecision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    id: DECISION_ID,
    org_id: 'org-1',
    model_id: 'model-1',
    title: 'A decision',
    statement: 'A statement',
    status: 'proposed',
    owner_id: 'user-1',
    needed_by: null,
    source_finding_key: null,
    ai_draft_agent: null,
    ai_drafted_at: null,
    ai_draft_edited: false,
    lens_map_url: null,
    decided_by: null,
    decided_at: null,
    cancel_reason: null,
    reconsider_if: null, review_by: null, stay_risk: '', stay_reason: '', baseline_option_id: null, baseline_branch_id: null, branch_id: null,
    superseded_decision_id: null,
    project_id: null,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeBranch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: BRANCH_ID,
    org_id: 'org-1',
    model_id: 'model-1',
    name: 'option-a',
    kind: 'change',
    status: 'draft',
    base_commit_id: 'commit-1',
    head_commit_id: 'commit-1',
    shared_for_review: false,
    title: null,
    description: null,
    target_date: null,
    split_from: null,
    created_by: 'user-1',
    updated_at: '2026-01-01T00:00:00Z',
    cancel_reason: null,
    cancelled_at: null,
    cancelled_by: null,
    dismissed_identity_pairs: [],
    intent: 'explore',
    project_id: null,
    ...overrides,
  };
}

function makeLink(overrides: Partial<DecisionLinkRow> = {}): DecisionLinkRow {
  return {
    decision_id: DECISION_ID,
    linked_type: 'branch',
    linked_id: BRANCH_ID,
    created_by: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeOption(overrides: Partial<DecisionOptionRow> = {}): DecisionOptionRow {
  return {
    id: 'option-1', decision_id: DECISION_ID, branch_id: BRANCH_ID, title: 'Option A', summary: '', to_weigh: '',
    position: 1, approach: null, source: 'manual', agent: null, drafted_at: null, draft_run_id: null, edited_by: null, edited_at: null,
    created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_by: 'user-1', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function readyState(overrides: Partial<Extract<DecisionPageState, { status: 'ready' }>> = {}): DecisionPageState {
  return {
    status: 'ready',
    decision: makeDecision(),
    links: [],
    linkedElementsById: new Map(),
    linkedBranchesById: new Map(),
    options: [],
    args: [],
    ...overrides,
  };
}

describe('applyDecisionUpdate', () => {
  it('patches the decision row in ready state', () => {
    const state = readyState();
    const updated = makeDecision({ status: 'accepted', branch_id: BRANCH_ID, decided_at: '2026-02-01T00:00:00Z' });
    const next = applyDecisionUpdate(state, updated);
    expect(next).toEqual({ ...state, decision: updated });
  });

  it('never produces a loading state — a no-op before the first load completes', () => {
    const loading: DecisionPageState = { status: 'loading' };
    expect(applyDecisionUpdate(loading, makeDecision())).toBe(loading);

    const notFound: DecisionPageState = { status: 'not_found' };
    expect(applyDecisionUpdate(notFound, makeDecision())).toBe(notFound);

    const error: DecisionPageState = { status: 'error', message: 'boom' };
    expect(applyDecisionUpdate(error, makeDecision())).toBe(error);
  });
});

describe('applyNewOption', () => {
  it('appends the new link and branch in ready state', () => {
    const state = readyState();
    const link = makeLink();
    const branch = makeBranch();
    const next = applyNewOption(state, link, branch);
    expect(next.status).toBe('ready');
    if (next.status !== 'ready') throw new Error('expected ready');
    expect(next.links).toEqual([link]);
    expect(next.linkedBranchesById.get(BRANCH_ID)).toBe(branch);
  });

  it('also keeps the option identity when the trigger-created row is read back', () => {
    const option = makeOption();
    const next = applyNewOption(readyState(), makeLink(), makeBranch(), option);
    if (next.status !== 'ready') throw new Error('expected ready');
    expect(next.options).toEqual([option]);
  });

  it('never produces a loading state — a no-op before the first load completes', () => {
    const loading: DecisionPageState = { status: 'loading' };
    expect(applyNewOption(loading, makeLink(), makeBranch())).toBe(loading);
  });
});

describe('applyNewConcern', () => {
  it('appends the concern link and its element in ready state, keeping what was there', () => {
    const optionLink = makeLink();
    const state = readyState({ links: [optionLink] });
    const link = makeLink({ linked_type: 'element', linked_id: 'cap-1' });
    const element = { element_id: 'cap-1', element_type: 'capability', name: 'Billing', parent_id: null, attributes: {}, exists_delta_id: 'd-cap-1' } as const;
    const next = applyNewConcern(state, link, element);
    if (next.status !== 'ready') throw new Error('expected ready');
    expect(next.links).toEqual([optionLink, link]);
    expect(next.linkedElementsById.get('cap-1')).toBe(element);
  });

  it('is a no-op before the first load completes', () => {
    const loading: DecisionPageState = { status: 'loading' };
    expect(applyNewConcern(loading, makeLink(), { element_id: 'x', element_type: 'system', name: 'X', parent_id: null, attributes: {}, exists_delta_id: 'd' })).toBe(loading);
  });
});

describe('a Choose-style write does not change the comparison key', () => {
  it('applying a decision-row patch and an arguments refresh leaves capability/branch ids untouched', () => {
    const branch = makeBranch();
    const link = makeLink();
    const before = readyState({ links: [link], linkedBranchesById: new Map([[BRANCH_ID, branch]]) });

    const capabilityIds = before.status === 'ready' ? before.links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id) : [];
    const comparisonOptionsBefore =
      before.status === 'ready'
        ? before.links
            .filter((l) => l.linked_type === 'branch')
            .map((l) => before.linkedBranchesById.get(l.linked_id))
            .filter((b): b is BranchRow => b !== undefined)
            .map((b) => ({ branchId: b.id, baseCommitId: b.base_commit_id, headCommitId: b.head_commit_id }))
        : [];
    const keyBefore = decisionComparisonKey(capabilityIds, [], comparisonOptionsBefore);

    // Choose's own two patches: the decision row (`applyDecisionUpdate`) and
    // — simulating `refreshOptionsAndArguments` — a fresh `args` array with
    // the same branch/link set, never touched by Choose.
    const afterDecision = applyDecisionUpdate(before, makeDecision({ status: 'accepted', branch_id: BRANCH_ID }));
    const args: DecisionArgumentRow[] = [{ id: 'arg-1', decision_id: DECISION_ID, stance: 'for', body: 'because', author: 'user-1', created_at: '2026-02-01T00:00:00Z' }];
    const after: DecisionPageState = afterDecision.status === 'ready' ? { ...afterDecision, args } : afterDecision;

    expect(after.status).toBe('ready');
    if (after.status !== 'ready') throw new Error('expected ready');
    const comparisonOptionsAfter = after.links
      .filter((l) => l.linked_type === 'branch')
      .map((l) => after.linkedBranchesById.get(l.linked_id))
      .filter((b): b is BranchRow => b !== undefined)
      .map((b) => ({ branchId: b.id, baseCommitId: b.base_commit_id, headCommitId: b.head_commit_id }));
    const capabilityIdsAfter = after.links.filter((l) => l.linked_type === 'element').map((l) => l.linked_id);
    const keyAfter = decisionComparisonKey(capabilityIdsAfter, [], comparisonOptionsAfter);

    expect(keyAfter).toBe(keyBefore);
    expect(after.status).not.toBe('loading');
  });
});
