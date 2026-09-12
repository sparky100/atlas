import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { commentMarkerFor } from './commentMarkerFor';

describe('commentMarkerFor', () => {
  it('returns undefined when threadCounts is undefined (not yet loaded)', () => {
    const elementId = randomUUID();
    expect(commentMarkerFor(elementId, undefined)).toBeUndefined();
  });

  it('returns undefined when the element has no entry at all', () => {
    const elementId = randomUUID();
    const threadCounts = new Map([[randomUUID(), { open: 1, total: 1 }]]);
    expect(commentMarkerFor(elementId, threadCounts)).toBeUndefined();
  });

  it('returns undefined when the element has an entry but zero threads total', () => {
    const elementId = randomUUID();
    const threadCounts = new Map([[elementId, { open: 0, total: 0 }]]);
    expect(commentMarkerFor(elementId, threadCounts)).toBeUndefined();
  });

  it('returns an ink marker with the open count when at least one thread is open', () => {
    const elementId = randomUUID();
    const threadCounts = new Map([[elementId, { open: 2, total: 3 }]]);
    expect(commentMarkerFor(elementId, threadCounts)).toEqual({ state: 'ink', count: 2 });
  });

  it('returns a hollow marker when every thread is resolved', () => {
    const elementId = randomUUID();
    const threadCounts = new Map([[elementId, { open: 0, total: 2 }]]);
    expect(commentMarkerFor(elementId, threadCounts)).toEqual({ state: 'hollow' });
  });
});
