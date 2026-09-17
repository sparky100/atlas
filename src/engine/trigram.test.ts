import { describe, expect, it } from 'vitest';
import { IDENTITY_TRIGRAM_THRESHOLD, trigramSimilarity } from './trigram';

describe('trigramSimilarity', () => {
  it('is 1 for identical strings, including two empty ones', () => {
    expect(trigramSimilarity('billing service', 'billing service')).toBe(1);
    expect(trigramSimilarity('', '')).toBe(1);
  });

  it('is symmetric', () => {
    expect(trigramSimilarity('billing service', 'billng service')).toBe(trigramSimilarity('billng service', 'billing service'));
  });

  it('is high for a small typo and low for unrelated strings', () => {
    const typo = trigramSimilarity('billing service', 'billng service');
    const unrelated = trigramSimilarity('billing service', 'customer portal');
    expect(typo).toBeGreaterThanOrEqual(IDENTITY_TRIGRAM_THRESHOLD);
    expect(unrelated).toBeLessThan(IDENTITY_TRIGRAM_THRESHOLD);
  });

  it('is 0 for two strings sharing no trigrams at all', () => {
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  it('is between 0 and 1 for every pair', () => {
    const pairs: [string, string][] = [
      ['a', 'ab'],
      ['', 'x'],
      ['System One', 'system one'],
      ['Dynamics 365', 'Dynamics CRM'],
    ];
    for (const [a, b] of pairs) {
      const similarity = trigramSimilarity(a, b);
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    }
  });
});
