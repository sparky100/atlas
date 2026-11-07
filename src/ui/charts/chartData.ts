/**
 * ADR-027 (F14 step 6a): the pure half of the chart components — turning a
 * report's groups into categories with a colour slot, bar widths, stacked
 * segments and donut arcs. No React, no DOM, no clock, no randomness, so the
 * same groups always draw the same picture, and a plain `vitest run` can test
 * it.
 *
 * Colour follows the entity, not its rank (dataviz rule): slots are given in
 * alphabetical order of the categories kept, so a category keeps its colour
 * when another changes size. Slots 1-8 are the fixed categorical order; more
 * than eight distinct values folds the smallest into one neutral "Other"; an
 * empty/null value is always the neutral "Not set".
 */
import type { ReportValue } from '../../contracts/reportSpec';
import { compareReportValues, type ReportGroup } from '../../engine/reportQuery';

export const CHART_SLOT_COUNT = 8;

export type ChartCategoryKind = 'slot' | 'other' | 'unset';

export interface ChartCategory {
  /** Stable key for React and for matching parts to categories. */
  key: string;
  label: string;
  count: number;
  kind: ChartCategoryKind;
  /** 1-8 for `slot`; null for the neutral kinds. */
  slot: number | null;
  /** The original value (null for "Not set"; the first folded value for "Other" is not meaningful). */
  value: ReportValue;
}

const OTHER_KEY = '\u0000other';
const UNSET_KEY = '\u0000unset';

function isUnset(value: ReportValue): boolean {
  return value === null || value === '';
}

