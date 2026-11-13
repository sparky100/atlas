import { describe, expect, it } from 'vitest';
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, confidenceBand, isReviewOverdue, isStale, monthsSince, monthsUntil, reviewDueDate, STALE_AFTER_MONTHS } from './thresholds';

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

describe('isStale with an organisation threshold', () => {
  it('flags at the given number of months instead of the default', () => {
    const now = new Date('2026-09-08T00:00:00.000Z');
    expect(isStale(new Date('2026-03-08T00:00:00.000Z'), now, 6)).toBe(true);
    expect(isStale(new Date('2026-03-09T00:00:00.000Z'), now, 6)).toBe(false);
    expect(isStale(new Date('2026-03-08T00:00:00.000Z'), now)).toBe(false);
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

describe('review period', () => {
  const created = '2026-11-01T09:00:00Z';
  it('is due periodDays calendar days after submission', () => {
    expect(reviewDueDate(created, 5).toISOString()).toBe('2026-11-06T09:00:00.000Z');
  });
  it('is overdue only once past the due date', () => {
    expect(isReviewOverdue({ status: 'pending', created_at: created }, 5, new Date('2026-11-06T08:59:00Z'))).toBe(false);
    expect(isReviewOverdue({ status: 'pending', created_at: created }, 5, new Date('2026-11-06T09:01:00Z'))).toBe(true);
  });
  it('changing the period re-dates an open review', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(isReviewOverdue({ status: 'pending', created_at: created }, 5, now)).toBe(true);
    expect(isReviewOverdue({ status: 'pending', created_at: created }, 14, now)).toBe(false);
  });
  it('is never overdue unless waiting on reviewers', () => {
    for (const status of ['changes_requested', 'approved', 'merged', 'rejected']) {
      expect(isReviewOverdue({ status, created_at: created }, 1, new Date('2027-01-01T00:00:00Z'))).toBe(false);
    }
  });
});
