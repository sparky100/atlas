import { describe, expect, it } from 'vitest';
import { matchElements, type SearchPoolElement } from './elementSearch';
import type { ElementsHeadRow } from '../contracts/rows';

function el(overrides: Partial<ElementsHeadRow>): ElementsHeadRow {
  return { element_id: 'e1', element_type: 'system', name: 'System', parent_id: null, attributes: {}, exists_delta_id: 'd1', ...overrides };
}

function pool(entries: { element: ElementsHeadRow; aliases?: string[] }[]): SearchPoolElement[] {
  return entries.map(({ element, aliases = [] }) => ({ element, aliases }));
}

describe('matchElements (Blocking: element creation)', () => {
  it('matches by name, case-insensitively, as a substring', () => {
    const p = pool([{ element: el({ element_id: 'e1', name: 'Payment Gateway' }) }]);
    expect(matchElements(p, 'payment')).toEqual([el({ element_id: 'e1', name: 'Payment Gateway' })]);
    expect(matchElements(p, 'GATEWAY')).toHaveLength(1);
    expect(matchElements(p, 'zzz')).toEqual([]);
  });

  it('matches by description when the name does not match', () => {
    const target = el({ element_id: 'e1', name: 'Billing Service', attributes: { description: 'Handles card payments' } });
    const p = pool([{ element: target }]);
    expect(matchElements(p, 'card payments')).toEqual([target]);
  });

  it('matches by alias when neither name nor description match', () => {
    const target = el({ element_id: 'e1', name: 'Billing Service' });
    const p = pool([{ element: target, aliases: ['BSVC', 'Legacy Billing'] }]);
    expect(matchElements(p, 'legacy')).toEqual([target]);
    expect(matchElements(p, 'bsvc')).toEqual([target]);
  });

  it('returns nothing for an empty or whitespace-only query', () => {
    const p = pool([{ element: el({ name: 'Anything' }) }]);
    expect(matchElements(p, '')).toEqual([]);
    expect(matchElements(p, '   ')).toEqual([]);
  });

  it('caps results at `limit`', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ element: el({ element_id: `e${String(i)}`, name: `System ${String(i)}` }) }));
    expect(matchElements(pool(entries), 'System', 3)).toHaveLength(3);
  });

  it('an element with no description attribute never matches on description', () => {
    const target = el({ element_id: 'e1', name: 'Payment Gateway', attributes: {} });
    const p = pool([{ element: target }]);
    expect(matchElements(p, 'undefined')).toEqual([]);
  });
});
