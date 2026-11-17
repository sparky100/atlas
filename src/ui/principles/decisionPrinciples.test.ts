import { describe, expect, it } from 'vitest';
import type { DecisionPrincipleRow, PrincipleRow } from '../../contracts/principles';
import { adrPrincipleItems, countDecisionsDeparting, decisionPrincipleLines } from './decisionPrinciples';

const principle = (id: string, title: string, status: 'active' | 'retired' = 'active'): PrincipleRow => ({ id, org_id: 'o', model_id: 'm', title, statement: 'S', why: '', status, created_by: 'u', created_at: '', retired_by: null, retired_at: null, from_set_slug: null, from_set_name: null, from_set_version: null });
const link = (decision: string, p: string, stance: 'follows' | 'departs', reason = ''): DecisionPrincipleRow => ({ decision_id: decision, principle_id: p, stance, reason, created_by: 'u', created_at: '' });

describe('decisionPrincipleLines', () => {
  const ps = [principle('b', 'Beta'), principle('a', 'Alpha'), principle('r', 'Old', 'retired'), principle('r2', 'Older', 'retired')];

  it('while editable lists every active principle plus any retired one already cited, active first', () => {
    const lines = decisionPrincipleLines(ps, [link('d', 'r', 'follows')], true);
    expect(lines.map((l) => l.principle.title)).toEqual(['Alpha', 'Beta', 'Old']);
    expect(lines.map((l) => l.stance)).toEqual([null, null, 'follows']);
  });

  it('once decided lists only what the decision cites, with the reason', () => {
    const lines = decisionPrincipleLines(ps, [link('d', 'a', 'departs', 'Cost')], false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ stance: 'departs', reason: 'Cost' });
  });
});

describe('adrPrincipleItems', () => {
  it('lists follows before departures, each A to Z, and skips a link with no principle', () => {
    const ps = [principle('a', 'Alpha'), principle('b', 'Beta'), principle('c', 'Gamma')];
    const items = adrPrincipleItems(ps, [link('d', 'c', 'follows'), link('d', 'a', 'departs', 'Why'), link('d', 'b', 'follows'), link('d', 'gone', 'follows')]);
    expect(items.map((i) => `${i.stance}:${i.title}`)).toEqual(['follows:Beta', 'follows:Gamma', 'departs:Alpha']);
  });
});

describe('countDecisionsDeparting', () => {
  it('counts decisions, not links, and ignores cancelled decisions and other models', () => {
    const decisions = [{ id: 'd1', status: 'proposed' }, { id: 'd2', status: 'accepted' }, { id: 'd3', status: 'rejected' }];
    const links = [link('d1', 'a', 'departs', 'x'), link('d1', 'b', 'departs', 'y'), link('d2', 'a', 'follows'), link('d3', 'a', 'departs', 'z'), link('other', 'a', 'departs', 'w')];
    expect(countDecisionsDeparting(links, decisions)).toBe(1);
  });
});
