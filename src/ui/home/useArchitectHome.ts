import { useEffect, useState } from 'react';
import type { Delta, UUID } from '../../contracts/delta';
import type { CommitRow, ElementsHeadRow } from '../../contracts/rows';
import { fromDeltaRow } from '../../contracts/rows';
import { getMainBranch, listChangeBranches } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import {
  computeStaleAttributesFinding,
  findCapabilitiesWithoutOwner,
  findSystemsWithoutCapability,
  listAllOwnsEdges,
  listFactsForCommit,
  type StaleAttributesFinding,
} from '../../db/healthFindings';
import { listSystemsForLandscape } from '../../db/landscape';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import { listAllSupportsEdges, listDeltasForCommits, listRecentCommits } from '../../db/modelHome';
import { listProfilesByIds } from '../../db/profiles';
import type { BranchRow, MergeRequestRow, ProfileRow } from '../../db/types';
import { envelopeSubjects } from '../../engine/describeEnvelope';
import { supabase } from '../supabaseClient';

/** One "Recent commits" row's own extras beyond the bare `CommitRow` — author display and named subjects, both resolved in a batch across every shown commit rather than per-row (Sprint U4-1 B2). */
export interface RecentCommitRow {
  commit: CommitRow;
  /** `atlas.profiles.display_name`, falling back to `handle`, then the bare author id — same fallback chain `useDirectorHome.ts`'s `VersionStamp.authorDisplay` already uses for a tag's author. */
  authorDisplay: string;
  /** This commit's own named subjects (`envelopeSubjects`), resolved to their current name — empty for a relationship.update/retract/restore-only commit (no endpoint ids to resolve, `describeEnvelope.ts`'s own module comment) or one whose subjects no longer exist at main's current head. */
  subjects: { elementId: UUID; name: string }[];
}

export interface ArchitectHomeData {
  recentCommits: RecentCommitRow[];
  reviewQueueCount: number;
  oldestReviewItem: MergeRequestRow | null;
  myOpenBranches: BranchRow[];
  /** ADR-019 rule 3: named for Q1, not built — the standing duplicates report this door will eventually surface a count from. Always 0 until then, shown plainly rather than hidden (CLAUDE.md rule 7). */
  duplicatesCount: 0;
  /** Handoff 7d's Health findings (`docs/HANDOFF-7d-architect-door.md`) — the first three, built against real queries; `duplicatesCount` above is the fourth. */
  systemsWithoutCapability: ElementsHeadRow[];
  capabilitiesWithoutOwner: ElementsHeadRow[];
  staleAttributes: StaleAttributesFinding;
}

export type ArchitectHomeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ArchitectHomeData };

// "Still open" for the architect's own branch list: anything short of a
// terminal state (merged/rejected/archived) — draft work included, unlike
// the director's "changes in flight" (useDirectorHome.ts's own
// IN_FLIGHT_STATUSES), since this list exists to answer "what do I still
// have to do", not "what would a director recognise as underway".
const MY_OPEN_STATUSES: BranchRow['status'][] = ['draft', 'proposed', 'in_review', 'approved'];

/**
 * The architect door's data (UI-principles §3.2, built to Handoff 7d's
 * architect-door amendment — `docs/HANDOFF-7d-architect-door.md`). Still
 * scoped down from §3.2's full three-column dashboard: no validation-
 * status-per-item, no "behind main by N commits", no mentions-float-to-
 * top, no capability map below the fold. Health findings are the piece
 * this build adds — see `src/db/healthFindings.ts`'s own module comment.
 */
export function useArchitectHome(modelId: UUID, userId: UUID | null): ArchitectHomeState {
  const [state, setState] = useState<ArchitectHomeState>({ status: 'loading' });

  useEffect(() => {
    if (!modelId || !userId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        if (!cancelled) setState({ status: 'error', message: 'This model has no main branch.' });
        return;
      }

      const [commits, reviewQueue, changeBranches, capabilities, systems, supportsEdges, ownsEdges, facts] = await Promise.all([
        listRecentCommits(supabase, main.id, 10),
        listOpenMergeRequestsForModel(supabase, modelId),
        listChangeBranches(supabase, modelId),
        listCapabilitiesForMap(supabase, main.head_commit_id),
        listSystemsForLandscape(supabase, main.head_commit_id),
        listAllSupportsEdges(supabase, main.head_commit_id),
        listAllOwnsEdges(supabase, main.head_commit_id),
        listFactsForCommit(supabase, main.head_commit_id),
      ]);

      const myOpenBranches = changeBranches.filter((b) => b.created_by === userId && MY_OPEN_STATUSES.includes(b.status));
      const systemIds = new Set(systems.map((s) => s.element_id));

      // Sprint U4-1 B2: author display name and named-subject links for
      // each shown commit, both batched once across every row rather than
      // per-row — the same "resolve the shown rows' own ids in one extra
      // round trip" shape `useDirectorHome.ts`'s `VersionStamp` build uses
      // for a tag's author.
      const deltaRows = await listDeltasForCommits(supabase, commits.map((c) => c.id));
      const deltasByCommit = new Map<UUID, Delta[]>();
      for (const row of deltaRows) {
        const delta = fromDeltaRow(row);
        const existing = deltasByCommit.get(row.commit_id);
        if (existing) existing.push(delta);
        else deltasByCommit.set(row.commit_id, [delta]);
      }
      const subjectIdsByCommit = new Map<UUID, UUID[]>(commits.map((c) => [c.id, envelopeSubjects(deltasByCommit.get(c.id) ?? [])]));
      const allSubjectIds = [...new Set([...subjectIdsByCommit.values()].flat())];

      const [authorProfiles, subjectElements] = await Promise.all([
        listProfilesByIds(supabase, [...new Set(commits.map((c) => c.author_id))]),
        getElementsByIds(supabase, main.head_commit_id, allSubjectIds),
      ]);
      const profileById = new Map<UUID, ProfileRow>(authorProfiles.map((p) => [p.user_id, p]));

      const recentCommits: RecentCommitRow[] = commits.map((commit) => {
        const profile = profileById.get(commit.author_id);
        const authorDisplay = profile?.display_name ?? profile?.handle ?? commit.author_id;
        const subjects = (subjectIdsByCommit.get(commit.id) ?? [])
          .map((elementId) => {
            const element = subjectElements.get(elementId);
            return element ? { elementId, name: element.name } : null;
          })
          .filter((s): s is { elementId: UUID; name: string } => s !== null);
        return { commit, authorDisplay, subjects };
      });

      if (!cancelled) {
        setState({
          status: 'ready',
          data: {
            recentCommits,
            reviewQueueCount: reviewQueue.length,
            oldestReviewItem: reviewQueue[0] ?? null,
            myOpenBranches,
            duplicatesCount: 0,
            systemsWithoutCapability: findSystemsWithoutCapability(systems, supportsEdges),
            capabilitiesWithoutOwner: findCapabilitiesWithoutOwner(capabilities, supportsEdges, ownsEdges),
            staleAttributes: computeStaleAttributesFinding(facts, systemIds),
          },
        });
      }
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the architect view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, userId]);

  return state;
}
