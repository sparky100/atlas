/**
 * F5's own "time horizontal" — a pure date→percent mapping so
 * `RoadmapView.tsx` can position a bar/marker with a plain CSS
 * `left`/`width`, the same "compute the geometry, let CSS draw it" split
 * `zoom.ts`'s own transform math uses for Landscape, minus any actual
 * zoom/pan state (a roadmap has no camera to move — the whole range is
 * always on screen at once, at whatever width the container has).
 */
export interface RoadmapTimelineRange {
  start: Date;
  end: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Pads the computed range by this many days on each side — a bar landing exactly on the range's own start/end would otherwise sit flush against the container edge, with nothing showing it isn't clipped. */
const PAD_DAYS = 30;

function parseDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The range every bar/marker plots against — every real date in scope,
 * `now` always included (so "today" always has somewhere to sit, even on
 * a roadmap with only future-dated changes), padded by `PAD_DAYS` on each
 * side. Falls back to a `[now - 1y, now + 1y]` window when there is
 * nothing to plot at all — an empty roadmap still needs an axis to render
 * its own "nothing here yet" grid against, not a divide-by-zero range.
 */
export function computeRoadmapTimelineRange(dates: readonly (string | undefined)[], now: Date): RoadmapTimelineRange {
  const parsed = dates.map(parseDate).filter((d): d is Date => d !== null);
  parsed.push(now);

  const minMs = Math.min(...parsed.map((d) => d.getTime()));
  const maxMs = Math.max(...parsed.map((d) => d.getTime()));

  if (minMs === maxMs) {
    return { start: new Date(minMs - 365 * MS_PER_DAY), end: new Date(maxMs + 365 * MS_PER_DAY) };
  }
  return { start: new Date(minMs - PAD_DAYS * MS_PER_DAY), end: new Date(maxMs + PAD_DAYS * MS_PER_DAY) };
}

/** `date`'s own position within `range`, as a percent (0–100), clamped at both ends — a date outside the computed range (shouldn't happen, since the range is built from the same dates) still renders at an edge rather than off-screen or `NaN`. */
export function percentAt(date: Date, range: RoadmapTimelineRange): number {
  const span = range.end.getTime() - range.start.getTime();
  if (span <= 0) return 0;
  const raw = ((date.getTime() - range.start.getTime()) / span) * 100;
  return Math.min(100, Math.max(0, raw));
}

/** Same as `percentAt`, for an ISO date string — `undefined` when the string is missing or unparseable, so a caller never has to re-derive "is this date real" itself. */
export function percentAtIso(value: string | undefined, range: RoadmapTimelineRange): number | undefined {
  const date = parseDate(value);
  return date === null ? undefined : percentAt(date, range);
}
