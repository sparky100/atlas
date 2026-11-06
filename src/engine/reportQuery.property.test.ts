/**
 * Property tests for the report evaluator (ADR-027): determinism, independence
 * from input order, and the arithmetic that ties counts, groups and limits
 * together. The row ids are unique so the final tiebreak makes order total.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseReportSpec, REPORT_FILTER_OPERATORS, REPORT_SPEC_VERSION, type ReportFilter, type ReportRow, type ReportSpec, type ReportValue } from '../contracts/reportSpec';
import { runReport } from './reportQuery';

const FIELDS = ['name', 'lifecycle', 'cost', 'owner'] as const;
const scalar: fc.Arbitrary<ReportValue> = fc.oneof(fc.constant(null), fc.string({ maxLength: 4 }), fc.integer({ min: -5, max: 5 }), fc.boolean());

const rowsArb: fc.Arbitrary<ReportRow[]> = fc
  .uniqueArray(fc.integer({ min: 0, max: 40 }), { maxLength: 25 })
  .chain((idNumbers) =>
    fc.tuple(...idNumbers.map((n) => fc.record({ name: scalar, lifecycle: scalar, cost: scalar, owner: scalar }).map((r): ReportRow => ({ id: `row-${String(n).padStart(3, '0')}`, ...r })))),
  );

const filterArb: fc.Arbitrary<ReportFilter> = fc.oneof(
  fc.record({ field: fc.constantFrom(...FIELDS), operator: fc.constantFrom('eq', 'neq', 'contains', 'lt', 'lte', 'gt', 'gte'), value: scalar }),
  fc.record({ field: fc.constantFrom(...FIELDS), operator: fc.constant('in' as const), value: fc.array(scalar, { maxLength: 4 }) }),
  fc.record({ field: fc.constantFrom(...FIELDS), operator: fc.constantFrom('isEmpty', 'isNotEmpty'), value: fc.constant(null) }),
);

const specArb: fc.Arbitrary<ReportSpec> = fc
  .record({
    filters: fc.array(filterArb, { maxLength: 3 }),
    sort: fc.array(fc.record({ field: fc.constantFrom(...FIELDS), direction: fc.constantFrom('asc', 'desc') }), { maxLength: 3 }),
    groupBy: fc.option(fc.constantFrom(...FIELDS), { nil: undefined }),
    limit: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  })
  .map(({ filters, sort, groupBy, limit }): ReportSpec => ({
    specVersion: REPORT_SPEC_VERSION,
    source: 'elements',
    filters,
    columns: ['id', ...FIELDS],
    sort,
    ...(groupBy === undefined ? {} : { groupBy }),
    presentation: limit === undefined ? { kind: 'table' } : { kind: 'table', limit },
  }));

describe('runReport properties', () => {
  it('is deterministic: the same rows and spec give an identical result', () => {
    fc.assert(
      fc.property(rowsArb, specArb, (rows, spec) => {
        expect(runReport(rows, spec)).toEqual(runReport(rows, spec));
      }),
    );
  });

  it('does not depend on the order rows arrive in (unique ids make the order total)', () => {
    fc.assert(
      fc.property(rowsArb, specArb, (rows, spec) => {
        expect(runReport([...rows].reverse(), spec)).toEqual(runReport(rows, spec));
      }),
    );
  });

  it('group counts add up to the matched row count, and each group is non-empty', () => {
    fc.assert(
      fc.property(rowsArb, specArb, (rows, spec) => {
        const result = runReport(rows, spec);
        if (spec.groupBy === undefined) {
          expect(result.groups).toEqual([]);
          return;
        }
        expect(result.groups.reduce((sum, g) => sum + g.count, 0)).toBe(result.rowCount);
        for (const group of result.groups) expect(group.count).toBeGreaterThan(0);
      }),
    );
  });

  it('shows at most `limit` rows, never more than matched, and flags truncation exactly', () => {
    fc.assert(
      fc.property(rowsArb, specArb, (rows, spec) => {
        const result = runReport(rows, spec);
        const limit = spec.presentation.kind === 'table' ? spec.presentation.limit : undefined;
        expect(result.rows.length).toBeLessThanOrEqual(result.rowCount);
        if (limit !== undefined) expect(result.rows.length).toBe(Math.min(limit, result.rowCount));
        expect(result.truncated).toBe(result.rows.length < result.rowCount);
      }),
    );
  });

  it('a filter can only remove rows, never add them', () => {
    fc.assert(
      fc.property(rowsArb, specArb, filterArb, (rows, spec, extra) => {
        const base = runReport(rows, spec).rowCount;
        const narrower = runReport(rows, { ...spec, filters: [...spec.filters, extra] }).rowCount;
        expect(narrower).toBeLessThanOrEqual(base);
      }),
    );
  });

  it('isEmpty and isNotEmpty split the rows exactly', () => {
    fc.assert(
      fc.property(rowsArb, fc.constantFrom(...FIELDS), (rows, field) => {
        const base: ReportSpec = { specVersion: REPORT_SPEC_VERSION, source: 'elements', filters: [], columns: ['id'], sort: [], presentation: { kind: 'count' } };
        const empty = runReport(rows, { ...base, filters: [{ field, operator: 'isEmpty', value: null }] }).rowCount;
        const full = runReport(rows, { ...base, filters: [{ field, operator: 'isNotEmpty', value: null }] }).rowCount;
        expect(empty + full).toBe(rows.length);
      }),
    );
  });

  it('every generated spec survives JSON and parseReportSpec unchanged', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        const parsed = parseReportSpec(JSON.parse(JSON.stringify(spec)));
        expect(parsed).toEqual({ ok: true, spec });
      }),
    );
  });

  it('knows every operator the contract lists', () => {
    // A guard so adding an operator to the contract without handling it in the evaluator fails here.
    const rows: ReportRow[] = [{ id: 'x', name: 'n' }];
    for (const operator of REPORT_FILTER_OPERATORS) {
      const value = operator === 'in' ? ['n'] : operator === 'isEmpty' || operator === 'isNotEmpty' ? null : 'n';
      const spec: ReportSpec = {
        specVersion: REPORT_SPEC_VERSION,
        source: 'elements',
        filters: [{ field: 'name', operator, value }],
        columns: ['id'],
        sort: [],
        presentation: { kind: 'count' },
      };
      expect(() => runReport(rows, spec)).not.toThrow();
    }
  });
});
