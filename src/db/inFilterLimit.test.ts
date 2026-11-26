import { describe, expect, it } from 'vitest';
import { assertInFilterSize, MAX_IN_FILTER_VALUES, queryInChunks } from './inFilterLimit';

describe('assertInFilterSize', () => {
  it('does not throw at or under the limit', () => {
    expect(() => {
      assertInFilterSize('ctx', 'id', Array.from({ length: MAX_IN_FILTER_VALUES }, (_, i) => i));
    }).not.toThrow();
    expect(() => {
      assertInFilterSize('ctx', 'id', []);
    }).not.toThrow();
  });

  it('throws over the limit, naming the caller, column, and count', () => {
    const values = Array.from({ length: MAX_IN_FILTER_VALUES + 1 }, (_, i) => i);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(/getElementsByIds/);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(/element_id/);
    expect(() => {
      assertInFilterSize('getElementsByIds', 'element_id', values);
    }).toThrow(new RegExp(String(MAX_IN_FILTER_VALUES + 1)));
  });
});

describe('queryInChunks', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${String(i)}`);

  it('splits a long list so no request carries more than the limit, and joins every row', async () => {
    const sizes: number[] = [];
    const rows = await queryInChunks<string, { id: string }>('ctx', 'id', ids(2 * MAX_IN_FILTER_VALUES + 7), (chunk) => {
      sizes.push(chunk.length);
      return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
    });
    expect(sizes).toEqual([MAX_IN_FILTER_VALUES, MAX_IN_FILTER_VALUES, 7]);
    expect(rows).toHaveLength(2 * MAX_IN_FILTER_VALUES + 7);
  });

  it('makes no request for an empty list', async () => {
    let calls = 0;
    const rows = await queryInChunks<string, unknown>('ctx', 'id', [], () => {
      calls += 1;
      return Promise.resolve({ data: [], error: null });
    });
    expect(rows).toEqual([]);
    expect(calls).toBe(0);
  });

  it('throws with the caller named when any piece fails', async () => {
    await expect(
      queryInChunks<string, unknown>('listThings', 'id', ids(MAX_IN_FILTER_VALUES + 1), (chunk) => Promise.resolve(chunk.length === 1 ? { data: null, error: { message: 'boom' } } : { data: [], error: null })),
    ).rejects.toThrow('listThings: boom');
  });
});
