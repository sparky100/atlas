/**
 * Precise relative time (Sprint U4-1 B2, activity row): "minutes / hours /
 * yesterday / date" — deliberately not the provenance staleness bucket
 * `formatAge` in `ProvenanceBadge`/`HistoryTimeline` uses ("< 1mo ago",
 * "3mo ago", "2y ago"). That bucket exists to answer "is this fact still
 * trustworthy" (SPEC's provenance staleness thresholds) — coarse on
 * purpose, since a fact recorded 6 days ago and one recorded 3 weeks ago
 * are both simply "current" for that question, and it also drives the
 * badge's stale-colour threshold, which this function has no opinion on.
 * An activity feed (and, since the Prompt 7h bug fix, `ProvenanceCard`'s
 * own "Effective"/"Recorded" rows — "why do we believe this" wants the
 * precise answer, not the coarse staleness bucket) answers a different
 * question — "what just happened, when, exactly" — where the gap between
 * "2 minutes ago" and "this morning" is the entire point.
 *
 * "Yesterday"/older buckets on calendar-day boundaries (midnight to
 * midnight in the viewer's own local time), not a raw 24h/48h cutoff — a
 * commit from 11pm yesterday should read "Yesterday", not "14h ago" just
 * because fewer than 24 raw hours have passed.
 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatCommitActivityTime(dateStr: string, now: Date): string {
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  // A clock-skewed or just-landed commit reads as "just now" rather than a
  // confusing negative duration.
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`;

  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return `${String(Math.floor(diffMinutes / 60))}h ago`;
  if (dayDiff === 1) return 'Yesterday';
  return date.toLocaleDateString();
}
