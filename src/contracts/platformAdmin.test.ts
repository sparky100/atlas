import { describe, expect, it } from 'vitest';
import { isInactive, latestUse } from './platformAdmin';

const now = new Date('2026-11-14T00:00:00Z');

describe('isInactive', () => {
  it('treats a missing date as inactive', () => {
    expect(isInactive(null, now)).toBe(true);
  });
  it('is active within 30 days and inactive after', () => {
    expect(isInactive('2026-10-20T00:00:00Z', now)).toBe(false);
    expect(isInactive('2026-10-01T00:00:00Z', now)).toBe(true);
  });
});

describe('latestUse', () => {
  it('picks the newer date and handles nulls', () => {
    expect(latestUse(null, null)).toBeNull();
    expect(latestUse('2026-01-01T00:00:00Z', null)).toBe('2026-01-01T00:00:00Z');
    expect(latestUse('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toBe('2026-02-01T00:00:00Z');
  });
});
