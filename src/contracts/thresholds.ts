/**
 * The three global thresholds named in UI-principles.md §8.9. Defined once,
 * imported by engine, UI, and tests — nothing else may restate these
 * numbers. Global for v1 per docs/UI-principles.md §10 decision 2: if
 * per-model thresholds are ever wanted, they become a settings row plus a
 * lookup that falls back to these constants, not a refactor of every call
 * site that currently imports them directly.
 */

/** A fact older than this (months, by `effective_date` or the delta's commit time) is shown in the warning colour. Used by provenance badge age (§4.3) and the director door's staleness health chip (§3.1). */
export const STALE_AFTER_MONTHS = 12;

/** Confidence at or above this renders the full `●●●` band. */
export const CONFIDENCE_HIGH = 0.9;

/** Confidence at or above this (but below CONFIDENCE_HIGH) renders `●●○`; below it renders `●○○`. Also the cutoff for the director door's confidence health chip (§3.1). */
export const CONFIDENCE_MEDIUM = 0.7;

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_HIGH) return 'high';
  if (confidence >= CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

/** Whole months between two dates, floored — the unit every age display in the UI uses (`< 1mo`, `Nmo`, `Ny`). */
export function monthsSince(date: Date, now: Date = new Date()): number {
  const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  // A same-month-but-earlier-day date shouldn't round up to a full month.
  return now.getDate() < date.getDate() ? months - 1 : months;
}

export function isStale(date: Date, now: Date = new Date()): boolean {
  return monthsSince(date, now) >= STALE_AFTER_MONTHS;
}

/**
 * Whole months from `now` until `date` — negative once `date` is in the
 * past. The mirror of `monthsSince` (which measures the other direction);
 * canonical here so every "is this within `STALE_AFTER_MONTHS`" check
 * (capability-level in `src/ui/capabilityMap/metrics.ts`'s
 * `lifecycleExposure`, system-level in `src/db/healthFindings.ts`'s
 * `findCriticalExposedSystems`, Prompt 7k item 1) uses one definition.
 */
export function monthsUntil(date: Date, now: Date = new Date()): number {
  const months = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth());
  return date.getDate() < now.getDate() ? months - 1 : months;
}
