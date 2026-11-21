import { describe, expect, it } from 'vitest';
import { interruptedReview, loadHeldReviews, reviewStorageKey, saveHeldReviews, REVIEW_NOTES_TTL_MS, type HeldReview } from './reviewerNotesStorage';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}

const review: HeldReview = { lens: 'cyber', notes: [{ note: 'Check the connection.', question: 'Who owns the connection?', suggestedQuestion: 'Who owns the connection?', basedOn: { kind: 'option', label: 'Buy quoting' } }], inputHash: 'hash', runId: 'run', inputTokens: 12, outputTokens: 7, savedAt: 1000 };

describe('held second opinions', () => {
  it('is scoped to the user and decision and expires after 24 hours', () => {
    const storage = memory();
    const key = reviewStorageKey('org', 'alice', 'decision');
    saveHeldReviews(storage, key, [review]);
    expect(loadHeldReviews(storage, key, 1000)).toEqual([review]);
    expect(loadHeldReviews(storage, reviewStorageKey('org', 'bob', 'decision'), 1000)).toEqual([]);
    expect(loadHeldReviews(storage, reviewStorageKey('org', 'alice', 'other'), 1000)).toEqual([]);
    expect(loadHeldReviews(storage, key, 1000 + REVIEW_NOTES_TTL_MS)).toEqual([]);
  });

  it('rejects malformed notes and consumes a navigation interruption once', () => {
    const storage = memory();
    const key = reviewStorageKey('org', 'alice', 'decision');
    storage.setItem(key, '{broken');
    expect(loadHeldReviews(storage, key, 1000)).toEqual([]);
    storage.setItem(`${key}:running`, '1000');
    expect(interruptedReview(storage, key, 1100)).toBe(true);
    expect(interruptedReview(storage, key, 1100)).toBe(false);
  });
});
