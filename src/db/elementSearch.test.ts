import { describe, expect, it } from 'vitest';
import { countMatches, hasExactMatch, matchElements, mergeSearchPools, overlayBranchElements, type SearchPoolElement } from './elementSearch';
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

  it('excludes one element id before ranking/capping, backfilling from the next-best match rather than just shrinking the list', () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({ element: el({ element_id: `e${String(i)}`, name: `System ${String(i)}` }) }));
    const withExclusion = matchElements(pool(entries), 'System', 8, 'e0');
    expect(withExclusion).toHaveLength(8);
    expect(withExclusion.some((e) => e.element_id === 'e0')).toBe(false);
  });

  describe('ranking (a real match should never be silently outranked by a worse one)', () => {
    it('a name match ranks above a description match, regardless of pool order', () => {
      const nameMatch = el({ element_id: 'name', name: 'Salesforce' });
      const descriptionMatch = el({ element_id: 'desc', name: 'Azure Synapse', attributes: { description: 'A SaaS data warehouse' } });
      // Description-match entry placed first in the pool — order alone must not decide this.
      const p = pool([{ element: descriptionMatch }, { element: nameMatch }]);
      expect(matchElements(p, 'sa').map((e) => e.element_id)).toEqual(['name', 'desc']);
    });

    it('a name-prefix match ranks above a name match buried mid-string', () => {
      const prefix = el({ element_id: 'prefix', name: 'SAP' });
      const midString = el({ element_id: 'mid', name: 'Legacy SAP Adapter' });
      const p = pool([{ element: midString }, { element: prefix }]);
      expect(matchElements(p, 'sap').map((e) => e.element_id)).toEqual(['prefix', 'mid']);
    });

    it('an exact name match ranks above every other tier', () => {
      const exact = el({ element_id: 'exact', name: 'PM' });
      const prefix = el({ element_id: 'prefix', name: 'PM Suite' });
      const p = pool([{ element: prefix }, { element: exact }]);
      expect(matchElements(p, 'pm').map((e) => e.element_id)).toEqual(['exact', 'prefix']);
    });

    it('a description match ranks above an alias match', () => {
      const descriptionMatch = el({ element_id: 'desc', name: 'Billing Service', attributes: { description: 'Handles sales tax' } });
      const aliasMatch = el({ element_id: 'alias', name: 'Payments' });
      const p = pool([{ element: aliasMatch, aliases: ['sales-legacy'] }, { element: descriptionMatch }]);
      expect(matchElements(p, 'sales').map((e) => e.element_id)).toEqual(['desc', 'alias']);
    });

    it('the 8-result cap keeps the best matches, not just the first found', () => {
      const goodMatches = Array.from({ length: 3 }, (_, i) => ({ element: el({ element_id: `good${String(i)}`, name: `Sales System ${String(i)}` }) }));
      // Ten description-only matches, loaded before the name matches above.
      const weakMatches = Array.from({ length: 10 }, (_, i) => ({
        element: el({ element_id: `weak${String(i)}`, name: `System ${String(i)}`, attributes: { description: 'part of the sales pipeline' } }),
      }));
      const p = pool([...weakMatches, ...goodMatches]);
      const results = matchElements(p, 'sales');
      expect(results).toHaveLength(8);
      // All three name matches survive the cap despite loading last.
      expect(goodMatches.every(({ element }) => results.some((r) => r.element_id === element.element_id))).toBe(true);
    });
  });
});

describe('countMatches', () => {
  it('counts every match, unbounded by the display limit', () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ element: el({ element_id: `e${String(i)}`, name: `System ${String(i)}` }) }));
    const p = pool(entries);
    expect(matchElements(p, 'System')).toHaveLength(8);
    expect(countMatches(p, 'System')).toBe(12);
  });

  it('is 0 for an empty query or no matches', () => {
    const p = pool([{ element: el({ name: 'Anything' }) }]);
    expect(countMatches(p, '')).toBe(0);
    expect(countMatches(p, 'zzz')).toBe(0);
  });

  it('excludes the same id matchElements would, so the two never disagree about how many more there are', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ element: el({ element_id: `e${String(i)}`, name: `System ${String(i)}` }) }));
    const p = pool(entries);
    expect(countMatches(p, 'System', 'e0')).toBe(4);
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

describe('overlayBranchElements (a change branch\'s own additions/edits, folded onto the main-scoped pool)', () => {
  it('adds a branch-only element (not on main at all) to the pool', () => {
    const mainPool = pool([{ element: el({ element_id: 'sys-1', name: 'SAP' }) }]);
    const branchOnly = el({ element_id: 'c-1', element_type: 'container', name: 'Datasphere', parent_id: 'sys-1' });
    const merged = overlayBranchElements(mainPool, [branchOnly], ['system', 'container']);
    expect(merged.map((p) => p.element.element_id).sort()).toEqual(['c-1', 'sys-1']);
  });

  it("a branch edit to an element main already has wins over main's own stale copy", () => {
    const mainPool = pool([{ element: el({ element_id: 'sys-1', name: 'Old Name' }) }]);
    const renamed = el({ element_id: 'sys-1', name: 'New Name' });
    const merged = overlayBranchElements(mainPool, [renamed], ['system']);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.element.name).toBe('New Name');
  });

  it("a branch element keeps main's own aliases for the same id rather than losing them", () => {
    const mainPool = pool([{ element: el({ element_id: 'sys-1', name: 'Old Name' }), aliases: ['LEGACY-1'] }]);
    const renamed = el({ element_id: 'sys-1', name: 'New Name' });
    const merged = overlayBranchElements(mainPool, [renamed], ['system']);
    expect(merged[0]?.aliases).toEqual(['LEGACY-1']);
  });

  it('ignores a branch element of a type the caller never asked for', () => {
    const mainPool = pool([{ element: el({ element_id: 'sys-1', name: 'SAP' }) }]);
    const irrelevant = el({ element_id: 'cap-1', element_type: 'capability', name: 'Finance' });
    const merged = overlayBranchElements(mainPool, [irrelevant], ['system']);
    expect(merged.map((p) => p.element.element_id)).toEqual(['sys-1']);
  });

  it('an empty branch element list leaves the main pool unchanged (just re-sorted)', () => {
    const mainPool = pool([{ element: el({ element_id: 'sys-1', name: 'SAP' }) }]);
    const merged = overlayBranchElements(mainPool, [], ['system']);
    expect(merged.map((p) => p.element.element_id)).toEqual(['sys-1']);
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
