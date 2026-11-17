import { describe, expect, it } from 'vitest';
import type { DecisionPrincipleRow, PrincipleRow } from '../../contracts/principles';
import { countText, orderPrinciples, summarisePrinciples } from './principleModel';

const principle = (id: string, title: string, status: 'active' | 'retired' = 'active'): PrincipleRow => ({ id, org_id: 'o', model_id: 'm', title, statement: 'S', why: '', status, created_by: 'u', created_at: '', retired_by: null, retired_at: null });
const link = (decision: string, p: string, stance: 'follows' | 'departs', reason = ''): DecisionPrincipleRow => ({ decision_id: decision, principle_id: p, stance, reason, created_by: 'u', created_at: '' });

describe('summarisePrinciples', () => {
  it('lists followers and departures, with reasons, for the right principle', () => {
    const [a, b] = summarisePrinciples(
      [principle('p1', 'One'), principle('p2', 'Two')],
      [link('d1', 'p1', 'follows'), link('d2', 'p1', 'departs', 'It does not fit.'), link('d1', 'p2', 'follows'), link('gone', 'p1', 'follows')],
      [{ id: 'd1', title: 'Buy a CRM' }, { id: 'd2', title: 'Build a portal' }],
    );
    expect(a?.followed).toEqual([{ decisionId: 'd1', title: 'Buy a CRM' }]);
    expect(a?.departed).toEqual([{ decisionId: 'd2', title: 'Build a portal', reason: 'It does not fit.' }]);
    expect(b?.followed.length).toBe(1);
    expect(b?.departed).toEqual([]);
  });
});

describe('orderPrinciples', () => {
  it('puts active first and sorts each group by title', () => {
    expect(orderPrinciples([principle('3', 'Zed', 'retired'), principle('2', 'Beta'), principle('1', 'Alpha'), principle('4', 'Able', 'retired')]).map((p) => p.title)).toEqual(['Alpha', 'Beta', 'Able', 'Zed']);
  });
});

describe('countText', () => {
  it('says one or many', () => {
    expect(countText(1, 'decision', 'decisions')).toBe('1 decision');
    expect(countText(0, 'decision', 'decisions')).toBe('0 decisions');
  });
});
