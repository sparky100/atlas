import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_VERSION, type ReportFilter, type ReportRow, type ReportSpec, type ReportValue } from '../contracts/reportSpec';
import { compareReportValues, INCLUDE_NOT_LIVE_FILTER, reportFitsSnapshot, runReport } from './reportQuery';

const rows: ReportRow[] = [
  { id: 'a', name: 'Billing', lifecycle: 'active', cost: 100, owner: 'Ann', supportEnds: '2027-06-30' },
  { id: 'b', name: 'CRM', lifecycle: 'retiring', cost: 300, owner: null, supportEnds: '2026-12-31' },
  { id: 'c', name: 'asset register', lifecycle: 'active', cost: null, owner: '', supportEnds: null },
  { id: 'd', name: 'Billing', lifecycle: 'planned', cost: 50, owner: 'Bob', supportEnds: '2029-01-01' },
];

function spec(overrides: Partial<ReportSpec> = {}): ReportSpec {
  return {
    specVersion: REPORT_SPEC_VERSION,
    source: 'elements',
    filters: [],
    columns: ['name'],
    sort: [{ field: 'id', direction: 'asc' }],
    presentation: { kind: 'table' },
    ...overrides,
  };
}

function ids(filter: ReportFilter): string[] {
  const result = runReport(rows, spec({ filters: [filter], columns: ['id'] }));
  return result.rows.map((row) => String(row[0]));
}

describe('filters', () => {
  it('eq and neq compare exactly, and null equals null', () => {
    expect(ids({ field: 'lifecycle', operator: 'eq', value: 'active' })).toEqual(['a', 'c']);
    expect(ids({ field: 'owner', operator: 'eq', value: null })).toEqual(['b']);
    expect(ids({ field: 'lifecycle', operator: 'neq', value: 'active' })).toEqual(['b', 'd']);
  });

  it('contains is case-insensitive and never matches a missing value', () => {
    expect(ids({ field: 'name', operator: 'contains', value: 'BILL' })).toEqual(['a', 'd']);
    expect(ids({ field: 'owner', operator: 'contains', value: '' })).toEqual(['a', 'c', 'd']);
    expect(ids({ field: 'owner', operator: 'contains', value: 'o' })).toEqual(['d']);
  });

  it('in matches any listed value, including null', () => {
    expect(ids({ field: 'lifecycle', operator: 'in', value: ['planned', 'retiring'] })).toEqual(['b', 'd']);
    expect(ids({ field: 'cost', operator: 'in', value: [null, 50] })).toEqual(['c', 'd']);
  });

  it('lt, lte, gt and gte order numbers and ISO date strings, and skip nulls and mixed types', () => {
    expect(ids({ field: 'cost', operator: 'gt', value: 100 })).toEqual(['b']);
    expect(ids({ field: 'cost', operator: 'gte', value: 100 })).toEqual(['a', 'b']);
    expect(ids({ field: 'cost', operator: 'lt', value: 100 })).toEqual(['d']);
    expect(ids({ field: 'cost', operator: 'lte', value: 100 })).toEqual(['a', 'd']);
    expect(ids({ field: 'supportEnds', operator: 'lt', value: '2027-12-31' })).toEqual(['a', 'b']);
    expect(ids({ field: 'cost', operator: 'gt', value: '10' })).toEqual([]);
    expect(ids({ field: 'cost', operator: 'lt', value: null })).toEqual([]);
  });

  it('isEmpty treats null and the empty string alike; isNotEmpty is its opposite', () => {
    expect(ids({ field: 'owner', operator: 'isEmpty', value: null })).toEqual(['b', 'c']);
    expect(ids({ field: 'owner', operator: 'isNotEmpty', value: null })).toEqual(['a', 'd']);
  });

  it('filters combine with AND', () => {
    const result = runReport(
      rows,
      spec({
        columns: ['id'],
        filters: [
          { field: 'lifecycle', operator: 'eq', value: 'active' },
          { field: 'owner', operator: 'isNotEmpty', value: null },
        ],
      }),
    );
    expect(result.rows).toEqual([['a']]);
    expect(result.rowCount).toBe(1);
  });

  it('a field the rows do not have reads as null', () => {
    expect(ids({ field: 'removedAttribute', operator: 'isEmpty', value: null })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ field: 'removedAttribute', operator: 'eq', value: 'x' })).toEqual([]);
  });
});

