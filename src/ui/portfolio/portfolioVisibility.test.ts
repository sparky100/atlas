import { describe, expect, it } from 'vitest';
import { portfolioLifecycleCounts, togglePortfolioLifecycleState, visiblePortfolioRows } from './portfolioVisibility';
import { fakeElement, fakeRow } from './portfolioTestFixtures';

describe('visiblePortfolioRows', () => {
  it('hides container (module) rows when includeContainers is false', () => {
    const systemRow = fakeRow({ name: 'sys', element: fakeElement('sys', 'system') });
    const moduleRow = fakeRow({ name: 'mod', element: fakeElement('mod', 'container') });
    expect(visiblePortfolioRows([systemRow, moduleRow], false).map((r) => r.name)).toEqual(['sys']);
  });

  it('shows container rows when includeContainers is true', () => {
    const systemRow = fakeRow({ name: 'sys', element: fakeElement('sys', 'system') });
    const moduleRow = fakeRow({ name: 'mod', element: fakeElement('mod', 'container') });
    expect(visiblePortfolioRows([systemRow, moduleRow], true).map((r) => r.name)).toEqual(['sys', 'mod']);
  });

  it("toggling containers on or off never changes any system's own signals — the same row object, un-recomputed, either way", () => {
    const overlapSignal = { key: 'costly_overlap' as const, calm: false, reason: 'shares a high-cost supporter' };
    const systemRow = fakeRow({ name: 'sys', element: fakeElement('sys', 'system'), cost: '1m_5m', signals: [overlapSignal] });
    const moduleRow = fakeRow({ name: 'mod', element: fakeElement('mod', 'container'), cost: '1m_5m', signals: [overlapSignal] });

    const withContainers = visiblePortfolioRows([systemRow, moduleRow], true);
    const withoutContainers = visiblePortfolioRows([systemRow, moduleRow], false);

    const sysWithContainers = withContainers.find((r) => r.name === 'sys');
    const sysWithoutContainers = withoutContainers.find((r) => r.name === 'sys');
    // Reference equality, not just deep equality: proves the toggle is a
    // pure display filter over rows computed once — it never recomputes or
    // even re-derives a row's own `signals`, so there is nothing for
    // toggling to change.
    expect(sysWithContainers).toBe(systemRow);
    expect(sysWithoutContainers).toBe(systemRow);
    expect(sysWithContainers?.signals).toEqual([overlapSignal]);
    expect(sysWithoutContainers?.signals).toEqual([overlapSignal]);
  });
});

describe('visiblePortfolioRows: current portfolio by default', () => {
  const rows = [fakeRow({ name: 'live' }), fakeRow({ name: 'planned', lifecycleState: 'planned' }), fakeRow({ name: 'retired', lifecycleState: 'retired' })];
  it('leaves out planned and retired rows unless asked', () => {
    expect(visiblePortfolioRows(rows, false).map((r) => r.name)).toEqual(['live']);
    expect(visiblePortfolioRows(rows, false, ['active', 'planned', 'retired']).map((r) => r.name)).toEqual(['live', 'planned', 'retired']);
  });

  it('shows only planned, or only retired, when that is the one picked', () => {
    expect(visiblePortfolioRows(rows, false, ['planned']).map((r) => r.name)).toEqual(['planned']);
    expect(visiblePortfolioRows(rows, false, ['retired']).map((r) => r.name)).toEqual(['retired']);
  });

  it('counts each group, leaving containers out unless included', () => {
    const withModule = [...rows, fakeRow({ name: 'mod', element: fakeElement('mod', 'container'), lifecycleState: 'planned' })];
    expect(portfolioLifecycleCounts(withModule, false)).toEqual({ active: 1, planned: 1, retired: 1 });
    expect(portfolioLifecycleCounts(withModule, true)).toEqual({ active: 1, planned: 2, retired: 1 });
  });

  it('toggles a group, keeps the order, and never turns off the last one', () => {
    expect(togglePortfolioLifecycleState(['active'], 'retired')).toEqual(['active', 'retired']);
    expect(togglePortfolioLifecycleState(['active', 'planned'], 'active')).toEqual(['planned']);
    expect(togglePortfolioLifecycleState(['planned'], 'planned')).toEqual(['planned']);
  });
});