function labelOf(value: ReportValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/**
 * Categories for a list of (value, count) pairs, in display order: largest
 * first (ties by value), "Other" then "Not set" last. `maxSlots` caps the
 * coloured categories (default eight).
 */
export function chartCategories(items: readonly { value: ReportValue; count: number }[], maxSlots: number = CHART_SLOT_COUNT): ChartCategory[] {
  const named = items.filter((i) => !isUnset(i.value)).sort((a, b) => b.count - a.count || compareReportValues(a.value, b.value));
  const unsetCount = items.filter((i) => isUnset(i.value)).reduce((sum, i) => sum + i.count, 0);
  const folds = named.length > maxSlots;
  const kept = folds ? named.slice(0, maxSlots - 1) : named;
  const otherCount = folds ? named.slice(maxSlots - 1).reduce((sum, i) => sum + i.count, 0) : 0;

  // Slots by alphabetical order of what is kept, so a colour belongs to the category.
  const alphabetical = [...kept].sort((a, b) => compareReportValues(a.value, b.value));
  const slotOf = new Map<ReportValue, number>(alphabetical.map((item, index) => [item.value, index + 1]));

  const categories: ChartCategory[] = kept.map((item) => ({ key: `v:${typeof item.value}:${String(item.value)}`, label: labelOf(item.value), count: item.count, kind: 'slot', slot: slotOf.get(item.value) ?? null, value: item.value }));
  if (otherCount > 0) categories.push({ key: OTHER_KEY, label: 'Other', count: otherCount, kind: 'other', slot: null, value: null });
  if (unsetCount > 0) categories.push({ key: UNSET_KEY, label: 'Not set', count: unsetCount, kind: 'unset', slot: null, value: null });
  return categories;
}

/** Whether a click on this category can be narrowed to its rows: a real value or "Not set", never the folded "Other". */
export function isDrillable(category: Pick<ChartCategory, 'kind'>): boolean {
  return category.kind !== 'other';
}

/** The CSS colour for a category: a categorical token, or a neutral. */
export function categoryColour(category: Pick<ChartCategory, 'kind' | 'slot'>): string {
  if (category.kind === 'slot' && category.slot !== null) return `var(--chart-${String(category.slot)})`;
  return category.kind === 'other' ? 'var(--chart-other)' : 'var(--chart-unset)';
}

export interface ChartBar {
  key: string;
  label: string;
  count: number;
  /** Share of the total, 0-100, one decimal. */
  percent: number;
  /** Bar length as a fraction of the longest bar, 0-1. */
  fraction: number;
  category: ChartCategory;
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Ranked bars for a one-level grouping. */
export function chartBars(groups: readonly ReportGroup[]): ChartBar[] {
  const categories = chartCategories(groups);
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const max = Math.max(1, ...categories.map((c) => c.count));
  return categories.map((c) => ({ key: c.key, label: c.label, count: c.count, percent: total === 0 ? 0 : round((c.count / total) * 100, 1), fraction: round(c.count / max, 4), category: c }));
}

export interface StackedSegment {
  category: ChartCategory;
  count: number;
  /** Start and width as fractions of the longest bar, 0-1. */
  start: number;
  width: number;
}

export interface StackedBar {
  key: string;
  label: string;
  /** The grouping category this bar stands for (its value, for click-through). */
  category: ChartCategory;
  total: number;
  segments: StackedSegment[];
}

export interface StackedChart {
  /** The split categories, in legend order. */
  legend: ChartCategory[];
  bars: StackedBar[];
}

/** Stacked bars for a grouping with `parts`. The split categories (and so colours) are decided over the whole chart, then each bar's parts are mapped onto them. */
export function chartStacked(groups: readonly ReportGroup[]): StackedChart {
  const overall = new Map<ReportValue, number>();
  for (const g of groups) for (const p of g.parts ?? []) overall.set(p.value, (overall.get(p.value) ?? 0) + p.count);
  const legend = chartCategories([...overall.entries()].map(([value, count]) => ({ value, count })));
  const keptSlots = new Map<ReportValue, ChartCategory>();
  for (const c of legend) if (c.kind === 'slot') keptSlots.set(c.value, c);
  const other = legend.find((c) => c.kind === 'other');
  const unset = legend.find((c) => c.kind === 'unset');

  const barCategories = chartCategories(groups);
  const max = Math.max(1, ...barCategories.map((c) => c.count));
  const bars: StackedBar[] = barCategories.map((barCat) => {
    // "Other" and "Not set" bars aggregate their members' parts.
    const members = groups.filter((g) => {
      if (barCat.kind === 'unset') return isUnset(g.value);
      if (barCat.kind === 'slot') return g.value === barCat.value;
      return !isUnset(g.value) && !barCategories.some((c) => c.kind === 'slot' && c.value === g.value);
    });
    const tally = new Map<string, number>();
    for (const g of members) {
      for (const p of g.parts ?? []) {
        const cat = isUnset(p.value) ? unset : (keptSlots.get(p.value) ?? other);
        if (cat) tally.set(cat.key, (tally.get(cat.key) ?? 0) + p.count);
      }
    }
    let start = 0;
    const segments: StackedSegment[] = [];
    for (const cat of legend) {
      const count = tally.get(cat.key) ?? 0;
      if (count === 0) continue;
      const width = round(count / max, 4);
      segments.push({ category: cat, count, start: round(start, 4), width });
      start += width;
    }
    return { key: barCat.key, label: barCat.label, category: barCat, total: barCat.count, segments };
  });
  return { legend, bars };
}

export interface DonutSlice {
  category: ChartCategory;
  percent: number;
  /** SVG path for the ring segment, in a viewBox centred on 0,0. */
  path: string;
}

function point(radius: number, angle: number): string {
  // Angle 0 at 12 o'clock, clockwise.
  const x = round(radius * Math.sin(angle), 2);
  const y = round(-radius * Math.cos(angle), 2);
  return `${String(x)} ${String(y)}`;
}

/** One ring segment between two angles. A full circle is drawn as two halves, because one arc cannot start and end on the same point. */
function ringPath(outer: number, inner: number, from: number, to: number): string {
  const sweep = to - from;
  if (sweep >= Math.PI * 2 - 1e-6) {
    const mid = from + Math.PI;
    return `${ringPath(outer, inner, from, mid)} ${ringPath(outer, inner, mid, from + Math.PI * 2 - 1e-4)}`;
  }
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${point(outer, from)} A ${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${point(outer, to)} L ${point(inner, to)} A ${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${point(inner, from)} Z`;
}

/** Donut slices for a one-level grouping, with a small gap between neighbours. */
export function chartDonut(groups: readonly ReportGroup[], outer = 50, inner = 32): DonutSlice[] {
  const categories = chartCategories(groups);
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return [];
  const gap = categories.length > 1 ? 0.02 : 0;
  let angle = 0;
  return categories.map((category) => {
    const sweep = (category.count / total) * Math.PI * 2;
    const from = angle + gap / 2;
    const to = Math.max(from + 0.001, angle + sweep - gap / 2);
    angle += sweep;
    return { category, percent: round((category.count / total) * 100, 1), path: ringPath(outer, inner, from, to) };
  });
}
