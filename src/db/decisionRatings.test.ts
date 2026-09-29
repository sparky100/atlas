import { describe, expect, it } from 'vitest';
import { listDecisionRatingsForDecision, upsertDecisionRating } from './decisionRatings';
import type { Client } from './client';

/**
 * F6.2 (fast rating saves) — the isolation property Part A's own
 * performance requirement cares about: a rating read/write touches
 * `decision_option_ratings` and nothing else. No projection table
 * (`elements_head`/`relationships_head`/`commits`), no other decision
 * table, ever gets a `.from()` call from either function — the reason a
 * rating save can never trigger a projection refold or a structural
 * recompute is that it has no code path that could reach either.
 *
 * A minimal fake `Client` — just enough of the postgrest-js builder
 * chain these two functions actually call (`.select`/`.eq`/`.upsert`/
 * `.single`, and the builder itself being awaitable) — records every
 * table name passed to `.from()`.
 */
function createFakeClient(result: { data: unknown; error: null }): { client: Client; calledTables: string[] } {
  const calledTables: string[] = [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    upsert: () => builder,
    single: () => Promise.resolve(result),
    then: (resolve: (value: { data: unknown; error: null }) => void) => {
      resolve(result);
    },
  };
  const client = {
    from: (table: string) => {
      calledTables.push(table);
      return builder;
    },
  };
  return { client: client as unknown as Client, calledTables };
}

describe('decisionRatings.ts touches only decision_option_ratings', () => {
  it('listDecisionRatingsForDecision calls .from() exactly once, for decision_option_ratings', async () => {
    const { client, calledTables } = createFakeClient({ data: [], error: null });
    await listDecisionRatingsForDecision(client, 'decision-1');
    expect(calledTables).toEqual(['decision_option_ratings']);
  });

  it('upsertDecisionRating calls .from() exactly once, for decision_option_ratings', async () => {
    const row = { decision_id: 'decision-1', branch_id: 'branch-1', criterion: 'cost', level: 'favourable', note: null, rated_by: 'user-1', rated_at: '2026-01-01T00:00:00Z' };
    const { client, calledTables } = createFakeClient({ data: row, error: null });
    await upsertDecisionRating(client, { decisionId: 'decision-1', branchId: 'branch-1', criterion: 'cost', level: 'favourable', note: null, ratedBy: 'user-1' });
    expect(calledTables).toEqual(['decision_option_ratings']);
  });
});
