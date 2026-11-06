import { describe, expect, it } from 'vitest';
import type { ReportGroup } from '../../engine/reportQuery';
import { categoryColour, chartBars, chartCategories, chartDonut, chartStacked } from './chartData';

const g = (value: string | null, count: number, parts?: ReportGroup[]): ReportGroup => (parts ? { value, count, parts } : { value, count });

describe('chartCategories', () => {
  it('orders by size, gives slots alphabetically, and puts Not set last in neutral', () => {
    const c = chartCategories([g('retiring', 2), g('active', 5), g(null, 1), g('planned', 2)]);
    expect(c.map((x) => x.label)).toEqual(['active', 'planned', 'retiring', 'Not set']);
    expect(c.map((x) => x.slot)).toEqual([1, 2, 3, null]);
    expect(categoryColour(c[3] as never)).toBe('var(--chart-unset)');
    expect(categoryColour(c[0] as never)).toBe('var(--chart-1)');
  });
  it('treats an empty string as Not set', () => {
    expect(chartCategories([g('', 3), g('a', 1)]).map((x) => x.label)).toEqual(['a', 'Not set']);
  });
  it('keeps a category colour when another category changes size', () => {
    const before = chartCategories([g('b', 5), g('a', 3), g('c', 1)]);
    const after = chartCategories([g('b', 1), g('a', 9), g('c', 2)]);
    const slot = (list: typeof before, label: string) => list.find((x) => x.label === label)?.slot;
    expect(slot(before, 'a')).toBe(slot(after, 'a'));
    expect(slot(before, 'c')).toBe(slot(after, 'c'));
  });
  it('folds past eight into Other, never a ninth hue', () => {
    const items = Array.from({ length: 11 }, (_, i) => g(`v${String(i).padStart(2, '0')}`, 20 - i));
    const c = chartCategories(items);
    expect(c).toHaveLength(8);
    const other = c.at(-1);
    expect(other?.kind).toBe('other');
    expect(other?.count).toBe(items.slice(7).reduce((s, i) => s + i.count, 0));
    expect(c.reduce((s, x) => s + x.count, 0)).toBe(items.reduce((s, i) => s + i.count, 0));
    expect(new Set(c.filter((x) => x.kind === 'slot').map((x) => x.slot)).size).toBe(7);
  });
});

describe('chartBars', () => {
  it('scales to the longest bar and reports shares', () => {
    const bars = chartBars([g('a', 6), g('b', 3), g('c', 1)]);
    expect(bars.map((b) => b.fraction)).toEqual([1, 0.5, 0.1667]);
    expect(bars.map((b) => b.percent)).toEqual([60, 30, 10]);
  });
  it('handles no groups', () => {
    expect(chartBars([])).toEqual([]);
  });
});

describe('chartStacked', () => {
  const groups = [g('active', 5, [g('Ann', 3), g(null, 2)]), g('retiring', 2, [g('Ann', 1), g('Bob', 1)])];
  it('shares one legend and colours across bars, and segments add up', () => {
    const chart = chartStacked(groups);
    expect(chart.legend.map((l) => l.label)).toEqual(['Ann', 'Bob', 'Not set']);
    for (const bar of chart.bars) expect(bar.segments.reduce((s, x) => s + x.count, 0)).toBe(bar.total);
    const annSlots = chart.bars.map((b) => b.segments.find((s) => s.category.label === 'Ann')?.category.slot);
    expect(new Set(annSlots).size).toBe(1);
  });
  it('segments tile each bar with no overlap, the longest bar filling the width', () => {
    const chart = chartStacked(groups);
    const first = chart.bars[0];
    const last = first?.segments.at(-1);
    expect((last?.start ?? 0) + (last?.width ?? 0)).toBeCloseTo(1, 3);
    for (const bar of chart.bars) {
      let end = 0;
      for (const seg of bar.segments) {
        expect(seg.start).toBeCloseTo(end, 3);
        end = seg.start + seg.width;
      }
    }
  });
});

describe('chartDonut', () => {
  it('draws one path per category and nothing for no data', () => {
    expect(chartDonut([g('a', 1), g('b', 1)])).toHaveLength(2);
    expect(chartDonut([])).toEqual([]);
    expect(chartDonut([g('a', 0)])).toEqual([]);
  });
  it('a single category is a full ring of valid path text', () => {
    const [slice] = chartDonut([g('a', 4)]);
    expect(slice?.percent).toBe(100);
    expect(slice?.path).not.toContain('NaN');
  });
  it('is deterministic', () => {
    const a = chartDonut([g('a', 3), g('b', 2)]);
    expect(chartDonut([g('a', 3), g('b', 2)])).toEqual(a);
  });
});
