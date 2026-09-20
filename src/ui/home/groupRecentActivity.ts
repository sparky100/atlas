import type { UUID } from '../../contracts/delta';
import type { RecentCommitRow } from './useArchitectHomeInsights';

/**
 * S1 item 6: "Recent activity: five items, others' activity preferred,
 * runs on one subject collapsed ('3 edits to Dynamics'), 'view all'."
 *
 * One displayed row, either a single commit or a collapsed run of several
 * consecutive commits that all touch the same one subject. `latest` is
 * always the most recent commit in the group — its own title/time/author/
 * diff link are what a single-commit row already showed, and what a
 * collapsed run's own meta line (author, time) still shows even once the
 * title becomes the synthetic "N edits to X" summary.
 */
export interface GroupedActivityItem {
  key: UUID;
  latest: RecentCommitRow;
  /** > 1 only for a collapsed run — `latest.commit.title` is used verbatim when this is 1 (a single, ungrouped commit keeps its own real title, never a synthetic "1 edit to X"). */
  count: number;
  /** The one subject every commit in this group shares — `null` for a single ungrouped commit with zero or several subjects (nothing to collapse around), in which case `latest`'s own subjects list still renders exactly as before. */
  subject: { elementId: UUID; name: string } | null;
  isOwn: boolean;
}

/**
 * Collapses consecutive commits (already newest-first) that touch exactly
 * one, identical subject into a single group — "consecutive" so a run
 * never silently merges two edits to the same element that had someone
 * else's unrelated commit in between (that in-between commit stays its own
 * row, in its own correct chronological position, same as any other single
 * commit). A commit with zero or more than one subject can never join or
 * start a run — nothing to name it after.
 */
function collapseRuns(commits: readonly RecentCommitRow[]): GroupedActivityItem[] {
  const groups: GroupedActivityItem[] = [];
  for (const row of commits) {
    const onlySubject = row.subjects.length === 1 ? (row.subjects[0] ?? null) : null;
    const openRun = groups.at(-1);
    if (onlySubject && openRun && openRun.subject?.elementId === onlySubject.elementId) {
      openRun.count += 1;
      continue;
    }
    groups.push({ key: row.commit.id, latest: row, count: 1, subject: onlySubject, isOwn: row.isOwn });
  }
  return groups;
}

/**
 * "Others' activity preferred" when trimming to `limit`: every group
 * whose latest commit isn't the viewer's own is kept ahead of the
 * viewer's own groups, so a viewer who has themselves made several recent
 * edits doesn't crowd a teammate's single one out of the visible five —
 * the whole point of a door meant to orient an architect to what's
 * happening *around* them, not to what they already know they just did.
 * The selected set is still shown in its original newest-first order,
 * though — this reorders which groups make the cut, not how the ones
 * that do are displayed.
 */
export function selectRecentActivity(commits: readonly RecentCommitRow[], limit: number): { shown: GroupedActivityItem[]; rest: GroupedActivityItem[] } {
  const groups = collapseRuns(commits);
  const others = groups.filter((g) => !g.isOwn);
  const own = groups.filter((g) => g.isOwn);
  const selected = new Set([...others.slice(0, limit), ...own.slice(0, Math.max(0, limit - others.length))].map((g) => g.key));
  const shown = groups.filter((g) => selected.has(g.key));
  const rest = groups.filter((g) => !selected.has(g.key));
  return { shown, rest };
}
