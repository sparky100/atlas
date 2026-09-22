import { describe, expect, it } from 'vitest';
import { computeRoadmapAxisTicks, computeRoadmapTimelineRange, computeRoadmapWindow, defaultRoadmapWindowStart, horizonDurationMonths, percentAt, percentAtIso, shiftRoadmapWindowStart, todayPercent } from './roadmapTimelineScale';

const NOW = new Date('2026-06-15T00:00:00Z');

describe('computeRoadmapTimelineRange', () => {
  it('always includes now, padded on each side', () => {
    const range = computeRoadmapTimelineRange([], NOW);
    expect(range.start.getTime()).toBeLessThan(NOW.getTime());
    expect(range.end.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('spans every real, parseable date given, ignoring undefined/invalid ones', () => {
    const range = computeRoadmapTimelineRange(['2020-01-01', undefined, 'not-a-date', '2030-01-01'], NOW);
    expect(range.start.getTime()).toBeLessThan(new Date('2020-01-01').getTime());
    expect(range.end.getTime()).toBeGreaterThan(new Date('2030-01-01').getTime());
  });

  it('falls back to a one-year-either-side window when every given date collapses to the same instant as now', () => {
    const range = computeRoadmapTimelineRange([], NOW);
    const spanDays = (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeGreaterThan(700); // ~2 years, well past the padded-range shape used when dates actually differ
  });
});

describe('percentAt', () => {
  it('places the range\'s own start at 0 and end at 100', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2030-01-01') };
    expect(percentAt(range.start, range)).toBe(0);
    expect(percentAt(range.end, range)).toBe(100);
  });

  it('places the midpoint at 50', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2022-01-01') };
    expect(percentAt(new Date('2021-01-01'), range)).toBeCloseTo(50, 0);
  });

  it('clamps a date outside the range rather than returning a value beyond 0-100', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2021-01-01') };
    expect(percentAt(new Date('2010-01-01'), range)).toBe(0);
    expect(percentAt(new Date('2030-01-01'), range)).toBe(100);
  });
});

describe('percentAtIso', () => {
  it('returns undefined for a missing or unparseable date string', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2021-01-01') };
    expect(percentAtIso(undefined, range)).toBeUndefined();
    expect(percentAtIso('not-a-date', range)).toBeUndefined();
  });

  it('parses a real ISO date string and maps it the same as percentAt', () => {
    const range = { start: new Date('2020-01-01'), end: new Date('2021-01-01') };
    expect(percentAtIso('2020-01-01', range)).toBe(0);
  });
});

describe('computeRoadmapAxisTicks', () => {
  const range = { start: new Date('2026-01-01'), end: new Date('2026-12-31') };

  it('generates quarter ticks by default', () => {
    const ticks = computeRoadmapAxisTicks(range);
    expect(ticks.map((t) => t.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
    expect(ticks[0]?.pct).toBe(0);
    expect(ticks[ticks.length - 1]?.pct).toBeGreaterThan(70);
  });

  it('generates month ticks when granularity is months', () => {
    const ticks = computeRoadmapAxisTicks(range, 'months');
    expect(ticks).toHaveLength(12);
    expect(ticks[0]?.label).toBe('Jan 2026');
    expect(ticks[11]?.label).toBe('Dec 2026');
  });

  it('generates year ticks when granularity is years', () => {
    const multiYearRange = { start: new Date('2024-01-01'), end: new Date('2027-12-31') };
    const ticks = computeRoadmapAxisTicks(multiYearRange, 'years');
    expect(ticks.map((t) => t.label)).toEqual(['2024', '2025', '2026', '2027']);
  });
});

describe('roadmap horizon', () => {
  const NOW = new Date('2026-06-15T00:00:00Z');
  const fullRange = { start: new Date('2020-01-01'), end: new Date('2030-01-01') };

  it('maps each horizon to its fixed duration, with null for "all"', () => {
    expect(horizonDurationMonths('1y')).toBe(12);
    expect(horizonDurationMonths('3y')).toBe(36);
    expect(horizonDurationMonths('all')).toBeNull();
  });

  it('returns the full range unchanged for the "all" horizon', () => {
    expect(computeRoadmapWindow('all', fullRange, NOW, new Date('2025-01-01'))).toBe(fullRange);
  });

  it('centers a fixed horizon on now when no start is given', () => {
    const window = computeRoadmapWindow('1y', fullRange, NOW);
    const spanDays = (window.end.getTime() - window.start.getTime()) / (24 * 60 * 60 * 1000);
    // A 12-month window is 365±7 days, not an exact multiple of 30.
    expect(spanDays).toBeGreaterThan(355);
    expect(spanDays).toBeLessThan(372);
    expect(window.start.getTime()).toBeLessThan(NOW.getTime());
    expect(window.end.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('snaps an explicit start to a month and spans the full horizon', () => {
    const window = computeRoadmapWindow('3y', fullRange, NOW, new Date('2024-07-15'));
    expect(window.start).toEqual(new Date(2024, 6, 1));
    expect(window.end).toEqual(new Date(2027, 6, 1));
  });

  it('defaults a window start to a month boundary', () => {
    const start = defaultRoadmapWindowStart('1y', NOW);
    expect(start.getDate()).toBe(1);
  });

  it('shifts a window start by one quarter each step', () => {
    const start = new Date(2026, 0, 1);
    expect(shiftRoadmapWindowStart(start, 1)).toEqual(new Date(2026, 3, 1));
    expect(shiftRoadmapWindowStart(start, -1)).toEqual(new Date(2025, 9, 1));
  });

  it('reports the today percent only when now is inside the range', () => {
    const inside = todayPercent({ start: new Date('2026-01-01'), end: new Date('2027-01-01') }, NOW);
    expect(inside).toBeTypeOf('number');
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(100);
    expect(todayPercent({ start: new Date('2027-01-01'), end: new Date('2028-01-01') }, NOW)).toBeUndefined();
  });
});
