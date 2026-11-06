import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_SPEC_VERSION, type ReportRow, type ReportSpec } from '../../contracts/reportSpec';
import { runReport } from '../../engine/reportQuery';
import { dashboardExportPlan, EXPORT_CHART_COLOURS, EXPORT_WIDTH, reportExportPlan, type ExportTileItem } from './dashboardExport';
import type { ExportShape } from './viewExport';

const stamp = { modelName: 'Acme', viewLabel: 'Estate overview', refLabel: 'Main', date: '2026-11-06' };
const lifecycles = ['active', 'active', 'retiring', 'planned', 'retired'];
const owners = ['Ann', 'Bob', null, 'Dee'];
const rows: ReportRow[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${String(i).padStart(3, '0')}`, name: `Element ${String(i)}`, type: i % 3 === 0 ? 'system' : 'capability', owner: owners[i % 4] ?? null, lifecycle: lifecycles[i % 5] ?? null }));
const base: ReportSpec = { specVersion: REPORT_SPEC_VERSION, source: 'elements', filters: [], columns: ['name', 'type', 'owner'], sort: [{ field: 'name', direction: 'asc' }], presentation: { kind: 'table' } };

function item(kind: ExportTileItem['kind'], size: ExportTileItem['size'], over: Partial<ReportSpec> = {}): ExportTileItem {
  const spec: ReportSpec = { ...base, ...over };
  return { title: `Tile ${kind}`, kind, size, spec, result: runReport(rows, spec) };
}

const items: ExportTileItem[] = [
  item('kpi', 'one'),
  item('kpi', 'one'),
  item('kpi', 'one'),
  item('stackedBar', 'two', { groupBy: 'type', splitBy: 'lifecycle', presentation: { kind: 'barByField' } }),
  item('donut', 'one', { groupBy: 'lifecycle', presentation: { kind: 'donut' } }),
  item('bar', 'one', { groupBy: 'owner', presentation: { kind: 'barByField' } }),
  item('table', 'two', { presentation: { kind: 'table', limit: 5 } }),
];

function bounds(s: ExportShape): { x: number; y: number; w: number } {
  if (s.kind === 'rect') return { x: s.x, y: s.y, w: s.w };
  if (s.kind === 'arc') return { x: s.cx - s.outer, y: s.cy - s.outer, w: s.outer * 2 };
  return { x: s.x, y: s.y, w: 0 };
}

describe('dashboardExportPlan', () => {
  const plan = dashboardExportPlan(items, stamp);

  it('carries the standard stamp and every tile title', () => {
    const texts = plan.shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
    expect(texts.some((t) => t.includes('Estate overview') && t.includes('Acme'))).toBe(true);
    expect(texts.some((t) => t.includes('Main') && t.includes('2026-11-06'))).toBe(true);
    for (const kind of ['stackedBar', 'donut', 'bar', 'table']) expect(texts).toContain(`Tile ${kind}`);
  });

  it('keeps every shape inside the picture and no coordinate is NaN', () => {
    expect(plan.width).toBe(EXPORT_WIDTH);
    for (const shape of plan.shapes) {
      const b = bounds(shape);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w)).toBe(true);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(plan.width + 0.01);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(plan.height);
    }
  });

  it('draws a ring segment per donut category, and the big numbers', () => {
    expect(plan.shapes.filter((s) => s.kind === 'arc')).toHaveLength(4);
    const texts = plan.shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
    expect(texts).toContain('60');
  });

  it('is deterministic', () => {
    expect(dashboardExportPlan(items, stamp)).toEqual(plan);
  });

  it('wraps tiles into rows of three columns', () => {
    const cards = plan.shapes.filter((s): s is Extract<ExportShape, { kind: 'rect' }> => s.kind === 'rect' && s.radius === 10);
    expect(cards).toHaveLength(items.length);
    const rowsOfCards = new Set(cards.map((c) => c.y));
    // three KPIs | stacked(2)+donut(1) | bar(1)+table(2)
    expect(rowsOfCards.size).toBe(3);
  });

  it('says so when there are no tiles', () => {
    const empty = dashboardExportPlan([], stamp);
    expect(empty.shapes.some((s) => s.kind === 'text' && s.text.includes('no tiles'))).toBe(true);
  });

  it('caps a long table and says how to get the rest', () => {
    const long = item('table', 'full', { presentation: { kind: 'table' } });
    const big = Array.from({ length: 500 }, (_, i) => ({ id: `x${String(i)}`, name: `N${String(i)}`, type: 'system', owner: null }));
    const result = runReport(big, { ...base, presentation: { kind: 'table' } });
    const p = dashboardExportPlan([{ ...long, result }], stamp);
    expect(p.shapes.some((s) => s.kind === 'text' && s.text.includes('Showing 200 of 500'))).toBe(true);
  });
});

describe('reportExportPlan', () => {
  it('a grouped table report gets a headline, a chart and the table', () => {
    const spec: ReportSpec = { ...base, groupBy: 'lifecycle' };
    const plan = reportExportPlan('Lifecycle report', spec, runReport(rows, spec), stamp);
    const texts = plan.shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []));
    expect(texts).toContain('Rows that match');
    expect(texts).toContain('Rows by lifecycle');
    expect(texts).toContain('Lifecycle report');
  });
});

describe('export chart colours', () => {
  it('match the light values in chartTokens.css', () => {
    const css = readFileSync(new URL('../styles/chartTokens.css', import.meta.url), 'utf8');
    const light = css.slice(css.indexOf(':root {'), css.indexOf('@media'));
    const get = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(light)?.[1];
    EXPORT_CHART_COLOURS.slots.forEach((hex, i) => {
      expect(get(`chart-${String(i + 1)}`)).toBe(hex);
    });
    expect(get('chart-other')).toBe(EXPORT_CHART_COLOURS.other);
    expect(get('chart-unset')).toBe(EXPORT_CHART_COLOURS.unset);
  });
});
