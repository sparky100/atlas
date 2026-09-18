import { describe, expect, it } from 'vitest';
import { hasExactMatch, matchElements, mergeSearchPools, type SearchPoolElement } from './elementSearch';
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

describe('mergeSearchPools', () => {
  it('interleaves multiple type pools by name rather than leaving each type grouped together', () => {
    const systems = pool([
      { element: el({ element_id: 's1', name: 'Salesforce' }) },
      { element: el({ element_id: 's2', name: 'SAP' }) },
    ]);
    const containers = pool([{ element: el({ element_id: 'c1', element_type: 'container', name: 'PM' }) }]);
    const merged = mergeSearchPools([systems, containers]);
    // Alphabetical, not grouped by type: "Sal" sorts before "Sap" (L < P),
    // so Salesforce comes before SAP regardless of which pool either came from.
    expect(merged.map((p) => p.element.name)).toEqual(['PM', 'Salesforce', 'SAP']);
  });

  it('a query matching enough elements of the first type no longer starves out a real match of the second type', () => {
    // Ten systems all matching "sa" would already fill matchElements's
    // default limit of 8 before a flat concatenation ever reached the
    // container pool — the exact bug this function fixes.
    const systems = pool(Array.from({ length: 10 }, (_, i) => ({ element: el({ element_id: `s${String(i)}`, name: `Sales System ${String(i)}` }) })));
    const containers = pool([{ element: el({ element_id: 'c1', element_type: 'container', name: 'PM' }) }]);
    const merged = mergeSearchPools([systems, containers]);
    const matches = matchElements(merged, 'sa');
    expect(matches).toHaveLength(8);
    // "PM" doesn't match "sa" at all here — this asserts the merge itself
    // sorted correctly (PM sorts before every "Sales System N"), not that
    // it happens to match this particular query.
    expect(merged[0]?.element.name).toBe('PM');
  });

  it('ties on name break by element id, the same tie-break loadSearchPool\'s own query uses', () => {
    const a = pool([{ element: el({ element_id: 'b', name: 'Same' }) }]);
    const b = pool([{ element: el({ element_id: 'a', name: 'Same' }) }]);
    const merged = mergeSearchPools([a, b]);
    expect(merged.map((p) => p.element.element_id)).toEqual(['a', 'b']);
  });

  it('sorts case-insensitively', () => {
    const a = pool([{ element: el({ element_id: 'e1', name: 'apple' }) }]);
    const b = pool([{ element: el({ element_id: 'e2', name: 'Banana' }) }]);
    const merged = mergeSearchPools([b, a]);
    expect(merged.map((p) => p.element.name)).toEqual(['apple', 'Banana']);
  });

  it('is empty for no pools, and a single pool is just re-sorted', () => {
    expect(mergeSearchPools([])).toEqual([]);
    const p = pool([{ element: el({ element_id: 'e2', name: 'Zebra' }) }, { element: el({ element_id: 'e1', name: 'Apple' }) }]);
    expect(mergeSearchPools([p]).map((x) => x.element.name)).toEqual(['Apple', 'Zebra']);
  });
});

describe('hasExactMatch (Prompt 7h bug fix: "Create..." hides only on an exact match)', () => {
  it('is true for a case-insensitive exact match on name', () => {
    const p = pool([{ element: el({ name: 'Enterprise Architecture & Standards' }) }]);
    expect(hasExactMatch(p, 'Enterprise Architecture & Standards')).toBe(true);
    expect(hasExactMatch(p, 'ENTERPRISE ARCHITECTURE & STANDARDS')).toBe(true);
  });

  it('is false for a mere substring/near-match, however close', () => {
    const p = pool([{ element: el({ name: 'Enterprise Architecture & Standards' }) }]);
    expect(hasExactMatch(p, 'Enter')).toBe(false);
    expect(hasExactMatch(p, 'Enterprise Architecture & Standard')).toBe(false);
  });

  it('is true for a case-insensitive exact match on an alias, even when the name differs', () => {
    const p = pool([{ element: el({ name: 'Billing Service' }), aliases: ['BSVC'] }]);
    expect(hasExactMatch(p, 'bsvc')).toBe(true);
    expect(hasExactMatch(p, 'BSVC')).toBe(true);
  });

  it('is never true from a description match — matchElements\'s own description pass does not apply here', () => {
    const p = pool([{ element: el({ name: 'Billing Service', attributes: { description: 'Handles card payments' } }) }]);
    expect(hasExactMatch(p, 'Handles card payments')).toBe(false);
  });

  it('is false for an empty or whitespace-only query', () => {
    const p = pool([{ element: el({ name: 'Anything' }) }]);
    expect(hasExactMatch(p, '')).toBe(false);
    expect(hasExactMatch(p, '   ')).toBe(false);
  });

  it('is false when nothing in the pool matches at all', () => {
    const p = pool([{ element: el({ name: 'Billing Service' }) }]);
    expect(hasExactMatch(p, 'Payment Gateway')).toBe(false);
  });
});
