import { describe, expect, it } from 'vitest';
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, confidenceBand, isStale, monthsSince, monthsUntil, STALE_AFTER_MONTHS } from './thresholds';

describe('confidenceBand', () => {
  it('bands exactly at the documented cutoffs (§8.9)', () => {
    expect(confidenceBand(1)).toBe('high');
    expect(confidenceBand(CONFIDENCE_HIGH)).toBe('high');
    expect(confidenceBand(CONFIDENCE_HIGH - 0.01)).toBe('medium');
    expect(confidenceBand(CONFIDENCE_MEDIUM)).toBe('medium');
    expect(confidenceBand(CONFIDENCE_MEDIUM - 0.01)).toBe('low');
    expect(confidenceBand(0)).toBe('low');
  });
});

describe('monthsSince', () => {
  it('counts whole calendar months', () => {
    expect(monthsSince(new Date('2025-01-15'), new Date('2025-04-15'))).toBe(3);
  });

  it('does not round up when the day-of-month has not yet arrived', () => {
    expect(monthsSince(new Date('2025-01-20'), new Date('2025-04-15'))).toBe(2);
  });

  it('is zero within the same month', () => {
    expect(monthsSince(new Date('2025-04-01'), new Date('2025-04-30'))).toBe(0);
  });
});

describe('monthsUntil', () => {
  it('counts whole calendar months into the future', () => {
    expect(monthsUntil(new Date('2025-04-15'), new Date('2025-01-15'))).toBe(3);
  });

  it('is negative once the date is in the past', () => {
    expect(monthsUntil(new Date('2026-01-01'), new Date('2026-06-15'))).toBeLessThan(0);
  });

  it('does not round up when the day-of-month has not yet arrived', () => {
    expect(monthsUntil(new Date('2025-04-10'), new Date('2025-01-15'))).toBe(2);
  });
});

describe('isStale', () => {
  it('is false just under the threshold and true at it', () => {
    const now = new Date('2026-01-01');
    const justUnder = new Date('2025-01-02'); // 11 months, a day short of 12
    const atThreshold = new Date('2025-01-01'); // exactly 12 months
    expect(monthsSince(justUnder, now)).toBeLessThan(STALE_AFTER_MONTHS);
    expect(isStale(justUnder, now)).toBe(false);
    expect(isStale(atThreshold, now)).toBe(true);
  });
});
