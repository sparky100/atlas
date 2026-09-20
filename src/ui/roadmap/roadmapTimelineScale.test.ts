import { describe, expect, it } from 'vitest';
import { computeRoadmapTimelineRange, percentAt, percentAtIso } from './roadmapTimelineScale';

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
