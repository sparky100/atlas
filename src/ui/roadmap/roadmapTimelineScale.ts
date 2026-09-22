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

export type RoadmapGranularity = 'months' | 'quarters' | 'years';

export interface RoadmapAxisTick {
  label: string;
  pct: number;
}

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Computes axis ticks along `range` for the given `granularity`.
 * Shared by `RoadmapView.tsx`'s DOM axis and `roadmapPngExport.ts`'s canvas axis,
 * ensuring the visual marks and labels never drift between screen and export.
 */
export function computeRoadmapAxisTicks(range: RoadmapTimelineRange, granularity: RoadmapGranularity = 'quarters'): RoadmapAxisTick[] {
  const ticks: RoadmapAxisTick[] = [];

  if (granularity === 'years') {
    const start = new Date(range.start.getFullYear(), 0, 1);
    for (const cursor = new Date(start); cursor.getTime() <= range.end.getTime(); cursor.setFullYear(cursor.getFullYear() + 1)) {
      ticks.push({ label: String(cursor.getFullYear()), pct: percentAt(cursor, range) });
    }
    return ticks;
  }

  if (granularity === 'months') {
    const totalMonths = (range.end.getFullYear() - range.start.getFullYear()) * 12 + (range.end.getMonth() - range.start.getMonth()) + 1;
    const step = totalMonths > 36 ? 3 : totalMonths > 18 ? 2 : 1;
    const start = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    let prevYear = -1;
    for (const cursor = new Date(start); cursor.getTime() <= range.end.getTime(); cursor.setMonth(cursor.getMonth() + step)) {
      const year = cursor.getFullYear();
      const name = SHORT_MONTH_NAMES[cursor.getMonth()] ?? '';
      // Year only on the first tick of each year — "Jan 2026", then bare
      // "Feb"/"Mar"/… — so dense month ticks stay narrow enough not to
      // collide on even a wide desktop.
      ticks.push({ label: year === prevYear ? name : `${name} ${String(year)}`, pct: percentAt(cursor, range) });
      prevYear = year;
    }
    return ticks;
  }

  // Default: 'quarters'
  const start = new Date(range.start.getFullYear(), Math.floor(range.start.getMonth() / 3) * 3, 1);
  for (const cursor = new Date(start); cursor.getTime() <= range.end.getTime(); cursor.setMonth(cursor.getMonth() + 3)) {
    const quarter = Math.floor(cursor.getMonth() / 3) + 1;
    ticks.push({ label: `Q${String(quarter)} ${String(cursor.getFullYear())}`, pct: percentAt(cursor, range) });
  }
  return ticks;
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

export type RoadmapHorizon = '1y' | '3y' | 'all';

/** How many months a fixed horizon covers; `null` for `'all'` (the full date span). */
export function horizonDurationMonths(horizon: RoadmapHorizon): number | null {
  if (horizon === '1y') return 12;
  if (horizon === '3y') return 36;
  return null;
}

/** The navigation step for the ←/→ steppers, in months (one quarter — small and predictable). */
export const ROADMAP_NAV_STEP_MONTHS = 3;

function toMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** The default left edge of a fixed-horizon window — centered on `now`. */
export function defaultRoadmapWindowStart(horizon: RoadmapHorizon, now: Date): Date {
  const months = horizonDurationMonths(horizon);
  if (months === null) return toMonthStart(now);
  return addMonths(toMonthStart(now), -Math.floor(months / 2));
}

/**
 * The visible timeline window. `'all'` returns `fullRange` unchanged (the
 * current always-fit behaviour); a fixed horizon returns a `horizon`-wide
 * window starting at `start` (or centered on `now` when `start` is absent),
 * snapped to month starts so axis ticks land cleanly.
 */
export function computeRoadmapWindow(horizon: RoadmapHorizon, fullRange: RoadmapTimelineRange, now: Date, start?: Date): RoadmapTimelineRange {
  const months = horizonDurationMonths(horizon);
  if (months === null) return fullRange;
  const windowStart = toMonthStart(start ?? defaultRoadmapWindowStart(horizon, now));
  return { start: windowStart, end: addMonths(windowStart, months) };
}

/** Advances a fixed-horizon window's start by one nav step (`direction` = -1 back, +1 forward). */
export function shiftRoadmapWindowStart(start: Date, direction: -1 | 1): Date {
  return addMonths(toMonthStart(start), direction * ROADMAP_NAV_STEP_MONTHS);
}

/** `now`'s position on the axis as a percent, or `undefined` when `now` falls outside `range` (used to decide whether to draw the "today" marker). */
export function todayPercent(range: RoadmapTimelineRange, now: Date): number | undefined {
  if (now.getTime() < range.start.getTime() || now.getTime() > range.end.getTime()) return undefined;
  return percentAt(now, range);
}
