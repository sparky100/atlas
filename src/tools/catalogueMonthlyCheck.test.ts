import { describe, expect, it } from 'vitest';
import {
  addBatch, claimsWithGoneLink, isCheckableClaim, linksToCheck, monthlyActorName, monthlyClaimKey, outstandingClaims, secretsMatch, skippedClaimResult,
  type MonthlyClaim,
} from './catalogueMonthlyCheck';

const NOW = new Date('2026-12-01T03:00:00Z');
const claim = (n: number, over: Partial<MonthlyClaim> = {}): MonthlyClaim => ({
  productId: `00000000-0000-4000-8000-00000000000${String(n)}`, product: `Product ${String(n)}`, vendor: 'Vendor', sourceUrl: `https://example.com/${String(n)}`, statement: `Claim ${String(n)}.`, ...over,
});
const saved = (c: MonthlyClaim, checkedAt: string) => ({ productId: c.productId, sourceUrl: c.sourceUrl, statement: c.statement, checkedAt });

describe('outstandingClaims', () => {
  it('takes claims with no check first, then the oldest, and leaves recent checks alone', () => {
    const c1 = claim(1); const c2 = claim(2); const c3 = claim(3); const c4 = claim(4);
    const { batch, remaining } = outstandingClaims(
      [c1, c2, c3, c4],
      [saved(c1, '2026-11-20T00:00:00Z'), saved(c2, '2026-10-01T00:00:00Z'), saved(c3, '2026-11-30T00:00:00Z')],
      NOW, { batchSize: 10 },
    );
    expect(batch.map((c) => c.productId)).toEqual([c4.productId, c2.productId]);
    expect(remaining).toBe(0);
  });

  it('cuts a batch and says how many are left', () => {
    const claims = [1, 2, 3, 4, 5].map((n) => claim(n));
    const first = outstandingClaims(claims, [], NOW, { batchSize: 2 });
    expect(first.batch).toHaveLength(2);
    expect(first.remaining).toBe(3);
    const done = first.batch.map((c) => saved(c, '2026-12-01T03:01:00Z'));
    const after = outstandingClaims(claims, done, NOW, { batchSize: 2 });
    const doneKeys = new Set(first.batch.map(monthlyClaimKey));
    expect(after.batch.some((c) => doneKeys.has(monthlyClaimKey(c)))).toBe(false)
    expect(after.remaining).toBe(1);
  });

  it('is empty when every claim was checked recently, and leaves out claims the database would refuse', () => {
    const ok = claim(1);
    expect(outstandingClaims([ok], [saved(ok, '2026-11-28T00:00:00Z')], NOW).batch).toEqual([]);
    const bad = [claim(2, { statement: '   ' }), claim(3, { statement: 'x'.repeat(401) }), claim(4, { sourceUrl: '' })];
    expect(bad.some(isCheckableClaim)).toBe(false);
    expect(outstandingClaims(bad, [], NOW).batch).toEqual([]);
  });
});

describe('links and counters', () => {
  it('checks only links with no check or an old one, once each', () => {
    const a = claim(1, { sourceUrl: 'https://example.com/shared' });
    const b = claim(2, { sourceUrl: 'https://example.com/shared' });
    const c = claim(3);
    expect(linksToCheck([a, b, c], [{ url: c.sourceUrl, checkedAt: '2026-11-30T00:00:00Z' }], NOW)).toEqual(['https://example.com/shared']);
    expect(linksToCheck([c], [{ url: c.sourceUrl, checkedAt: '2026-10-01T00:00:00Z' }], NOW)).toEqual([c.sourceUrl]);
  });

  it('saves a claim with a gone link as "can\'t tell" so it counts as checked', () => {
    const a = claim(1); const b = claim(2);
    const gone = claimsWithGoneLink([a, b], [{ url: a.sourceUrl, result: 'gone', httpStatus: 404, finalUrl: null, note: null }]);
    expect(gone.has(monthlyClaimKey(a))).toBe(true);
    expect(gone.has(monthlyClaimKey(b))).toBe(false);
    expect(skippedClaimResult(a)).toMatchObject({ verdict: 'cant_tell', quote: null, model: null, inputTokens: 0 });
  });

  it('adds a batch to a run, counting changed and can\'t-tell claims as needing a look', () => {
    const a = claim(1);
    const result = (verdict: 'supported' | 'changed' | 'cant_tell', tokens: number) => ({ ...skippedClaimResult(a), verdict, inputTokens: tokens, outputTokens: 1 });
    const run = addBatch({ linksChecked: 1, claimsChecked: 1, flagged: 0, inputTokens: 5, outputTokens: 5 }, [{ url: 'u', result: 'works', httpStatus: 200, finalUrl: null, note: null }], [result('supported', 10), result('changed', 20), result('cant_tell', 30)]);
    expect(run).toEqual({ linksChecked: 2, claimsChecked: 4, flagged: 2, inputTokens: 65, outputTokens: 8 });
  });
});

describe('secret and name', () => {
  it('matches only the exact secret and never an empty one', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
    expect(secretsMatch('abc124', 'abc123')).toBe(false);
    expect(secretsMatch('abc12', 'abc123')).toBe(false);
    expect(secretsMatch(null, 'abc123')).toBe(false);
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch('x', null)).toBe(false);
  });

  it('names the person who switched the monthly check on', () => {
    expect(monthlyActorName('Simon Parkinson')).toBe('Monthly check (switched on by Simon Parkinson)');
    expect(monthlyActorName(null)).toContain('a platform admin');
  });
});
