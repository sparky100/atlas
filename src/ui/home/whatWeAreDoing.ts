import type { UUID } from '../../contracts/delta';
import type { BranchRow, DecisionRow, ProfileRow, ProjectRow } from '../../db/types';
import { isDecisionOverdue, projectProgress, type ProjectProgress } from '../projects/projectModel';

/**
 * Overview's "What we're doing" (UI-principles §3, 2026-10-04): the work in
 * hand, read through the record that holds it — projects (ADR-024: the
 * container for a piece of architecture work) and the open decisions that
 * belong to no project (portfolio-level ones, ADR-024 §1's "a project is
 * optional for a decision"). Changes never appear on their own here: a
 * project's changes show only as its progress counts, and a change outside
 * any project — a correction, a record, a decision option, an unattached
 * proposal — is My work's and the Changes page's, not a briefing's.
 */

/** Projects still in hand: active ones, and on-hold ones (paused, not finished). */
const IN_HAND_PROJECT_STATUSES: readonly ProjectRow['status'][] = ['active', 'on_hold'];

export interface ProjectSummary {
  project: ProjectRow;
  ownerDisplay: string;
  progress: ProjectProgress;
  /** This project's own proposed decisions whose needed-by date has passed (ADR-024 §5 "overdue decisions"). */
  overdueDecisions: number;
  /** The earliest needed-by date among this project's own proposed decisions that aren't overdue yet — `null` if none has one. */
  nextDecisionDue: string | null;
}

export interface OpenDecisionSummary {
  decision: DecisionRow;
  ownerDisplay: string;
  overdue: boolean;
}

export interface WhatWeAreDoing {
  projects: ProjectSummary[];
  /** Proposed decisions with no project, overdue first, then by needed-by date (none last), then title. */
  decisionsOutsideProjects: OpenDecisionSummary[];
}

/** A person's display name or handle — falling back to their bare id, the same fallback `useDirectorHome`'s version stamps use. */
export function displayNameOf(userId: UUID, profilesById: ReadonlyMap<UUID, ProfileRow>): string {
  const profile = profilesById.get(userId);
  return profile?.display_name ?? profile?.handle ?? userId;
}

function compareDatesNullsLast(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

export function buildWhatWeAreDoing(
  projects: readonly ProjectRow[],
  decisions: readonly DecisionRow[],
  changeBranches: readonly BranchRow[],
  profilesById: ReadonlyMap<UUID, ProfileRow>,
  /** ISO `YYYY-MM-DD`. */
  today: string,
): WhatWeAreDoing {
  const projectSummaries = projects
    .filter((p) => IN_HAND_PROJECT_STATUSES.includes(p.status))
    .map((project): ProjectSummary => {
      const projectDecisions = decisions.filter((d) => d.project_id === project.id);
      const projectChanges = changeBranches.filter((b) => b.project_id === project.id);
      const openDecisions = projectDecisions.filter((d) => d.status === 'proposed');
      const overdue = openDecisions.filter((d) => isDecisionOverdue(d, today));
      const upcoming = openDecisions.flatMap((d) => (d.needed_by !== null && !isDecisionOverdue(d, today) ? [d.needed_by] : [])).sort();
      return {
        project,
        ownerDisplay: displayNameOf(project.owner_id, profilesById),
        progress: projectProgress(projectChanges, projectDecisions),
        overdueDecisions: overdue.length,
        nextDecisionDue: upcoming[0] ?? null,
      };
    })
    // Active before on hold; then by target date (none last), then title.
    .sort(
      (a, b) =>
        IN_HAND_PROJECT_STATUSES.indexOf(a.project.status) - IN_HAND_PROJECT_STATUSES.indexOf(b.project.status) ||
        compareDatesNullsLast(a.project.target_date, b.project.target_date) ||
        a.project.title.localeCompare(b.project.title),
    );

  const decisionsOutsideProjects = decisions
    .filter((d) => d.status === 'proposed' && d.project_id === null)
    .map((decision): OpenDecisionSummary => ({ decision, ownerDisplay: displayNameOf(decision.owner_id, profilesById), overdue: isDecisionOverdue(decision, today) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || compareDatesNullsLast(a.decision.needed_by, b.decision.needed_by) || a.decision.title.localeCompare(b.decision.title));

  return { projects: projectSummaries, decisionsOutsideProjects };
}

/** One open decision the viewer owns, on My work — with the project it belongs to, if any. */
export interface OwnedDecision {
  decision: DecisionRow;
  overdue: boolean;
  projectTitle: string | null;
}

export interface MyOwnedWork {
  /** Open (`proposed`) decisions the viewer owns: overdue first, then by needed-by date (none last), then title. */
  decisions: OwnedDecision[];
  /** Projects in hand (active, then on hold) the viewer owns — the same summaries Overview shows. */
  projects: ProjectSummary[];
}

/**
 * My work's "My decisions" and "My projects" (UI-principles §3, 2026-10-04,
 * step 3): what's waiting on the viewer as an owner — never a decision or
 * project merely created by them. Reuses `buildWhatWeAreDoing`'s project
 * summaries so the two views count progress the same way.
 */
export function buildMyOwnedWork(projects: readonly ProjectRow[], decisions: readonly DecisionRow[], changeBranches: readonly BranchRow[], userId: UUID, today: string): MyOwnedWork {
  const projectTitles = new Map(projects.map((p) => [p.id, p.title]));
  const ownedDecisions = decisions
    .filter((d) => d.status === 'proposed' && d.owner_id === userId)
    .map((decision): OwnedDecision => ({ decision, overdue: isDecisionOverdue(decision, today), projectTitle: decision.project_id !== null ? (projectTitles.get(decision.project_id) ?? null) : null }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || compareDatesNullsLast(a.decision.needed_by, b.decision.needed_by) || a.decision.title.localeCompare(b.decision.title));
  const ownedProjects = buildWhatWeAreDoing(
    projects.filter((p) => p.owner_id === userId),
    decisions,
    changeBranches,
    new Map(),
    today,
  ).projects;
  return { decisions: ownedDecisions, projects: ownedProjects };
}

/** One decision made or project ended, for Overview's "What's recent" (UI-principles §3, 2026-10-04, step 4). */
export interface RecentRecord {
  kind: 'decision' | 'project';
  id: UUID;
  title: string;
  /** What happened, in a word: a decision was made; a project was closed or cancelled. */
  outcome: 'decided' | 'closed' | 'cancelled';
  /** When — `decided_at` / `closed_at`, an ISO timestamp. */
  at: string;
}

/**
 * Decisions made (accepted — a cancelled decision is no decision made) and
 * projects ended (closed or cancelled) after `sinceIso` — the newest
 * version's tag time, so "what's moved since the last committee paper" —
 * newest first. `sinceIso` null (no version tagged yet) means every one.
 */
export function buildRecentRecords(decisions: readonly DecisionRow[], projects: readonly ProjectRow[], sinceIso: string | null): RecentRecord[] {
  const after = (at: string | null): at is string => at !== null && (sinceIso === null || at > sinceIso);
  const records: RecentRecord[] = [
    ...decisions.flatMap((d): RecentRecord[] => (d.status === 'accepted' && after(d.decided_at) ? [{ kind: 'decision', id: d.id, title: d.title, outcome: 'decided', at: d.decided_at }] : [])),
    ...projects.flatMap((p): RecentRecord[] =>
      (p.status === 'closed' || p.status === 'cancelled') && after(p.closed_at) ? [{ kind: 'project', id: p.id, title: p.title, outcome: p.status, at: p.closed_at }] : [],
    ),
  ];
  return records.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title));
}
