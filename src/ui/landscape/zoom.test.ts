import { describe, expect, it } from 'vitest';
import { quantizeScale, WHEEL_NOTCH_FACTOR, WHEEL_NOTCH_PX, wheelZoomFactor, ZOOM_STEPS } from './zoom';

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

describe('wheelZoomFactor', () => {
  // The reported bug: Fit, then the on-canvas "+" button (fine), then the
  // wheel left the canvas blank. Root cause was `handleWheel` applying a
  // flat 1.1x step per native `wheel` event regardless of that event's own
  // `deltaY` — fine for one real mouse notch (one event per click), but a
  // trackpad or a high-resolution mouse fires many events per gesture, each
  // with a `deltaY` far smaller than one notch, and each used to get that
  // same full step anyway — compounding to MIN/MAX_SCALE, and often
  // panning the diagram off-screen (zoom is about the cursor), within a
  // handful of events instead of "slowly".

  it('a full standard notch (>= WHEEL_NOTCH_PX) zooms in/out by exactly the old fixed factor — real mouse-wheel feel is unchanged', () => {
    expect(wheelZoomFactor(-WHEEL_NOTCH_PX, 0)).toBeCloseTo(WHEEL_NOTCH_FACTOR, 10);
    expect(wheelZoomFactor(WHEEL_NOTCH_PX, 0)).toBeCloseTo(1 / WHEEL_NOTCH_FACTOR, 10);
  });

  it('a delta larger than one notch is clamped to the same single-notch factor, not a bigger one', () => {
    expect(wheelZoomFactor(-500, 0)).toBeCloseTo(WHEEL_NOTCH_FACTOR, 10);
    expect(wheelZoomFactor(500, 0)).toBeCloseTo(1 / WHEEL_NOTCH_FACTOR, 10);
  });

  it('a small delta (trackpad/high-resolution-mouse micro-event) yields a proportionally small step, not the full notch factor — this is the fix itself', () => {
    const tinyIn = wheelZoomFactor(-5, 0);
    const tinyOut = wheelZoomFactor(5, 0);
    // Barely more than a no-op step, nowhere near the full 1.1x a fixed
    // per-event factor used to apply regardless of magnitude.
    expect(tinyIn).toBeGreaterThan(1);
    expect(tinyIn).toBeLessThan(1.01);
    expect(tinyOut).toBeLessThan(1);
    expect(tinyOut).toBeGreaterThan(0.99);
  });

  it('a burst of many small-delta events compounds far more slowly than the same number of full-notch events — the actual runaway-zoom scenario', () => {
    // 40 events at deltaY=5 (a plausible single continuous trackpad/high-
    // frequency-mouse scroll gesture) versus 40 real notches.
    let smallDeltaScale = 1;
    let fullNotchScale = 1;
    for (let i = 0; i < 40; i++) {
      smallDeltaScale *= wheelZoomFactor(-5, 0);
      fullNotchScale *= wheelZoomFactor(-WHEEL_NOTCH_PX, 0);
    }
    expect(smallDeltaScale).toBeLessThan(fullNotchScale);
    // The old behaviour (fixed 1.1x per event, ignoring magnitude) would
    // have driven 40 small-delta events straight past MAX_SCALE (4) —
    // 1.1^40 is roughly 45x. The fix keeps a plausible single gesture well
    // short of that.
    expect(smallDeltaScale).toBeLessThan(2);
  });

  it('deltaMode DOM_DELTA_LINE (Firefox default) is normalised to a pixel-equivalent before comparing against a notch, not read as a near-zero delta', () => {
    // A handful of lines is a real, deliberate scroll motion and should
    // land close to a full notch once converted to pixels, not the tiny
    // fraction it would be if the raw line count (e.g. 3) were compared
    // directly against WHEEL_NOTCH_PX (100).
    const factor = wheelZoomFactor(-3, 1);
    expect(factor).toBeGreaterThan(1.03);
    expect(factor).toBeLessThanOrEqual(WHEEL_NOTCH_FACTOR);
  });

  it('deltaY of 0 is a no-op (never a spurious zoom-out)', () => {
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('is symmetric: the same magnitude in and out are exact reciprocals, so zooming in then out by the same gesture returns to the starting scale', () => {
    const inFactor = wheelZoomFactor(-42, 0);
    const outFactor = wheelZoomFactor(42, 0);
    expect(inFactor * outFactor).toBeCloseTo(1, 10);
  });
});
