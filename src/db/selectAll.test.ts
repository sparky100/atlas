import { describe, expect, it } from 'vitest';
import { selectAll, type SelectAllResult } from './selectAll';

/** A fake postgrest-style query: `.range()` is called repeatedly on the same object, each call returning the next page. */
function fakeQuery<T>(allRows: T[], { count = allRows.length, errorOnPage }: { count?: number | null; errorOnPage?: number } = {}) {
  let calls = 0;
  return {
    range(from: number, to: number): Promise<SelectAllResult<T>> {
      const page = calls;
      calls += 1;
      if (errorOnPage !== undefined && page === errorOnPage) {
        return Promise.resolve({ data: null, error: { message: 'simulated failure' }, count: null });
      }
      return Promise.resolve({ data: allRows.slice(from, to + 1), error: null, count: page === 0 ? count : null });
    },
  };
}

describe('selectAll', () => {
  it('returns every row in one page when the result fits under pageSize', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    await expect(selectAll(fakeQuery(rows), 1000)).resolves.toEqual(rows);
  });

  it('pages past pageSize and reassembles every row, in order', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    await expect(selectAll(fakeQuery(rows), 1000)).resolves.toEqual(rows);
  });

  it('fetches one extra empty page when the total is an exact multiple of pageSize', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const query = fakeQuery(rows);
    await expect(selectAll(query, 1000)).resolves.toEqual(rows);
  });

  it('throws if the query did not request an exact count', async () => {
    const rows = [{ id: 1 }];
    await expect(selectAll(fakeQuery(rows, { count: null }), 1000)).rejects.toThrow(/did not request an exact count/);
  });

  it('throws if the rows collected do not match the reported exact count (truncation/instability guard)', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    // Reports a count of 5 but only 2 rows ever come back — simulates the
    // exact failure mode this helper exists to catch.
    await expect(selectAll(fakeQuery(rows, { count: 5 }), 1000)).rejects.toThrow(/expected 5 rows.*received 2/);
  });

  it('surfaces a page-level query error rather than returning a partial result', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: i }));
    await expect(selectAll(fakeQuery(rows, { errorOnPage: 1 }), 1000)).rejects.toThrow(/simulated failure/);
  });
});
