import { describe, expect, it } from 'vitest';
import { mergeQuietRefetch, ratingKey, upsertRatingByKey } from './useDecisionRatings';
import type { DecisionOptionRatingRow } from '../../db/types';

function row(branchId: string, criterion: string, level: DecisionOptionRatingRow['level'], overrides: Partial<DecisionOptionRatingRow> = {}): DecisionOptionRatingRow {
  return { decision_id: 'decision-1', branch_id: branchId, criterion: criterion as DecisionOptionRatingRow['criterion'], level, note: null, rated_by: 'user-1', rated_at: '2026-01-01T00:00:00Z', ...overrides };
}

describe('ratingKey', () => {
  it('combines branch id and criterion — the same pair the DB primary key and upsert conflict target use', () => {
    expect(ratingKey('branch-a', 'cost')).toBe('branch-a:cost');
  });

  it('is distinct for the same branch, different criterion, and vice versa', () => {
    expect(ratingKey('branch-a', 'cost')).not.toBe(ratingKey('branch-a', 'effort'));
    expect(ratingKey('branch-a', 'cost')).not.toBe(ratingKey('branch-b', 'cost'));
  });
});

describe('upsertRatingByKey', () => {
  it('appends a row for a key that does not exist yet', () => {
    const result = upsertRatingByKey([], row('branch-a', 'cost', 'favourable'));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ branch_id: 'branch-a', criterion: 'cost', level: 'favourable' });
  });

  it('replaces the existing row for the same (branch, criterion) key, leaving other rows untouched', () => {
    const existing = [row('branch-a', 'cost', 'favourable'), row('branch-a', 'effort', 'poor' as never)];
    const result = upsertRatingByKey(existing, row('branch-a', 'cost', 'unfavourable'));
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.criterion === 'cost')).toMatchObject({ level: 'unfavourable' });
    expect(result.find((r) => r.criterion === 'effort')).toMatchObject({ level: 'poor' });
  });

  it('never mutates the input array (a fresh array is always returned)', () => {
    const existing = [row('branch-a', 'cost', 'favourable')];
    const result = upsertRatingByKey(existing, row('branch-a', 'cost', 'unfavourable'));
    expect(existing[0]?.level).toBe('favourable');
    expect(result).not.toBe(existing);
  });
});

describe('mergeQuietRefetch (multi-user: a background poll must not clobber an in-flight save)', () => {
  it('fresh wins for every key with no save in flight', () => {
    const prev = [row('branch-a', 'cost', 'favourable')];
    const fresh = [row('branch-a', 'cost', 'unfavourable')];
    const result = mergeQuietRefetch(prev, fresh, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe('unfavourable');
  });

  it('a pending key keeps the local (optimistic) value instead of the poll\'s stale one', () => {
    const prev = [row('branch-a', 'cost', 'favourable')]; // this tab's own optimistic write, not yet reflected server-side
    const fresh = [row('branch-a', 'cost', 'acceptable')]; // the poll's own read, from before this tab's save landed
    const result = mergeQuietRefetch(prev, fresh, new Set([ratingKey('branch-a', 'cost')]));
    expect(result[0]?.level).toBe('favourable');
  });

  it('two different cells rated concurrently never clobber each other: a pending key on one cell does not affect a fresh update on another', () => {
    const prev = [row('branch-a', 'cost', 'favourable'), row('branch-a', 'effort', 'unfavourable')];
    const fresh = [row('branch-a', 'cost', 'acceptable'), row('branch-a', 'effort', 'favourable')];
    // Only `cost` is mid-save in this tab; `effort` was rated by someone else and should pick up fresh's own value.
    const result = mergeQuietRefetch(prev, fresh, new Set([ratingKey('branch-a', 'cost')]));
    expect(result.find((r) => r.criterion === 'cost')?.level).toBe('favourable');
    expect(result.find((r) => r.criterion === 'effort')?.level).toBe('favourable');
  });

  it('keeps a pending row even when the poll\'s own read landed before the write did (row missing from fresh)', () => {
    const prev = [row('branch-a', 'cost', 'favourable')];
    const fresh: DecisionOptionRatingRow[] = []; // the write hasn't reached this poll's own read yet
    const result = mergeQuietRefetch(prev, fresh, new Set([ratingKey('branch-a', 'cost')]));
    expect(result).toHaveLength(1);
    expect(result[0]?.level).toBe('favourable');
  });

  it('drops a row from prev with no pending write and no match in fresh (nothing to keep it alive)', () => {
    const prev = [row('branch-a', 'cost', 'favourable')];
    const fresh: DecisionOptionRatingRow[] = [];
    const result = mergeQuietRefetch(prev, fresh, new Set());
    expect(result).toEqual([]);
  });
});
