import { describe, expect, it } from 'vitest';
import type { BranchRow, DecisionRow, ProjectRow } from '../../db/types';
import {
  formatProjectProgress,
  groupChangesByStage,
  groupProjectsByStatus,
  isDecisionOverdue,
  openItemsBlockingClose,
  originatingDecision,
  projectChangeStage,
  projectProgress,
  scopeDifference,
  scopeHasCapability,
} from './projectModel';

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
    reconsider_if: null, review_by: null, branch_id: null,
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
    ...overrides,
  };
}

describe('projectChangeStage', () => {
  it('maps explore drafts to exploring, other drafts to chosen, submitted to in review, and ends to merged or closed', () => {
    expect(projectChangeStage({ status: 'draft', intent: 'explore' })).toBe('exploring');
    expect(projectChangeStage({ status: 'draft', intent: 'propose' })).toBe('chosen');
    expect(projectChangeStage({ status: 'draft', intent: 'record' })).toBe('chosen');
    expect(projectChangeStage({ status: 'proposed', intent: 'propose' })).toBe('in_review');
    expect(projectChangeStage({ status: 'approved', intent: 'propose' })).toBe('in_review');
    expect(projectChangeStage({ status: 'merged', intent: 'propose' })).toBe('merged');
    expect(projectChangeStage({ status: 'cancelled', intent: 'explore' })).toBe('closed');
    expect(projectChangeStage({ status: 'rejected', intent: 'propose' })).toBe('closed');
  });

  it('groups in stage order and drops empty stages', () => {
    const groups = groupChangesByStage([branch({ id: 'm', status: 'merged' }), branch({ id: 'e', intent: 'explore' })]);
    expect(groups.map((g) => g.stage)).toEqual(['exploring', 'merged']);
  });
});

describe('groupProjectsByStatus', () => {
  it('orders active, on hold, closed, cancelled and drops empty groups', () => {
    const groups = groupProjectsByStatus([project({ id: 'c', status: 'closed' }), project({ id: 'a', status: 'active' })]);
    expect(groups.map((g) => g.status)).toEqual(['active', 'closed']);
  });
});

describe('scopeDifference', () => {
  it('lists touched-but-undeclared and declared-but-untouched separately', () => {
    expect(scopeDifference(['a', 'b'], ['b', 'c', 'c'])).toEqual({ touchedNotDeclared: ['c'], declaredNotTouched: ['a'] });
  });

  it('a scope item a change only affects is covered, and an affected item outside scope is not "touched"', () => {
    // Land, Wayleaves & Consents is affected (impact) but not edited; Network mapping is affected and out of scope.
    expect(scopeDifference(['escoms', 'wayleaves', 'bi'], ['escoms', 'enterprise'], ['wayleaves', 'mapping'])).toEqual({ touchedNotDeclared: ['enterprise'], declaredNotTouched: ['bi'] });
  });
});

describe('isDecisionOverdue', () => {
  it('only a proposed decision past its needed-by date', () => {
    expect(isDecisionOverdue({ status: 'proposed', needed_by: '2026-09-30' }, '2026-10-01')).toBe(true);
    expect(isDecisionOverdue({ status: 'proposed', needed_by: '2026-10-01' }, '2026-10-01')).toBe(false);
    expect(isDecisionOverdue({ status: 'accepted', needed_by: '2026-01-01' }, '2026-10-01')).toBe(false);
    expect(isDecisionOverdue({ status: 'proposed', needed_by: null }, '2026-10-01')).toBe(false);
  });
});

describe('projectProgress', () => {
  it('counts, never a percentage', () => {
    const progress = projectProgress(
      [branch({ status: 'draft', intent: 'explore' }), branch({ status: 'merged' }), branch({ status: 'cancelled' })],
      [decision({ status: 'proposed' }), decision({ status: 'accepted' })],
    );
    expect(progress).toEqual({ openChanges: 1, mergedChanges: 1, openDecisions: 1, decidedDecisions: 1 });
  });
});

describe('originatingDecision', () => {
  it('is the earliest decision, or null', () => {
    expect(originatingDecision([])).toBeNull();
    const first = decision({ id: 'first', created_at: '2026-09-01T00:00:00Z' });
    expect(originatingDecision([decision({ id: 'later', created_at: '2026-09-02T00:00:00Z' }), first])?.id).toBe('first');
  });
});

describe('openItemsBlockingClose', () => {
  it('lists open changes and proposed decisions — what P4 refuses to close over', () => {
    const items = openItemsBlockingClose(
      [branch({ id: 'open', status: 'in_review' }), branch({ id: 'done', status: 'merged' })],
      [decision({ id: 'pending', status: 'proposed' }), decision({ id: 'made', status: 'accepted' })],
    );
    expect(items.changes.map((c) => c.id)).toEqual(['open']);
    expect(items.decisions.map((d) => d.id)).toEqual(['pending']);
  });
});

describe('formatProjectProgress', () => {
  it('reads as plain counts, never a percentage, singular where one', () => {
    expect(formatProjectProgress({ openChanges: 1, mergedChanges: 2, openDecisions: 1, decidedDecisions: 0 })).toBe('1 open change · 2 merged · 1 open decision · 0 decided');
    expect(formatProjectProgress({ openChanges: 0, mergedChanges: 0, openDecisions: 3, decidedDecisions: 1 })).toBe('0 open changes · 0 merged · 3 open decisions · 1 decided');
  });
});

describe('scopeHasCapability (plan A1: a project must name a capability)', () => {
  it('is true when at least one scope pick is a capability', () => {
    expect(scopeHasCapability([{ elementId: 'cap-1', name: 'Billing', elementType: 'capability' }])).toBe(true);
    expect(
      scopeHasCapability([
        { elementId: 'sys-1', name: 'SAP', elementType: 'system' },
        { elementId: 'cap-1', name: 'Billing', elementType: 'capability' },
      ]),
    ).toBe(true);
  });

  it('is false for an empty scope, or systems and containers alone', () => {
    expect(scopeHasCapability([])).toBe(false);
    expect(
      scopeHasCapability([
        { elementId: 'sys-1', name: 'SAP', elementType: 'system' },
        { elementId: 'c-1', name: 'Module', elementType: 'container' },
      ]),
    ).toBe(false);
  });

  it('treats a pick whose type is unknown as not a capability, so the person is asked to name one', () => {
    expect(scopeHasCapability([{ elementId: 'x', name: 'From an old prefill link' }])).toBe(false);
  });
});
