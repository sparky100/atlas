import { describe, expect, it } from 'vitest';
import { parseReportSpec, REPORT_SPEC_VERSION, type ReportSpec } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import { canEditReport } from './reportAccess';
import { tileKindsFor } from './dashboardTiles';
import { applyShape, groupableFields, shapeOfSpec, withoutShape, type ReportShape } from './reportShape';

const base: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION,
  source: 'elements',
  filters: [{ field: 'type', operator: 'eq', value: 'system' }],
  columns: ['name', 'type', 'lifecycle', 'criticality'],
  sort: [{ field: 'name', direction: 'asc' }],
  presentation: { kind: 'table' },
};
const shape = (over: Partial<ReportShape>): ReportShape => ({ showAs: 'table', groupBy: null, splitBy: null, limit: null, ...over });

function applied(over: Partial<ReportShape>): ReportSpec {
  const r = applyShape(base, shape(over));
  if (!r.ok) throw new Error(r.reason);
  return r.spec;
}

describe('applyShape', () => {
  it('turns a flat table into a bar chart grouped by a field, keeping the question', () => {
    const spec = applied({ showAs: 'bar', groupBy: 'lifecycle' });
    expect(spec.presentation).toEqual({ kind: 'barByField' });
    expect(spec.groupBy).toBe('lifecycle');
    expect(spec.filters).toEqual(base.filters);
    expect(spec.columns).toEqual(base.columns);
    expect(spec.sort).toEqual(base.sort);
  });

  it('makes bar, donut and (with a split) stacked bar tiles available on a dashboard', () => {
    expect(tileKindsFor(base)).toEqual(['kpi', 'table']);
    expect(tileKindsFor(applied({ showAs: 'bar', groupBy: 'lifecycle' }))).toEqual(['kpi', 'bar', 'donut', 'table']);
    expect(tileKindsFor(applied({ showAs: 'bar', groupBy: 'lifecycle', splitBy: 'criticality' }))).toEqual(['kpi', 'bar', 'donut', 'stackedBar', 'table']);
  });

  it('keeps a table with a row limit, or groups a table so it shows a chart above the rows', () => {
    expect(applied({ limit: 10 }).presentation).toEqual({ kind: 'table', limit: 10 });
    const grouped = applied({ groupBy: 'criticality' });
    expect(grouped.presentation).toEqual({ kind: 'table' });
    expect(grouped.groupBy).toBe('criticality');
  });

  it('stores a count without a grouping', () => {
    const spec = applied({ showAs: 'count', groupBy: 'lifecycle', splitBy: 'criticality' });
    expect(spec.presentation).toEqual({ kind: 'count' });
    expect(spec.groupBy).toBeUndefined();
    expect(spec.splitBy).toBeUndefined();
  });

  it('refuses, in plain words, a shape that cannot be drawn', () => {
    expect(applyShape(base, shape({ showAs: 'bar' }))).toEqual({ ok: false, reason: 'Choose a field to group by for a chart.' });
    expect(applyShape(base, shape({ showAs: 'donut' })).ok).toBe(false);
    expect(applyShape(base, shape({ showAs: 'bar', groupBy: 'type', splitBy: 'type' })).ok).toBe(false);
    expect(applyShape(base, shape({ showAs: 'donut', groupBy: 'type', splitBy: 'lifecycle' })).ok).toBe(false);
    expect(applyShape(base, shape({ limit: 0 })).ok).toBe(false);
    expect(applyShape(base, shape({ limit: 2.5 })).ok).toBe(false);
  });

  it('drops a split when there is no grouping', () => {
    const spec = applied({ splitBy: 'lifecycle' });
    expect(spec.splitBy).toBeUndefined();
  });

  it('round-trips: every applied spec survives JSON and the contract parser, and reads back as the same shape', () => {
    const shapes: Partial<ReportShape>[] = [{}, { limit: 5 }, { showAs: 'count' }, { showAs: 'bar', groupBy: 'lifecycle' }, { showAs: 'bar', groupBy: 'lifecycle', splitBy: 'criticality' }, { showAs: 'donut', groupBy: 'type' }, { groupBy: 'type' }];
    for (const s of shapes) {
      const spec = applied(s);
      const parsed = parseReportSpec(JSON.parse(JSON.stringify(spec)));
      expect(parsed).toEqual({ ok: true, spec });
      expect(applied(shapeOfSpec(spec))).toEqual(spec);
    }
  });

  it('a grouped report evaluates to groups the charts can draw', () => {
    const rows = [
      { id: '1', name: 'A', type: 'system', lifecycle: 'active', criticality: 'high' },
      { id: '2', name: 'B', type: 'system', lifecycle: 'active', criticality: 'low' },
      { id: '3', name: 'C', type: 'system', lifecycle: 'retiring', criticality: 'high' },
    ];
    const result = runReport(rows, applied({ showAs: 'bar', groupBy: 'lifecycle', splitBy: 'criticality' }));
    expect(result.groups.map((g) => [g.value, g.count])).toEqual([
      ['active', 2],
      ['retiring', 1],
    ]);
    expect(result.groups[0]?.parts?.length).toBeGreaterThan(0);
  });
});

describe('withoutShape', () => {
  it('leaves only the question, so the Elements and Portfolio pages can open a charted report', () => {
    const charted = applied({ showAs: 'bar', groupBy: 'lifecycle', splitBy: 'criticality' });
    expect(withoutShape(charted)).toEqual(base);
  });

  it('re-applying the stored shape after editing the filters keeps the chart (the "Save changes" path)', () => {
    const charted = applied({ showAs: 'donut', groupBy: 'lifecycle' });
    const edited: ReportSpec = { ...withoutShape(charted), filters: [] };
    const merged = applyShape(edited, shapeOfSpec(charted));
    expect(merged.ok && merged.spec).toEqual({ ...charted, filters: [] });
  });
});

describe('groupableFields', () => {
  it('offers the source fields and custom attributes, never helpers or the name', () => {
    expect(groupableFields('elements', ['name', 'type', 'owner', 'id', 'search', 'ownerSort', 'lifecycle', 'costCentre'])).toEqual(['type', 'owner', 'lifecycle', 'costCentre']);
    expect(groupableFields('portfolio', ['name', 'kind', 'cost', 'elementType', 'costRank', 'fit'])).toEqual(['kind', 'cost', 'fit']);
  });
});

describe('canEditReport', () => {
  it('mirrors the update policy: the creator, or an owner or architect on a shared report', () => {
    const mine = { created_by: 'u1', visibility: 'private' as const };
    const shared = { created_by: 'u1', visibility: 'organisation' as const };
    expect(canEditReport(mine, 'u1', 'contributor')).toBe(true);
    expect(canEditReport(mine, 'u2', 'owner')).toBe(false);
    expect(canEditReport(shared, 'u2', 'architect')).toBe(true);
    expect(canEditReport(shared, 'u2', 'contributor')).toBe(false);
    expect(canEditReport(shared, null, 'owner')).toBe(false);
  });
});