describe('sort', () => {
  it('sorts by several keys, case-insensitively for text, and ties break on id', () => {
    const result = runReport(rows, spec({ columns: ['id'], sort: [{ field: 'name', direction: 'asc' }] }));
    // "asset register" < "Billing" (a) = "Billing" (d) < "CRM"
    expect(result.rows.map((r) => r[0])).toEqual(['c', 'a', 'd', 'b']);
  });

  it('puts null last in both directions', () => {
    const asc = runReport(rows, spec({ columns: ['id'], sort: [{ field: 'cost', direction: 'asc' }] }));
    const desc = runReport(rows, spec({ columns: ['id'], sort: [{ field: 'cost', direction: 'desc' }] }));
    expect(asc.rows.map((r) => r[0])).toEqual(['d', 'a', 'b', 'c']);
    expect(desc.rows.map((r) => r[0])).toEqual(['b', 'a', 'd', 'c']);
  });

  it('does not depend on the order the rows arrive in', () => {
    const s = spec({ columns: ['id'], sort: [{ field: 'lifecycle', direction: 'asc' }] });
    const forwards = runReport(rows, s).rows;
    const backwards = runReport([...rows].reverse(), s).rows;
    expect(backwards).toEqual(forwards);
  });

  it('keeps input order for equal rows when nothing breaks the tie', () => {
    const noIds: ReportRow[] = [{ n: 'x', k: 1 }, { n: 'y', k: 1 }, { n: 'z', k: 1 }];
    const result = runReport(noIds, spec({ columns: ['n'], sort: [{ field: 'k', direction: 'asc' }] }));
    expect(result.rows.map((r) => r[0])).toEqual(['x', 'y', 'z']);
  });

  it('orders mixed types numbers, strings, booleans, then null', () => {
    expect(compareReportValues(1, 'a')).toBeLessThan(0);
    expect(compareReportValues('a', true)).toBeLessThan(0);
    expect(compareReportValues(true, null)).toBeLessThan(0);
    expect(compareReportValues(null, null)).toBe(0);
  });
});

describe('presentation, groups and limits', () => {
  it('a table limit trims the rows but reports the full count and that it was cut', () => {
    const result = runReport(rows, spec({ presentation: { kind: 'table', limit: 2 } }));
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(4);
    expect(result.truncated).toBe(true);
    const all = runReport(rows, spec({ presentation: { kind: 'table', limit: 10 } }));
    expect(all.truncated).toBe(false);
  });

  it('a count presentation carries the count and no rows', () => {
    const result = runReport(rows, spec({ presentation: { kind: 'count' }, filters: [{ field: 'lifecycle', operator: 'eq', value: 'active' }] }));
    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('groups by a field, largest group first, ties by value, null group kept apart', () => {
    const result = runReport(rows, spec({ groupBy: 'owner', presentation: { kind: 'barByField' } }));
    expect(result.groups).toEqual([
      { value: 'Ann', count: 1 },
      { value: 'Bob', count: 1 },
      { value: '', count: 1 },
      { value: null, count: 1 },
    ].sort((a, b) => b.count - a.count || compareReportValues(a.value, b.value)));
    expect(result.rows).toEqual([]);
    const byLifecycle = runReport(rows, spec({ groupBy: 'lifecycle', presentation: { kind: 'barByField' } }));
    expect(byLifecycle.groups[0]).toEqual({ value: 'active', count: 2 });
    expect(byLifecycle.groups.map((g) => g.value)).toEqual(['active', 'planned', 'retiring']);
  });

  it('groups only the rows that matched the filters', () => {
    const result = runReport(rows, spec({ groupBy: 'lifecycle', presentation: { kind: 'barByField' }, filters: [{ field: 'cost', operator: 'isNotEmpty', value: null }] }));
    expect(result.groups.reduce((sum, g) => sum + g.count, 0)).toBe(3);
  });
});

describe('unknown fields', () => {
  it('names fields no row carries, sorted, once', () => {
    const result = runReport(rows, spec({ columns: ['name', 'gone'], filters: [{ field: 'gone', operator: 'isEmpty', value: null }, { field: 'alsoGone', operator: 'isEmpty', value: null }] }));
    expect(result.unknownFields).toEqual(['alsoGone', 'gone']);
  });

  it('uses the source field list when given, so a field no row happens to fill is not "removed"', () => {
    const result = runReport(rows, spec({ columns: ['name', 'rare'] }), { knownFields: ['id', 'name', 'rare'] });
    expect(result.unknownFields).toEqual([]);
  });

  it('says nothing is unknown when there are no rows and no field list to compare with', () => {
    expect(runReport([], spec({ columns: ['anything'] })).unknownFields).toEqual([]);
    expect(runReport([], spec({ columns: ['anything'] }), { knownFields: ['id'] }).unknownFields).toEqual(['anything']);
  });
});

describe('purity', () => {
  it('does not change the rows it is given', () => {
    const before = JSON.stringify(rows);
    runReport(rows, spec({ sort: [{ field: 'name', direction: 'desc' }], groupBy: 'lifecycle' }));
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('handles no rows', () => {
    const result = runReport([], spec());
    expect(result).toMatchObject({ rows: [], rowCount: 0, truncated: false, groups: [] });
  });
});

describe('reportFitsSnapshot', () => {
  const base = spec();
  it('accepts a result at the cap and refuses one over it', () => {
    const big = (n: number): ReportRow[] => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, name: 'x' }));
    expect(reportFitsSnapshot(runReport(big(5000), base))).toBe(true);
    expect(reportFitsSnapshot(runReport(big(5001), base))).toBe(false);
  });

  it('always fits a count or bar presentation, however many rows matched', () => {
    const many: ReportRow[] = Array.from({ length: 6000 }, (_, i) => ({ id: `r${String(i)}`, name: 'x' }));
    expect(reportFitsSnapshot(runReport(many, spec({ presentation: { kind: 'count' } })))).toBe(true);
    expect(reportFitsSnapshot(runReport(many, spec({ groupBy: 'name', presentation: { kind: 'barByField' } })))).toBe(true);
  });

  it('a table limit under the cap fits even when more rows matched', () => {
    const many: ReportRow[] = Array.from({ length: 6000 }, (_, i) => ({ id: `r${String(i)}`, name: 'x' }));
    expect(reportFitsSnapshot(runReport(many, spec({ presentation: { kind: 'table', limit: 100 } })))).toBe(true);
  });
});

describe('splitBy', () => {
  const split = (over: Partial<ReportSpec> = {}) => runReport(rows, spec({ groupBy: 'lifecycle', splitBy: 'owner', presentation: { kind: 'barByField' }, ...over }));

  it('splits every group, parts add up to the group, and parts share one order', () => {
    const result = split();
    for (const group of result.groups) {
      expect(group.parts?.reduce((sum, p) => sum + p.count, 0)).toBe(group.count);
    }
    const active = result.groups.find((g) => g.value === 'active');
    // owners among the two active rows: 'Ann' and ''
    expect(active?.parts?.map((p) => p.value)).toEqual(expect.arrayContaining(['Ann', '']));
    for (const g of result.groups) {
      const values = (g.parts ?? []).map((p) => p.value);
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = values[i] as ReportValue;
          const b = values[j] as ReportValue;
          // If two values appear together in a group, their order matches every other group's.
          const key = `${String(a)}|${String(b)}`;
          expect(result.groups.every((o) => {
            const ov = (o.parts ?? []).map((p) => p.value);
            return !ov.includes(a) || !ov.includes(b) || ov.indexOf(a) < ov.indexOf(b);
          }), key).toBe(true);
        }
      }
    }
  });

  it('is absent without splitBy', () => {
    const result = runReport(rows, spec({ groupBy: 'lifecycle', presentation: { kind: 'barByField' } }));
    expect(result.groups.every((g) => g.parts === undefined)).toBe(true);
  });

  it('names a splitBy field the rows do not carry as unknown', () => {
    expect(split({ splitBy: 'gone' }).unknownFields).toEqual(['gone']);
  });
});

