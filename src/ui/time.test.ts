import { describe, expect, it } from 'vitest';
import { formatAge, formatDate, formatDateTime, formatRelativeTime } from './time';

const NOW = new Date('2026-09-09T12:00:00.000');

describe('formatAge', () => {
  it('under a month: the bare bucket, no suffix', () => {
    expect(formatAge(new Date('2026-09-01T00:00:00.000'), NOW)).toBe('< 1mo');
  });

  it('under two years: months', () => {
    expect(formatAge(new Date('2026-03-01T00:00:00.000'), NOW)).toBe('6mo');
  });

  it('two years or more: years', () => {
    expect(formatAge(new Date('2023-09-01T00:00:00.000'), NOW)).toBe('3y');
  });
});

describe('formatRelativeTime', () => {
  it('under a minute: "just now"', () => {
    expect(formatRelativeTime('2026-09-09T11:59:45.000', NOW)).toBe('just now');
  });

  it('a future timestamp (clock skew): "just now", not a negative duration', () => {
    expect(formatRelativeTime('2026-09-09T12:00:05.000', NOW)).toBe('just now');
  });

  it('under an hour: minutes', () => {
    expect(formatRelativeTime('2026-09-09T11:45:00.000', NOW)).toBe('15m ago');
    expect(formatRelativeTime('2026-09-09T11:01:00.000', NOW)).toBe('59m ago');
  });

  it('same calendar day, an hour or more ago: hours', () => {
    expect(formatRelativeTime('2026-09-09T09:00:00.000', NOW)).toBe('3h ago');
    expect(formatRelativeTime('2026-09-09T00:01:00.000', NOW)).toBe('11h ago');
  });

  it('yesterday by calendar day, even under 24 raw hours ago', () => {
    // 23:30 the day before "now" (12:00) is 12.5 raw hours ago, but a
    // different calendar day — the whole point of using calendar-day
    // boundaries rather than a raw 24h cutoff.
    expect(formatRelativeTime('2026-09-08T23:30:00.000', NOW)).toBe('Yesterday');
  });

  it('yesterday by calendar day, well over 24 raw hours ago', () => {
    expect(formatRelativeTime('2026-09-08T01:00:00.000', NOW)).toBe('Yesterday');
  });

  it('two or more calendar days ago: a plain date, not a bucket', () => {
    const result = formatRelativeTime('2026-09-06T12:00:00.000', NOW);
    expect(result).toBe(new Date('2026-09-06T12:00:00.000').toLocaleDateString());
    expect(result).not.toMatch(/ago|Yesterday/);
  });

  it('months or years ago: still a plain date, never the provenance staleness bucket ("3mo ago"/"2y ago")', () => {
    const result = formatRelativeTime('2024-01-15T12:00:00.000', NOW);
    expect(result).toBe(new Date('2024-01-15T12:00:00.000').toLocaleDateString());
    expect(result).not.toMatch(/mo ago|y ago/);
  });
});

describe('formatDate', () => {
  it('a plain calendar date, no time-of-day, no "ago" wording — works for future dates too', () => {
    expect(formatDate('2030-01-01T00:00:00.000')).toBe(new Date('2030-01-01T00:00:00.000').toLocaleDateString());
  });
});

describe('formatDateTime', () => {
  it('a plain date and time, no "ago" wording', () => {
    expect(formatDateTime('2026-09-09T11:45:00.000')).toBe(new Date('2026-09-09T11:45:00.000').toLocaleString());
  });
});
