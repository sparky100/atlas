/**
 * P-K2 (SPEC-capture.md §13): `src/engine/trigram.ts`'s pure-TypeScript
 * `trigramSimilarity` equals Postgres's own `similarity(lower(a), lower(b))`
 * to 4 decimal places, for 1,000 generated name pairs. Calls
 * `atlas.trigram_similarity` (`20260920020000_trigram_similarity_check.sql`) —
 * a thin test-only wrapper; application code never calls Postgres for this,
 * per K-9's own "matching must be reproducible with no database" rule.
 *
 * Written and reasoned through, not executed in this sandbox — no Docker
 * route to a local Supabase here, the same standing limitation named
 * throughout every other integration test this session.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trigramSimilarity } from '../engine/trigram';
import { createServiceRoleClient } from '../db/client';
import { loadEnv } from '../db/env';

const env = loadEnv();
const service = createServiceRoleClient(env);

const namePairArb = fc.tuple(fc.string({ minLength: 1, maxLength: 40 }), fc.string({ minLength: 1, maxLength: 40 }));

describe('trigramSimilarity vs Postgres pg_trgm.similarity() (P-K2)', () => {
  it('matches Postgres to 4 decimal places for 1,000 generated name pairs', async () => {
    const pairs = fc.sample(namePairArb, 1000);
    for (const [a, b] of pairs) {
      const { data, error } = await service.schema('atlas').rpc('trigram_similarity', { p_a: a, p_b: b });
      if (error) throw error;
      const postgresScore = Math.round((data as number) * 10000) / 10000;
      const tsScore = Math.round(trigramSimilarity(a.toLowerCase(), b.toLowerCase()) * 10000) / 10000;
      expect(tsScore).toBeCloseTo(postgresScore, 4);
    }
  });
});
