/**
 * Quantised zoom for text (UI-principles.md §8.6): text size jumps between
 * a fixed number of discrete steps as the user zooms, rather than scaling
 * continuously — continuous font scaling on Canvas 2D reflows/re-hints
 * glyphs at every fractional scale and reads as a constant, faint jitter
 * during a smooth pinch/wheel zoom.
 */
export const ZOOM_STEPS = 8;

/** Snaps `scale` to the nearest of `ZOOM_STEPS` steps spaced evenly on a log scale between `minScale` and `maxScale` (so the low end of the range, where a 2x change matters a lot, gets the same step density as the high end). */
export function quantizeScale(scale: number, minScale: number, maxScale: number): number {
  const clamped = Math.min(maxScale, Math.max(minScale, scale));
  const logMin = Math.log(minScale);
  const logMax = Math.log(maxScale);
  if (logMax === logMin) return clamped;
  const t = (Math.log(clamped) - logMin) / (logMax - logMin);
  const stepIndex = Math.round(t * (ZOOM_STEPS - 1));
  const quantizedT = stepIndex / (ZOOM_STEPS - 1);
  return Math.exp(logMin + quantizedT * (logMax - logMin));
}
