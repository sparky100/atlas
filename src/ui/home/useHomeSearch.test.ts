import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { SearchPoolElement } from '../../db/elementSearch';
import { HOME_SEARCH_CREATABLE_TYPES, HOME_SEARCH_TYPES, hasCreatableExactMatch } from './homeSearchTypes';

function el(overrides: Partial<ElementsHeadRow>): ElementsHeadRow {
  return { element_id: 'e1', element_type: 'system', name: 'System', parent_id: null, attributes: {}, exists_delta_id: 'd1', ...overrides };
}

function pool(entries: { element: ElementsHeadRow; aliases?: string[] }[]): SearchPoolElement[] {
  return entries.map(({ element, aliases = [] }) => ({ element, aliases }));
}

describe('HOME_SEARCH_TYPES', () => {
  it('is HOME_SEARCH_CREATABLE_TYPES plus container', () => {
    expect(HOME_SEARCH_TYPES).toEqual([...HOME_SEARCH_CREATABLE_TYPES, 'container']);
  });
});

describe('hasCreatableExactMatch', () => {
  it('is true for an exact match on a creatable type (system)', () => {
    const p = pool([{ element: el({ element_type: 'system', name: 'Billing Service' }) }]);
    expect(hasCreatableExactMatch(p, 'Billing Service')).toBe(true);
    expect(hasCreatableExactMatch(p, 'billing service')).toBe(true);
  });

  it('is false for an exact match that only exists on a container — a module and a top-level type may legitimately share a name', () => {
    const p = pool([{ element: el({ element_id: 'fi', element_type: 'container', name: 'Reporting', parent_id: 'sap' }) }]);
    expect(hasCreatableExactMatch(p, 'Reporting')).toBe(false);
  });

  it('is true when a creatable-type exact match exists alongside an unrelated container exact match', () => {
    const p = pool([
      { element: el({ element_id: 'sys1', element_type: 'system', name: 'Reporting' }) },
      { element: el({ element_id: 'con1', element_type: 'container', name: 'Reporting', parent_id: 'sap' }) },
    ]);
    expect(hasCreatableExactMatch(p, 'Reporting')).toBe(true);
  });

  it('is false for a mere substring/near-match on a creatable type, same as the underlying hasExactMatch', () => {
    const p = pool([{ element: el({ element_type: 'system', name: 'Billing Service' }) }]);
    expect(hasCreatableExactMatch(p, 'Billing')).toBe(false);
  });

  it('is true for an exact alias match on a creatable type', () => {
    const p = pool([{ element: el({ element_type: 'capability', name: 'Enterprise Architecture' }), aliases: ['EA'] }]);
    expect(hasCreatableExactMatch(p, 'EA')).toBe(true);
  });

  it('is false for an empty query', () => {
    const p = pool([{ element: el({ name: 'Anything' }) }]);
    expect(hasCreatableExactMatch(p, '')).toBe(false);
  });
});