describe('reportFitsSnapshot and groups', () => {
  it('refuses a grouping with more groups than the cap', () => {
    const many: ReportRow[] = Array.from({ length: 5001 }, (_, i) => ({ id: `r${String(i)}`, k: `v${String(i)}` }));
    expect(reportFitsSnapshot(runReport(many, spec({ groupBy: 'k', presentation: { kind: 'barByField' } })))).toBe(false);
  });
});

describe('live-only scoping (planned and retired rows)', () => {
  const spec = (filters: ReportSpec['filters'] = []): ReportSpec => ({ specVersion: REPORT_SPEC_VERSION, source: 'portfolio', filters, columns: ['name'], sort: [{ field: 'name', direction: 'asc' }], presentation: { kind: 'table' } });
  const rows: ReportRow[] = [
    { id: 'a', name: 'Active', lifecycleState: 'active' },
    { id: 'p', name: 'Planned', lifecycleState: 'planned' },
    { id: 'r', name: 'Retired', lifecycleState: 'retired' },
  ];
  it('counts only active rows unless the report says otherwise', () => {
    expect(runReport(rows, spec()).rows).toEqual([['Active']]);
  });
  it('INCLUDE_NOT_LIVE_FILTER brings planned and retired rows back', () => {
    expect(runReport(rows, spec([INCLUDE_NOT_LIVE_FILTER])).rows).toEqual([['Active'], ['Planned'], ['Retired']]);
  });
  it('a filter on the state itself picks exactly that state', () => {
    expect(runReport(rows, spec([{ field: 'lifecycleState', operator: 'eq', value: 'planned' }])).rows).toEqual([['Planned']]);
  });
  it('rows with no lifecycleState (relationships, findings) are untouched', () => {
    expect(runReport([{ id: 'x', name: 'Link' }], spec()).rows).toEqual([['Link']]);
  });
});
