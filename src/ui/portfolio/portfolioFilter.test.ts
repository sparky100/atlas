import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTFOLIO_FILTERS, filterPortfolioRows, matchesPortfolioFilters } from './portfolioFilter';
import { fakeElement, fakeRow } from './portfolioTestFixtures';

describe('DEFAULT_PORTFOLIO_FILTERS', () => {
  it('filters nothing out', () => {
    const row = fakeRow({ cost: '1m_5m', criticality: 'low', fit: 'poor' });
    expect(matchesPortfolioFilters(row, DEFAULT_PORTFOLIO_FILTERS)).toBe(true);
  });
});

describe('filterPortfolioRows: kind', () => {
  it('keeps only the matching kind', () => {
    const rows = [fakeRow({ name: 'sys', element: fakeElement('sys', 'system') }), fakeRow({ name: 'plat', element: fakeElement('plat', 'system', { kind: 'platform' }) })];
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, kind: 'platform' }).map((r) => r.name)).toEqual(['plat']);
  });
});

describe('filterPortfolioRows: signal', () => {
  it('keeps only rows where the signal fires', () => {
    const rows = [fakeRow({ name: 'with', signals: [{ key: 'justified', calm: true, reason: 'x' }] }), fakeRow({ name: 'without', signals: [] })];
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, signal: 'justified' }).map((r) => r.name)).toEqual(['with']);
  });
});

describe('filterPortfolioRows: cost', () => {
  it('keeps only the exact band, never treating unset as matching a real band', () => {
    const rows = [fakeRow({ name: 'high', cost: '1m_5m' }), fakeRow({ name: 'unset', cost: null })];
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, cost: '1m_5m' }).map((r) => r.name)).toEqual(['high']);
  });
});

describe('filterPortfolioRows: criticality', () => {
  it('keeps only the matching criticality', () => {
    const rows = [fakeRow({ name: 'crit', criticality: 'critical' }), fakeRow({ name: 'low', criticality: 'low' })];
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, criticality: 'critical' }).map((r) => r.name)).toEqual(['crit']);
  });
});

describe('filterPortfolioRows: combined', () => {
  it('applies every active facet together', () => {
    const rows = [
      fakeRow({ name: 'match', cost: '1m_5m', criticality: 'low', signals: [{ key: 'costly_low_criticality', calm: false, reason: 'x' }] }),
      fakeRow({ name: 'wrong-cost', cost: '50k_250k', criticality: 'low', signals: [{ key: 'costly_low_criticality', calm: false, reason: 'x' }] }),
      fakeRow({ name: 'wrong-criticality', cost: '1m_5m', criticality: 'high', signals: [] }),
    ];
    const result = filterPortfolioRows(rows, { kind: 'all', signal: 'costly_low_criticality', cost: '1m_5m', criticality: 'low', disposition: 'all' });
    expect(result.map((r) => r.name)).toEqual(['match']);
  });
});

describe('disposition filter (F11)', () => {
  it('matches one disposition, or rows with none recorded', () => {
    const rows = [fakeRow({ name: 'migrate', disposition: 'migrate' }), fakeRow({ name: 'invest', disposition: 'invest' }), fakeRow({ name: 'none', disposition: null })];
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, disposition: 'migrate' }).map((r) => r.name)).toEqual(['migrate']);
    expect(filterPortfolioRows(rows, { ...DEFAULT_PORTFOLIO_FILTERS, disposition: 'not_assessed' }).map((r) => r.name)).toEqual(['none']);
    expect(filterPortfolioRows(rows, DEFAULT_PORTFOLIO_FILTERS)).toHaveLength(3);
  });
});
