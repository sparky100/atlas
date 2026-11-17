import { describe, expect, it } from 'vitest';
import { QUADRANT_REPORT_COLUMNS, specForTile } from '../reports/dashboardTiles';
import { REPORT_SPEC_VERSION, type ReportSpec } from '../../contracts/reportSpec';
import { runReportWithRows } from '../../engine/reportQuery';
import { portfolioReportRow } from '../reports/portfolioReport';
import { fakeRow } from './portfolioTestFixtures';
import { quadrantItemsFromResult } from './quadrantItemsFromResult';
import { buildQuadrant } from './portfolioQuadrantModel';

describe('quadrant tile: a Portfolio report to quadrant boxes', () => {
  const spec: ReportSpec = { specVersion: REPORT_SPEC_VERSION, source: 'portfolio', filters: [], columns: ['name'], sort: [{ field: 'name', direction: 'asc' }], presentation: { kind: 'table', limit: 5 } };
  const rows = [
    fakeRow({ name: 'Good and healthy', cost: '1m_5m', fit: 'good', lifecycleStatus: 'active', lifecycleExposed: false, disposition: 'invest' }),
    fakeRow({ name: 'Poor and past end', cost: 'under_50k', fit: 'poor', lifecycleStatus: 'active', lifecycleExposed: true }),
    fakeRow({ name: 'No fit', cost: '50k_250k', fit: null, lifecycleStatus: 'active', lifecycleExposed: false }),
  ].map((r, i) => portfolioReportRow({ ...r, element: { ...r.element, element_id: `e${String(i)}` } }));

  it('reads every matching row (ignoring the table limit) with the quadrant columns', () => {
    const tileSpec = specForTile(spec, 'quadrant', 2);
    expect(tileSpec.columns).toEqual([...QUADRANT_REPORT_COLUMNS]);
    expect(tileSpec.presentation).toEqual({ kind: 'table' });
    const { result } = runReportWithRows(rows, tileSpec);
    expect(result.rows).toHaveLength(3);
  });

  it('places them: good and healthy invests, poor and past its end eliminates, no fit is not placed', () => {
    const { result } = runReportWithRows(rows, specForTile(spec, 'quadrant', null));
    const built = buildQuadrant(quadrantItemsFromResult(result));
    expect(built.boxes.invest.map((i) => i.name)).toEqual(['Good and healthy']);
    expect(built.boxes.eliminate.map((i) => i.name)).toEqual(['Poor and past end']);
    expect(built.notPlaced.fit.map((i) => i.name)).toEqual(['No fit']);
  });
});
