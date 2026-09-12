import { describe, expect, it } from 'vitest';
import { notificationAnchorWords, notificationKindWording, truncateNotificationBody } from './notificationFormat';

describe('truncateNotificationBody', () => {
  it('returns a short body unchanged', () => {
    expect(truncateNotificationBody('Short.')).toBe('Short.');
  });

  it('trims surrounding whitespace even when short', () => {
    expect(truncateNotificationBody('  Short.  ')).toBe('Short.');
  });

  it('truncates a long body to 80 characters with an ellipsis', () => {
    const long = 'x'.repeat(120);
    const result = truncateNotificationBody(long);
    expect(result).toBe(`${'x'.repeat(80)}…`);
    expect(result.length).toBe(81);
  });

  it('does not truncate a body exactly at the limit', () => {
    const exact = 'x'.repeat(80);
    expect(truncateNotificationBody(exact)).toBe(exact);
  });
});

describe('notificationKindWording', () => {
  it("reads 'mentioned you' for a mention notification", () => {
    expect(notificationKindWording('mention', 'Ada')).toBe('Ada mentioned you');
  });

  it("reads 'replied to your thread' for a reply notification", () => {
    expect(notificationKindWording('reply', 'Ada')).toBe('Ada replied to your thread');
  });
});

describe('notificationAnchorWords', () => {
  // `formatRelativeTime`'s own buckets (`src/ui/time.ts`): a same-calendar-
  // day gap reads "Nh ago" — deterministic across locales, unlike its
  // older-than-yesterday branch (`toLocaleDateString()`), which this suite
  // deliberately avoids for that reason. No `Z` suffix, exactly
  // `time.test.ts`'s own convention — both timestamps parse in the same
  // local timezone, so "same calendar day" holds regardless of where this
  // runs.
  const now = new Date('2026-09-09T12:00:00.000');
  const createdAt = '2026-09-09T10:00:00.000';

  it('states a resolved subject name, anchor type, view kind and age, in that order', () => {
    expect(notificationAnchorWords('Northgate Revenues', 'element', 'landscape', now, createdAt)).toBe('Northgate Revenues · element · landscape · 2h ago');
  });

  it('falls back to "a {anchorType}" when the subject name is unresolved', () => {
    expect(notificationAnchorWords(undefined, 'change', null, now, createdAt)).toBe('a change · change · 2h ago');
  });

  it('omits the view kind segment when there is none', () => {
    expect(notificationAnchorWords('Retire the legacy CRM', 'change', null, now, createdAt)).toBe('Retire the legacy CRM · change · 2h ago');
  });
});
