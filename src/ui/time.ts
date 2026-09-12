import { monthsSince } from '../contracts/thresholds';

/**
 * S1 item 8: "Review queue and every other user-facing time use the one
 * time helper" — every place in the UI that formats a date for display
 * sources it from here instead of a local reimplementation. Three
 * genuinely different vocabularies live here side by side, deliberately,
 * not duplicated, because they answer three different questions:
 *
 * - `formatAge` — "is this fact still trustworthy" (SPEC's provenance
 *   staleness thresholds, `monthsSince`-based, coarse on purpose):
 *   `ProvenanceBadge`'s own compact age indicator and `HistoryTimeline`'s
 *   matching one. Reimplemented near-identically in three places before
 *   this item (`docs/HANDOFF-U4-element-page.md`'s own flagged debt,
 *   including a real inconsistency — `ProvenanceBadge`'s copy omitted the
 *   "ago" suffix the other two had) — now one function returning the bare
 *   "< 1mo" / "Nmo" / "Ny"; callers append their own suffix ("ago", "old",
 *   or none), since that varies by context and isn't part of the age
 *   computation itself.
 * - `formatRelativeTime` — "what just happened, when, exactly" (an
 *   activity feed, a comment's timestamp, a review queue's oldest item):
 *   minutes/hours/"Yesterday"/a calendar date, always about a *past*
 *   event. Already canonical before this item (Sprint U4-1 B2) but housed
 *   under `ui/home/` under a commit-specific name despite non-home,
 *   non-commit callers (`ProvenanceCard`, `CommentThread`,
 *   `notificationFormat`) — moved here and renamed. Also now used by the
 *   Review queue's own "Oldest: opened…" line (item 8's own example),
 *   replacing `formatAge`'s coarse bucket there: a queue item's whole
 *   point is *how* old it is, and the staleness bucket rounds anything
 *   under a month to "< 1mo ago" — uninformative for the common case.
 * - `formatDate` / `formatDateTime` — a plain calendar date (optionally
 *   with time-of-day), for administrative records and *future* dates (a
 *   change's target date, an org member's join date) where "3mo ago"
 *   phrasing would be wrong, or a fixed reference date is what's wanted
 *   rather than a moving "ago" — reimplemented ad hoc in four places
 *   before this item, with no shared function at all.
 */
export function formatAge(date: Date, now: Date): string {
  const months = monthsSince(date, now);
  if (months < 1) return '< 1mo';
  if (months < 24) return `${String(months)}mo`;
  return `${String(Math.floor(months / 12))}y`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Yesterday"/older buckets on calendar-day boundaries (midnight to
 * midnight in the viewer's own local time), not a raw 24h/48h cutoff — a
 * commit from 11pm yesterday should read "Yesterday", not "14h ago" just
 * because fewer than 24 raw hours have passed.
 */
export function formatRelativeTime(dateStr: string, now: Date): string {
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  // A clock-skewed or just-landed event reads as "just now" rather than a
  // confusing negative duration.
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;

  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return `${String(Math.floor(diffMinutes / 60))}h ago`;
  if (dayDiff === 1) return 'Yesterday';
  return date.toLocaleDateString();
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}
