import { useEffect, useState } from 'react';
import type { Delta, UUID } from '../../contracts/delta';
import type { CommitRow, ElementsHeadRow } from '../../contracts/rows';
import { fromDeltaRow } from '../../contracts/rows';
import { getMainBranch, listChangeBranches } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import {
  computeStaleAttributesFinding,
  findBoundaryCrossings,
  findBoundaryCrossingsMissingClassification,
  findBoundaryCrossingsMissingClassificationOrVerb,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findCriticalSystemsWithoutBusinessOwner,
  findExternalInterfacesMissingClassification,
  findExternalOrganisationAccess,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnlabeledVerbRelationships,
  findUnusedIntegrationPlatforms,
  listAllOwnsEdges,
  listAllUsesAndFlowsToEdges,
  listFactsForCommit,
  listUsesAndFlowsToEndpointElements,
  type BoundaryCrossing,
  type ExternalInterfaceCrossing,
  type ExternalOrganisationAccess,
  type StaleAttributesFinding,
  type UnlabeledVerbRelationship,
} from '../../db/healthFindings';
import { listActorsForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { listOpenMergeRequestsForModel } from '../../db/mergeRequests';
import { listAllSupportsEdges, listDeltasForCommits, listRecentCommits } from '../../db/modelHome';
import { listProfilesByIds } from '../../db/profiles';
import type { BranchRow, MergeRequestRow, ProfileRow } from '../../db/types';
import { envelopeSubjects } from '../../engine/describeEnvelope';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/** One "Recent activity" row's own extras beyond the bare `CommitRow` — author display and named subjects, both resolved in a batch across every shown commit rather than per-row (Sprint U4-1 B2). */
export interface RecentCommitRow {
  commit: CommitRow;
  /** `atlas.profiles.display_name`, falling back to `handle`, then the bare author id — same fallback chain `useDirectorHome.ts`'s `VersionStamp.authorDisplay` already uses for a tag's author. */
  authorDisplay: string;
  /** This commit's own named subjects (`envelopeSubjects`), resolved to their current name — empty for a relationship.update/retract/restore-only commit (no endpoint ids to resolve, `describeEnvelope.ts`'s own module comment) or one whose subjects no longer exist at main's current head. */
  subjects: { elementId: UUID; name: string }[];
  /** S1 item 6: "others' activity preferred" — whether the signed-in viewer is this commit's own author, computed here (where `userId` is already in scope) rather than threading `userId` into the presentation component just to re-derive it. */
  isOwn: boolean;
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
  /** S1 item 19's own informational nudge: a platform with modules that itself carries a direct `supports` edge, probably meant for the module. */
  platformSupportsThatShouldMoveToModule: ElementsHeadRow[];
  capabilitiesWithoutOwner: ElementsHeadRow[];
  staleAttributes: StaleAttributesFinding;
  /** Sprint U4-1 B5's fifth finding: `uses`/`flows_to` relationships with no verb-phrase label. */
  unlabeledVerbRelationships: UnlabeledVerbRelationship[];
  /** Prompt 7k item 2's role-aware finding: systems with no `owns` edge carrying `role: 'technical'`. */
  systemsWithoutTechnicalOwner: ElementsHeadRow[];
  /** Prompt 7k item 1: critical systems with no `owns` edge carrying `role: 'business'`. */
  criticalSystemsWithoutBusinessOwner: ElementsHeadRow[];
  /** Prompt 7k item 1: critical systems whose `plannedEnd` falls within `STALE_AFTER_MONTHS`, with no planned replacement (see `findCriticalExposedSystems`'s own comment on that half). */
  criticalExposedSystems: ElementsHeadRow[];
  /** Prompt 7k item 3's own health finding: `uses`/`flows_to` edges crossing the IT/OT boundary with no verb-phrase label or (for `flows_to`) data classification. */
  boundaryCrossingsMissingClassificationOrVerb: BoundaryCrossing[];
  /** Prompt 7k item 3's "Boundary crossings" count-and-link block — every IT/OT crossing, not just the ones missing metadata (that's the health finding above); the full list lives at `BoundaryCrossingsPage.tsx`. */
  boundaryCrossingsCount: number;
  /** Prompt 7k item 4's own health finding: integration platforms with nothing routed via them. */
  unusedIntegrationPlatforms: ElementsHeadRow[];
  /** Prompt 7k item 5's first Assurance finding: systems supporting an `essentialFunction` capability with no `role: 'technical'` owner. */
  systemsSupportingEssentialFunctionWithoutTechnicalOwner: ElementsHeadRow[];
  /** Prompt 7k item 5's second Assurance finding: boundary crossings missing a data classification (the CAF A3/B4-relevant subset of item 3's own wider finding). */
  boundaryCrossingsMissingClassification: BoundaryCrossing[];
  /** Prompt 7k item 5's third Assurance finding: critical systems past or within `STALE_AFTER_MONTHS` of vendor support end. */
  criticalSystemsPastOrNearSupportEnd: ElementsHeadRow[];
  /** S1 item 11a's own first Assurance finding: a `uses`/`flows_to` edge crossing the enterprise/external boundary (`isExternal`/`externalOrganisation`, not IT/OT domain) with no data classification. */
  externalInterfacesMissingClassification: ExternalInterfaceCrossing[];
  /** S1 item 11a's own second Assurance row: purely informational — every external actor `uses` edge, naming the organisation and which system it reaches. No classification requirement (see that finding's own doc comment for why). */
  externalOrganisationAccess: ExternalOrganisationAccess[];
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
        if (!cancelled) setState({ status: 'error', message: 'This model has no main yet.' });
        return;
      }

      const [commits, reviewQueue, changeBranches, capabilities, systems, supportsEdges, ownsEdges, facts, usesAndFlowsToEdges, usesAndFlowsToEndpoints, actors] = await Promise.all([
        // S1 item 6: "recent activity" now groups consecutive same-subject
        // commits into one line and prefers others' activity when trimming
        // to five displayed items (groupRecentActivity.ts) — both can
        // shrink an already-small raw list well below five, so this fetches
        // more raw commits than are ever shown at once, the same way it
        // always fetched more than "Oldest" alone needed.
        listRecentCommits(supabase, main.id, 30),
        listOpenMergeRequestsForModel(supabase, modelId),
        listChangeBranches(supabase, modelId),
        listCapabilitiesForMap(supabase, main.head_commit_id),
        listSystemsForLandscape(supabase, main.head_commit_id),
        listAllSupportsEdges(supabase, main.head_commit_id),
        listAllOwnsEdges(supabase, main.head_commit_id),
        listFactsForCommit(supabase, main.head_commit_id),
        listAllUsesAndFlowsToEdges(supabase, main.head_commit_id),
        listUsesAndFlowsToEndpointElements(supabase, main.head_commit_id),
        // S1 item 11a: an actor can now be a `uses` edge's own endpoint too
        // (`relationshipTypeRules.ts`'s new actor→system/container rows) —
        // `listUsesAndFlowsToEndpointElements` above deliberately excludes
        // actors (its own doc comment: system/container/component only,
        // every type `uses`/`flows_to` could touch *before* this item), so
        // resolving an actor endpoint needs this separate fetch merged in
        // below, not a widened filter on that one.
        listActorsForLandscape(supabase, main.head_commit_id),
      ]);

      const myOpenBranches = changeBranches.filter((b) => b.created_by === userId && MY_OPEN_STATUSES.includes(b.status));
      const usesAndFlowsToEndpointsById = new Map([...usesAndFlowsToEndpoints, ...actors].map((el) => [el.element_id, el]));
      // S1 item 19: `usesAndFlowsToEndpoints` is already every system and
      // container in the model (`listUsesAndFlowsToEndpointElements`'s own
      // doc comment), so a platform's own modules are already in hand here
      // — no second query needed just to find them.
      const containers = usesAndFlowsToEndpoints.filter((el) => el.element_type === 'container');

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
        return { commit, authorDisplay, subjects, isOwn: commit.author_id === userId };
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
            systemsWithoutCapability: findSystemsWithoutCapability(systems, supportsEdges, containers),
            platformSupportsThatShouldMoveToModule: findPlatformSupportsThatShouldMoveToModule(systems, supportsEdges, containers),
            capabilitiesWithoutOwner: findCapabilitiesWithoutOwner(capabilities, supportsEdges, ownsEdges),
            staleAttributes: computeStaleAttributesFinding(facts, systems),
            unlabeledVerbRelationships: findUnlabeledVerbRelationships(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            systemsWithoutTechnicalOwner: findSystemsWithoutTechnicalOwner(systems, ownsEdges),
            criticalSystemsWithoutBusinessOwner: findCriticalSystemsWithoutBusinessOwner(systems, ownsEdges),
            criticalExposedSystems: findCriticalExposedSystems(systems),
            boundaryCrossingsMissingClassificationOrVerb: findBoundaryCrossingsMissingClassificationOrVerb(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            boundaryCrossingsCount: findBoundaryCrossings(usesAndFlowsToEdges, usesAndFlowsToEndpointsById).length,
            unusedIntegrationPlatforms: findUnusedIntegrationPlatforms(systems, usesAndFlowsToEdges),
            systemsSupportingEssentialFunctionWithoutTechnicalOwner: findSystemsSupportingEssentialFunctionWithoutTechnicalOwner(systems, capabilities, supportsEdges, ownsEdges),
            boundaryCrossingsMissingClassification: findBoundaryCrossingsMissingClassification(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            criticalSystemsPastOrNearSupportEnd: findCriticalSystemsPastOrNearSupportEnd(systems),
            externalInterfacesMissingClassification: findExternalInterfacesMissingClassification(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            externalOrganisationAccess: findExternalOrganisationAccess(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
          },
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the architect view.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the architect view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, userId]);

  return state;
}
