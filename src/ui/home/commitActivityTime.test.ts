import { describe, expect, it } from 'vitest';
import { formatCommitActivityTime } from './commitActivityTime';

const NOW = new Date('2026-09-09T12:00:00.000');

describe('formatCommitActivityTime', () => {
  it('under a minute: "just now"', () => {
    expect(formatCommitActivityTime('2026-09-09T11:59:45.000', NOW)).toBe('just now');
  });

  it('a future timestamp (clock skew): "just now", not a negative duration', () => {
    expect(formatCommitActivityTime('2026-09-09T12:00:05.000', NOW)).toBe('just now');
  });

  it('under an hour: minutes', () => {
    expect(formatCommitActivityTime('2026-09-09T11:45:00.000', NOW)).toBe('15m ago');
    expect(formatCommitActivityTime('2026-09-09T11:01:00.000', NOW)).toBe('59m ago');
  });

  it('same calendar day, an hour or more ago: hours', () => {
    expect(formatCommitActivityTime('2026-09-09T09:00:00.000', NOW)).toBe('3h ago');
    expect(formatCommitActivityTime('2026-09-09T00:01:00.000', NOW)).toBe('11h ago');
  });

  it('yesterday by calendar day, even under 24 raw hours ago', () => {
    // 23:30 the day before "now" (12:00) is 12.5 raw hours ago, but a
    // different calendar day — the whole point of using calendar-day
    // boundaries rather than a raw 24h cutoff.
    expect(formatCommitActivityTime('2026-09-08T23:30:00.000', NOW)).toBe('Yesterday');
  });

  it('yesterday by calendar day, well over 24 raw hours ago', () => {
    expect(formatCommitActivityTime('2026-09-08T01:00:00.000', NOW)).toBe('Yesterday');
  });

  it('two or more calendar days ago: a plain date, not a bucket', () => {
    const result = formatCommitActivityTime('2026-09-06T12:00:00.000', NOW);
    expect(result).toBe(new Date('2026-09-06T12:00:00.000').toLocaleDateString());
    expect(result).not.toMatch(/ago|Yesterday/);
  });

  it('months or years ago: still a plain date, never the provenance staleness bucket ("3mo ago"/"2y ago")', () => {
    const result = formatCommitActivityTime('2024-01-15T12:00:00.000', NOW);
    expect(result).toBe(new Date('2024-01-15T12:00:00.000').toLocaleDateString());
    expect(result).not.toMatch(/mo ago|y ago/);
  });
});
