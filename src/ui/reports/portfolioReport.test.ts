import { describe, expect, it } from 'vitest';
import { runReport } from '../../engine/reportQuery';
import { filterPortfolioRows } from '../portfolio/portfolioFilter';
import { fakeElement, fakeRow } from '../portfolio/portfolioTestFixtures';
import { sortPortfolioRows } from '../portfolio/portfolioSort';
import { visiblePortfolioRows } from '../portfolio/portfolioVisibility';
import { DEFAULT_PORTFOLIO_REPORT_STATE, portfolioReportRow, portfolioStateToSpec, specToPortfolioState, type PortfolioReportState } from './portfolioReport';

const rows = [
  fakeRow({ element: fakeElement('a'), name: 'Alpha', cost: 'over_5m', fit: 'poor', criticality: 'low', signals: [{ key: 'costly_poor_fit' } as never] }),
  fakeRow({ element: fakeElement('b'), name: 'Beta', cost: '50k_250k', fit: 'good', criticality: 'high', disposition: 'migrate' }),
  fakeRow({ element: fakeElement('c'), name: 'Gamma', cost: null, fit: null, criticality: null }),
  fakeRow({ element: fakeElement('d', 'container'), name: 'Alpha · FI', cost: 'under_50k', criticality: 'high' }),
];
const reportRows = rows.map(portfolioReportRow);
const withState = (over: Partial<PortfolioReportState>): PortfolioReportState => ({ ...DEFAULT_PORTFOLIO_REPORT_STATE, ...over });

function pageOrder(state: PortfolioReportState): string[] {
  return sortPortfolioRows(filterPortfolioRows(visiblePortfolioRows(rows, state.includeContainers), state.filters), state.sortKey, state.sortDirection).map((r) => r.element.element_id);
}
function reportOrder(state: PortfolioReportState): string[] {
  const made = portfolioStateToSpec(state);
  if (!made.ok) throw new Error(made.reason);
  return runReport(reportRows, made.spec).rows.map((r) => r[0] as string);
}

describe('portfolio report matches the page', () => {
  const cases: [string, PortfolioReportState][] = [
    ['default', DEFAULT_PORTFOLIO_REPORT_STATE],
    ['with containers, by criticality asc', withState({ includeContainers: true, sortKey: 'criticality', sortDirection: 'asc' })],
    ['cost desc', withState({ sortKey: 'cost', sortDirection: 'desc' })],
    ['signal filter', withState({ filters: { ...DEFAULT_PORTFOLIO_REPORT_STATE.filters, signal: 'costly_poor_fit' } })],
    ['not assessed', withState({ includeContainers: true, filters: { ...DEFAULT_PORTFOLIO_REPORT_STATE.filters, disposition: 'not_assessed' }, sortKey: 'name', sortDirection: 'asc' })],
    ['owner asc', withState({ sortKey: 'owner', sortDirection: 'asc' })],
  ];
  it.each(cases)('%s', (_n, state) => {
    // Report rows are [name,...] columns; compare names via the page's names.
    const names = reportOrder(state);
    const byName = new Map(rows.map((r) => [r.name, r.element.element_id]));
    expect(names.map((n) => byName.get(n))).toEqual(pageOrder(state));
  });
});

describe('portfolio state <-> spec', () => {
  it.each(cases())('round-trips %s', (_n, state) => {
    const made = portfolioStateToSpec(state);
    if (!made.ok) throw new Error(made.reason);
    expect(specToPortfolioState(JSON.parse(JSON.stringify(made.spec)) as typeof made.spec)).toEqual({ ok: true, state });
  });
  it('refuses specs the page cannot show', () => {
    const made = portfolioStateToSpec(DEFAULT_PORTFOLIO_REPORT_STATE);
    if (!made.ok) throw new Error('unreachable');
    expect(specToPortfolioState({ ...made.spec, source: 'elements' }).ok).toBe(false);
    expect(specToPortfolioState({ ...made.spec, filters: [{ field: 'name', operator: 'eq', value: 'x' }] }).ok).toBe(false);
    expect(specToPortfolioState({ ...made.spec, filters: [{ field: 'signalKeys', operator: 'contains', value: '|nope|' }] }).ok).toBe(false);
  });
});

function cases(): [string, PortfolioReportState][] {
  return [
    ['default', DEFAULT_PORTFOLIO_REPORT_STATE],
    ['everything', withState({ includeContainers: true, sortKey: 'lifecycle', sortDirection: 'asc', filters: { kind: 'module', signal: 'justified', cost: 'under_50k', criticality: 'high', disposition: 'migrate' } })],
  ];
}
