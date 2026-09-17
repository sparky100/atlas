/**
 * Quantised zoom for text (UI-principles.md §8.6): text size jumps between
 * a fixed number of discrete steps as the user zooms, rather than scaling
 * continuously — continuous font scaling on Canvas 2D reflows/re-hints
 * glyphs at every fractional scale and reads as a constant, faint jitter
 * during a smooth pinch/wheel zoom.
 */
export const ZOOM_STEPS = 8;

/**
 * Reported bug: "the mouse scroll wheel doesn't zoom in or out slowly" —
 * repro was Fit, then the on-canvas "+" button (a single, well-behaved
 * step), then the wheel, which could leave the canvas fully blank. Root
 * cause: `LandscapeCanvas.tsx`'s `handleWheel` used to apply a fixed 1.1×
 * step per native `wheel` *event*, regardless of that event's own
 * `deltaY` magnitude. A traditional mouse notch reports one `wheel` event
 * per click, so that read as "1.1× per notch" — but a trackpad, or a
 * high-resolution/high-poll-rate mouse, fires many `wheel` events per
 * physical gesture, each with a `deltaY` far smaller than one notch, and
 * each used to get that same full 10% step anyway. A short, ordinary
 * scroll gesture could fire enough of those events to compound straight to
 * `MAX_SCALE`/`MIN_SCALE` in well under a second — not "slowly" at all —
 * and because the zoom is about the cursor, wherever it happened to be
 * left after the button click, landing at that clamped extreme could pan
 * the whole diagram outside the viewport (and its 20%-margin culling
 * rect), which is what read as "completely blank."
 *
 * `wheelZoomFactor` fixes this by normalising each event's `deltaY` (first
 * to pixels, since `deltaMode` — `WheelEvent.DOM_DELTA_LINE`/`_PAGE` —
 * reports small integers that aren't pixels at all) against `WHEEL_NOTCH_PX`,
 * the size of one standard notch, and scaling the zoom step by how much of
 * a notch this one event actually represents. An event at or above a full
 * notch still yields exactly `WHEEL_NOTCH_FACTOR` — a real mouse wheel's
 * per-notch feel is unchanged — but a burst of much smaller deltas now
 * compounds proportionally slower instead of at that same fixed rate.
 */
export const WHEEL_NOTCH_PX = 100;
export const WHEEL_NOTCH_FACTOR = 1.1;
/** Firefox's default `DOM_DELTA_LINE` mode reports a small integer number of lines, not pixels — an approximate line height converts it back to a pixel-equivalent so it's comparable to `WHEEL_NOTCH_PX`. */
const WHEEL_LINE_HEIGHT_PX = 16;
/** `DOM_DELTA_PAGE` mode is rare (some browsers on Shift+wheel) but gets the same pixel-normalisation treatment for completeness — approximated as one typical viewport height. */
const WHEEL_PAGE_HEIGHT_PX = 800;

/**
 * The multiplicative zoom factor a single `wheel` event's `deltaY`
 * (negative = zoom in, matching the browser's own "scroll up = negative"
 * convention) should apply — `deltaMode` is the event's own
 * `WheelEvent.deltaMode` (0 = pixel, 1 = line, 2 = page). See this file's
 * own comment above for why this exists instead of a flat per-event step.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * WHEEL_LINE_HEIGHT_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_HEIGHT_PX : deltaY;
  const magnitude = Math.min(1, Math.abs(pixels) / WHEEL_NOTCH_PX);
  const step = 1 + (WHEEL_NOTCH_FACTOR - 1) * magnitude;
  return pixels < 0 ? step : 1 / step;
}

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
