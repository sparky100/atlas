import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTFOLIO_SORT_DIRECTION, DEFAULT_PORTFOLIO_SORT_KEY, sortPortfolioRows } from './portfolioSort';
import { fakeElement, fakeRow } from './portfolioTestFixtures';

describe('default sort', () => {
  it('is cost band, descending', () => {
    expect(DEFAULT_PORTFOLIO_SORT_KEY).toBe('cost');
    expect(DEFAULT_PORTFOLIO_SORT_DIRECTION).toBe('desc');
  });
});

describe('sortPortfolioRows: cost', () => {
  it('sorts most expensive first, descending', () => {
    const rows = [fakeRow({ name: 'a', cost: 'under_50k' }), fakeRow({ name: 'b', cost: '1m_5m' }), fakeRow({ name: 'c', cost: '50k_250k' })];
    expect(sortPortfolioRows(rows, 'cost', 'desc').map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('places a not-entered cost below every real band, even descending — never mistaken for a low band', () => {
    const rows = [fakeRow({ name: 'none', cost: 'none_included' }), fakeRow({ name: 'unset', cost: null })];
    expect(sortPortfolioRows(rows, 'cost', 'desc').map((r) => r.name)).toEqual(['none', 'unset']);
    expect(sortPortfolioRows(rows, 'cost', 'asc').map((r) => r.name)).toEqual(['unset', 'none']);
  });

  it('does not mutate its input', () => {
    const rows = [fakeRow({ name: 'b', cost: 'under_50k' }), fakeRow({ name: 'a', cost: '1m_5m' })];
    const originalOrder = rows.map((r) => r.name);
    sortPortfolioRows(rows, 'cost', 'desc');
    expect(rows.map((r) => r.name)).toEqual(originalOrder);
  });
});

describe('sortPortfolioRows: name', () => {
  it('sorts alphabetically ascending', () => {
    const rows = [fakeRow({ name: 'Zebra' }), fakeRow({ name: 'Apple' })];
    expect(sortPortfolioRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Apple', 'Zebra']);
  });
});

describe('sortPortfolioRows: kind', () => {
  it('groups system, platform and module rows by label', () => {
    const rows = [
      fakeRow({ name: 'mod', element: fakeElement('mod', 'container') }),
      fakeRow({ name: 'plat', element: fakeElement('plat', 'system', { kind: 'platform' }) }),
      fakeRow({ name: 'sys', element: fakeElement('sys', 'system') }),
    ];
    // "Module" < "Platform" < "System" alphabetically.
    expect(sortPortfolioRows(rows, 'kind', 'asc').map((r) => r.name)).toEqual(['mod', 'plat', 'sys']);
  });
});

describe('sortPortfolioRows: fit', () => {
  it('sorts best fit first ascending, unrated before excellent', () => {
    const rows = [fakeRow({ name: 'poor', fit: 'poor' }), fakeRow({ name: 'excellent', fit: 'excellent' }), fakeRow({ name: 'unrated', fit: null })];
    expect(sortPortfolioRows(rows, 'fit', 'asc').map((r) => r.name)).toEqual(['unrated', 'excellent', 'poor']);
  });
});

describe('sortPortfolioRows: criticality', () => {
  it('sorts low to critical ascending', () => {
    const rows = [fakeRow({ name: 'critical', criticality: 'critical' }), fakeRow({ name: 'low', criticality: 'low' })];
    expect(sortPortfolioRows(rows, 'criticality', 'asc').map((r) => r.name)).toEqual(['low', 'critical']);
  });
});

describe('sortPortfolioRows: lifecycle', () => {
  it('sorts planned to retired ascending', () => {
    const rows = [fakeRow({ name: 'retired', lifecycleStatus: 'retired' }), fakeRow({ name: 'planned', lifecycleStatus: 'planned' })];
    expect(sortPortfolioRows(rows, 'lifecycle', 'asc').map((r) => r.name)).toEqual(['planned', 'retired']);
  });
});

describe('sortPortfolioRows: capabilities', () => {
  it('sorts by number of capabilities served', () => {
    const one = { capabilityId: 'c1', capabilityName: 'C1', fit: null, otherSupporters: [] };
    const two = { capabilityId: 'c2', capabilityName: 'C2', fit: null, otherSupporters: [] };
    const rows = [fakeRow({ name: 'few', capabilities: [one] }), fakeRow({ name: 'many', capabilities: [one, two] })];
    expect(sortPortfolioRows(rows, 'capabilities', 'desc').map((r) => r.name)).toEqual(['many', 'few']);
  });
});

describe('sortPortfolioRows: owner', () => {
  it('sorts by business owner name, unowned last ascending', () => {
    const rows = [fakeRow({ name: 'unowned', businessOwner: null }), fakeRow({ name: 'owned', businessOwner: fakeElement('owner-1') })];
    expect(sortPortfolioRows(rows, 'owner', 'asc').map((r) => r.name)).toEqual(['unowned', 'owned']);
  });
});

describe('sortPortfolioRows: signals', () => {
  it('sorts by number of signals firing', () => {
    const rows = [
      fakeRow({ name: 'none' }),
      fakeRow({ name: 'one', signals: [{ key: 'justified', calm: true, reason: 'x' }] }),
    ];
    expect(sortPortfolioRows(rows, 'signals', 'desc').map((r) => r.name)).toEqual(['one', 'none']);
  });
});
