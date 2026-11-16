import { describe, expect, it } from 'vitest';
import { buildCostFitGrid, CHART_COST_COLUMNS, CHART_FIT_ROWS } from './portfolioChart';
import { fakeRow } from './portfolioTestFixtures';

function cellAt(grid: ReturnType<typeof buildCostFitGrid>, fit: string, cost: string) {
  const r = CHART_FIT_ROWS.findIndex((f) => f.key === fit);
  const c = CHART_COST_COLUMNS.findIndex((b) => b.key === cost);
  const cell = grid.cells[r]?.[c];
  if (!cell) throw new Error('no cell');
  return cell;
}

describe('buildCostFitGrid', () => {
  it('places each row in the box for its own cost band and fit', () => {
    const grid = buildCostFitGrid([fakeRow({ name: 'a', cost: '1m_5m', fit: 'poor' }), fakeRow({ name: 'b', cost: 'under_50k', fit: 'good' })]);
    expect(cellAt(grid, 'poor', '1m_5m').rows.map((r) => r.name)).toEqual(['a']);
    expect(cellAt(grid, 'good', 'under_50k').rows.map((r) => r.name)).toEqual(['b']);
    expect(grid.notPlotted).toEqual([]);
  });

  it('never plots a row missing cost or fit as low; it is counted as not plotted', () => {
    const grid = buildCostFitGrid([fakeRow({ name: 'nocost', cost: null, fit: 'poor' }), fakeRow({ name: 'nofit', cost: '1m_5m', fit: null })]);
    expect(grid.notPlotted.map((r) => r.name)).toEqual(['nocost', 'nofit']);
    expect(grid.cells.flat().every((c) => c.rows.length === 0)).toBe(true);
  });

  it('flags a box only when a row in it has the costly, poor fit signal', () => {
    const signal = { key: 'costly_poor_fit' as const, calm: false, reason: 'x' };
    const grid = buildCostFitGrid([fakeRow({ cost: '1m_5m', fit: 'poor', signals: [signal] }), fakeRow({ cost: 'under_50k', fit: 'poor' })]);
    expect(cellAt(grid, 'poor', '1m_5m').flagged).toBe(true);
    expect(cellAt(grid, 'poor', 'under_50k').flagged).toBe(false);
  });

  it('orders fit rows worst first', () => {
    expect(CHART_FIT_ROWS.map((f) => f.key)).toEqual(['poor', 'adequate', 'good', 'excellent']);
  });
});
