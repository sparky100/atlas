import { describe, expect, it } from 'vitest';
import { quantizeScale, ZOOM_STEPS } from './zoom';

describe('quantizeScale', () => {
  it('clamps to the range before quantizing', () => {
    expect(quantizeScale(0.01, 0.2, 3)).toBeCloseTo(0.2, 5);
    expect(quantizeScale(100, 0.2, 3)).toBeCloseTo(3, 5);
  });

  it('returns exactly one of ZOOM_STEPS distinct values across the whole range', () => {
    const seen = new Set<number>();
    for (let s = 0; s <= 200; s++) {
      seen.add(Number(quantizeScale(0.2 + (s / 200) * (3 - 0.2), 0.2, 3).toFixed(6)));
    }
    expect(seen.size).toBeLessThanOrEqual(ZOOM_STEPS);
  });

  it('is monotonic: a larger input scale never quantizes to a smaller step', () => {
    const a = quantizeScale(0.5, 0.2, 3);
    const b = quantizeScale(1.5, 0.2, 3);
    expect(b).toBeGreaterThanOrEqual(a);
  });

  it('two nearby scales in the same bucket quantize identically (the whole point of quantizing)', () => {
    expect(quantizeScale(0.999, 0.2, 3)).toBe(quantizeScale(1.001, 0.2, 3));
  });
});
