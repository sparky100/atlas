import { describe, expect, it } from 'vitest';
import { parseReportSpec, REPORT_SNAPSHOT_ROW_CAP, REPORT_SPEC_VERSION, type ReportSpec } from './reportSpec';

const valid: ReportSpec = {
  specVersion: REPORT_SPEC_VERSION,
  source: 'elements',
  filters: [
    { field: 'type', operator: 'eq', value: 'system' },
    { field: 'lifecycle', operator: 'in', value: ['active', 'retiring'] },
    { field: 'owner', operator: 'isEmpty', value: null },
  ],
  columns: ['name', 'owner'],
  sort: [{ field: 'name', direction: 'asc' }],
  groupBy: 'lifecycle',
  presentation: { kind: 'table', limit: 10 },
};

describe('parseReportSpec', () => {
  it('accepts a well-formed spec and round-trips it through JSON unchanged', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(valid));
    const result = parseReportSpec(roundTripped);
    expect(result).toEqual({ ok: true, spec: valid });
  });

  it('refuses an unknown spec version plainly rather than guessing', () => {
    const result = parseReportSpec({ ...valid, specVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('version 2');
  });

  it('refuses a non-object, an unknown source and an unknown operator', () => {
    expect(parseReportSpec(null).ok).toBe(false);
    expect(parseReportSpec('x').ok).toBe(false);
    expect(parseReportSpec({ ...valid, source: 'deltas' }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, filters: [{ field: 'a', operator: 'matches', value: 'x' }] }).ok).toBe(false);
  });

  it('checks each operator takes the value shape it needs', () => {
    expect(parseReportSpec({ ...valid, filters: [{ field: 'a', operator: 'in', value: 'x' }] }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, filters: [{ field: 'a', operator: 'isEmpty', value: 'x' }] }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, filters: [{ field: 'a', operator: 'eq', value: ['x'] }] }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, filters: [{ field: 'a', operator: 'isNotEmpty' }] }).ok).toBe(true);
  });

  it('needs at least one column, with no repeats', () => {
    expect(parseReportSpec({ ...valid, columns: [] }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, columns: ['name', 'name'] }).ok).toBe(false);
  });

  it('needs a groupBy for a bar presentation, and a positive whole number for a limit', () => {
    const withoutGroup: Record<string, unknown> = { ...valid };
    delete withoutGroup.groupBy;
    expect(parseReportSpec({ ...withoutGroup, presentation: { kind: 'barByField' } }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, presentation: { kind: 'barByField' } }).ok).toBe(true);
    expect(parseReportSpec({ ...valid, presentation: { kind: 'table', limit: 0 } }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, presentation: { kind: 'table', limit: 2.5 } }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, presentation: { kind: 'chart' } }).ok).toBe(false);
  });

  it('exposes the saved-copy row cap ADR-027 names', () => {
    expect(REPORT_SNAPSHOT_ROW_CAP).toBe(5000);
  });
});

describe('splitBy and donut', () => {
  it('accepts splitBy with a different groupBy and round-trips it', () => {
    const spec: ReportSpec = { ...valid, splitBy: 'owner', presentation: { kind: 'barByField' } };
    expect(parseReportSpec(JSON.parse(JSON.stringify(spec)) as unknown)).toEqual({ ok: true, spec });
  });
  it('refuses splitBy without groupBy, or equal to it', () => {
    const noGroup: Record<string, unknown> = { ...valid, splitBy: 'owner' };
    delete noGroup.groupBy;
    expect(parseReportSpec(noGroup).ok).toBe(false);
    expect(parseReportSpec({ ...valid, splitBy: 'lifecycle' }).ok).toBe(false);
    expect(parseReportSpec({ ...valid, splitBy: '' }).ok).toBe(false);
  });
  it('accepts a donut only with a groupBy', () => {
    expect(parseReportSpec({ ...valid, presentation: { kind: 'donut' } }).ok).toBe(true);
    const noGroup: Record<string, unknown> = { ...valid, presentation: { kind: 'donut' } };
    delete noGroup.groupBy;
    expect(parseReportSpec(noGroup).ok).toBe(false);
  });
});
