import { describe, expect, it } from 'vitest';
import type { DecisionApprovalRow } from '../../db/types';
import { DECISION_APPROVAL_LENSES } from '../../db/types';
import { lensProgress, lensesOpenTo, packIsStale, packSignOff, packSignOffSummary } from './packSignOff';

function row(over: Partial<DecisionApprovalRow>): DecisionApprovalRow {
  return { id: 'a', org_id: 'o', decision_id: 'd', pack_id: 'p2', lens: 'architecture', verdict: 'approve', comment: '', decided_by: 'u1', decided_at: '2026-11-19T10:00:00Z', ...over };
}

describe('packSignOff', () => {
  it('is none with no sign-offs, and a sign-off on an earlier version never carries over', () => {
    expect(packSignOff('p2', []).state).toBe('none');
    expect(packSignOff('p2', [row({ pack_id: 'p1' })]).state).toBe('none');
  });
  it('is approved with an approve and no decline, declined as soon as there is a decline', () => {
    expect(packSignOff('p2', [row({}), row({ id: 'b', lens: 'delivery', decided_by: 'u2' })])).toEqual({ state: 'approved', approvals: 2, declines: 0 });
    expect(packSignOff('p2', [row({}), row({ id: 'b', lens: 'security', verdict: 'decline' })]).state).toBe('declined');
  });
  it('reads in plain words', () => {
    expect(packSignOffSummary({ state: 'none', approvals: 0, declines: 0 })).toBe('not signed yet');
    expect(packSignOffSummary({ state: 'approved', approvals: 2, declines: 0 })).toBe('2 approvals recorded');
    expect(packSignOffSummary({ state: 'declined', approvals: 1, declines: 1 })).toBe('declined by 1, 1 approval recorded');
  });
});

describe('lensesOpenTo', () => {
  it('drops the lenses this person already signed on this pack only', () => {
    const approvals = [row({ lens: 'architecture' }), row({ id: 'c', lens: 'data', pack_id: 'p1' }), row({ id: 'd', lens: 'delivery', decided_by: 'u2' })];
    const open = lensesOpenTo('u1', 'p2', approvals, DECISION_APPROVAL_LENSES);
    expect(open).not.toContain('architecture');
    expect(open).toContain('data');
    expect(open).toContain('delivery');
  });
});

describe('packIsStale', () => {
  it('is false with no pack or an unchanged write-up, true once it differs', () => {
    expect(packIsStale(undefined, 'x')).toBe(false);
    expect(packIsStale('# ADR\n', '# ADR')).toBe(false);
    expect(packIsStale('# ADR', '# ADR changed')).toBe(true);
  });
});

describe('lensProgress', () => {
  it('shows each capacity as approved, declined or not heard from, counting only that pack', () => {
    const approvals = [row({ lens: 'architecture' }), row({ id: 'b', lens: 'security', verdict: 'decline' }), row({ id: 'c', lens: 'security' }), row({ id: 'd', lens: 'data', pack_id: 'p1' })];
    const progress = lensProgress('p2', approvals, DECISION_APPROVAL_LENSES);
    const byLens = Object.fromEntries(progress.map((p) => [p.lens, p.state]));
    expect(byLens).toMatchObject({ architecture: 'approved', security: 'declined', data: 'none', delivery: 'none' });
    expect(progress).toHaveLength(DECISION_APPROVAL_LENSES.length);
  });
});
