import { useEffect, useState } from 'react';
import type { Delta, UUID } from '../../contracts/delta';
import type { CommitRow, ElementsHeadRow } from '../../contracts/rows';
import { fromDeltaRow } from '../../contracts/rows';
import { getMainBranch } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { listDuplicateCandidates } from '../../db/duplicates';
import { getElementsByIds } from '../../db/elements';
import {
  computeStaleAttributesFinding,
  findBoundaryCrossingsMissingClassification,
  findBoundaryCrossingsMissingVerb,
  findCapabilitiesWithoutOwner,
  findCriticalExposedSystems,
  findCriticalSystemsPastOrNearSupportEnd,
  findOutgoingWithoutRetiringChange,
  listOpenProjectScopeForModel,
  loadElementsRetiredByOpenChanges,
  type ElementProjectScope,
  findAiAgentsActingAloneWithoutTechnicalOwner,
  findCriticalSystemsWithoutBusinessOwner,
  findExternalInterfacesMissingClassification,
  findExternalOrganisationAccess,
  findFlowsToPlatformInsteadOfModule,
  findPlatformSupportsThatShouldMoveToModule,
  findSystemsSupportingEssentialFunctionWithoutTechnicalOwner,
  findSystemsWithoutCapability,
  findSystemsWithoutTechnicalOwner,
  findUnlabeledVerbRelationships,
  findUnusedIntegrationInterfaces,
  findUnusedIntegrationPlatforms,
  listAllOwnsEdges,
  listAllReplacesEdges,
  listAllUsesAndFlowsToEdges,
  listFactStalenessForCommit,
  listUsesAndFlowsToEndpointElements,
  type BoundaryCrossing,
  type ExternalInterfaceCrossing,
  type ExternalOrganisationAccess,
  type PlatformFlowEndpoint,
  type StaleAttributesFinding,
  type UnlabeledVerbRelationship,
} from '../../db/healthFindings';
import { listAllElements } from '../../db/elementBrowse';
import { listActorsForLandscape, listSystemsForLandscape } from '../../db/landscape';
import { listAllSupportsEdges, listDeltasForCommits, listRecentCommits } from '../../db/modelHome';
import { listProfilesByIds } from '../../db/profiles';
import { replacedElementIds } from '../../engine/elementRead/fitAndExposure';
import type { ProfileRow } from '../../db/types';
import { envelopeSubjects } from '../../engine/describeEnvelope';
import { reportError } from '../errors/errorBannerStore';
import { useStaleAfterMonths } from '../orgs/staleThresholdContext';
import { useAfterFirstPaint } from '../perf/useAfterFirstPaint';
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

export interface ArchitectHomeInsightsData {
  recentCommits: RecentCommitRow[];
  /** F4 (ADR-019 "Amended (F4, ...)"): the standing duplicates report's own open-candidate count (`duplicate_candidates`, main's current head) — real from here on, no longer the permanent `0` placeholder this field carried before F4 shipped. */
  duplicatesCount: number;
  /** Handoff 7d's Health findings (`docs/HANDOFF-7d-architect-door.md`) — the first three, built against real queries; `duplicatesCount` above is the fourth. */
  systemsWithoutCapability: ElementsHeadRow[];
  /** S1 item 19's own informational nudge: a platform with modules that itself carries a direct `supports` edge, probably meant for the module. */
  platformSupportsThatShouldMoveToModule: ElementsHeadRow[];
  /** S1 item 20's own informational nudge: a `uses`/`flows_to` edge naming a platform with modules directly, on either end, rather than the specific module. */
  flowsToPlatformInsteadOfModule: PlatformFlowEndpoint[];
  capabilitiesWithoutOwner: ElementsHeadRow[];
  staleAttributes: StaleAttributesFinding;
  /** The organisation's stale threshold the finding above was computed with — the Home row words itself with it. */
  staleAfterMonths: number;
  /** Sprint U4-1 B5's fifth finding: `uses`/`flows_to` relationships with no verb-phrase label. */
  unlabeledVerbRelationships: UnlabeledVerbRelationship[];
  /** Prompt 7k item 2's role-aware finding: systems with no `owns` edge carrying `role: 'technical'`. */
  systemsWithoutTechnicalOwner: ElementsHeadRow[];
  /** Prompt 7k item 1: critical systems with no `owns` edge carrying `role: 'business'`. */
  aiAgentsWithoutTechnicalOwner: ElementsHeadRow[];
  criticalSystemsWithoutBusinessOwner: ElementsHeadRow[];
  /** Prompt 7k item 1: critical systems whose `plannedEnd` falls within `STALE_AFTER_MONTHS`, with no planned replacement (see `findCriticalExposedSystems`'s own comment on that half). */
  criticalExposedSystems: ElementsHeadRow[];
  /** Prompt 7k item 3's own health finding: `uses`/`flows_to` edges crossing the IT/OT boundary with no verb-phrase label — a labelling concern, kept separate from Assurance's own missing-classification finding below so a crossing missing both isn't shown as the same finding twice (see `findBoundaryCrossingsMissingVerb`'s own doc comment). */
  boundaryCrossingsMissingVerb: BoundaryCrossing[];
  /** Prompt 7k item 4's own health finding: integration platforms with nothing routed via them. */
  unusedIntegrationPlatforms: ElementsHeadRow[];
  /** ADR-026: interfaces on an integration platform that nothing flows via (`findUnusedIntegrationInterfaces`), named "Platform · Interface". */
  unusedIntegrationInterfaces: ElementsHeadRow[];
  /** Prompt 7k item 5's first Assurance finding: systems supporting an `essentialFunction` capability with no `role: 'technical'` owner. */
  systemsSupportingEssentialFunctionWithoutTechnicalOwner: ElementsHeadRow[];
  /** Prompt 7k item 5's second Assurance finding: boundary crossings missing a data classification (the CAF A3/B4-relevant subset of item 3's own wider finding). */
  boundaryCrossingsMissingClassification: BoundaryCrossing[];
  /** Prompt 7k item 5's third Assurance finding: critical systems past or within `STALE_AFTER_MONTHS` of vendor support end. */
  criticalSystemsPastOrNearSupportEnd: ElementsHeadRow[];
  /** F11: systems and modules marked Migrate or Eliminate with no open change retiring them (`findOutgoingWithoutRetiringChange`). */
  outgoingWithoutRetiringChange: ElementsHeadRow[];
  /** F11: the open project whose declared scope includes each element, when there is one — the finding names it. */
  projectByElementId: Map<UUID, ElementProjectScope>;
  /** S1 item 11a's own first Assurance finding: a `uses`/`flows_to` edge crossing the enterprise/external boundary (`isExternal`/`externalOrganisation`, not IT/OT domain) with no data classification. */
  externalInterfacesMissingClassification: ExternalInterfaceCrossing[];
  /** S1 item 11a's own second Assurance row: purely informational — every external actor `uses` edge, naming the organisation and which system it reaches. No classification requirement (see that finding's own doc comment for why). */
  externalOrganisationAccess: ExternalOrganisationAccess[];
}

export type ArchitectHomeInsightsState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: ArchitectHomeInsightsData };

/**
 * E8 item (4): "non-critical panels (comment counts, health findings,
 * recent activity) load after first paint." This is everything
 * `useArchitectHome.ts` used to compute in the same `Promise.all` as its
 * own now-critical Review-queue/My-changes data — the entire model's
 * capability/system/relationship graph, folded into a dozen health-finding
 * checks, plus recent commits resolved to author/subject names. None of it
 * is needed to paint the door's Review queue or My changes panels, so it
 * no longer blocks them: `useAfterFirstPaint` gates this hook's own fetch
 * until two animation frames after mount, the same wait `useRouteTiming.ts`
 * uses to know the browser has actually painted, not merely queued a
 * frame — so this request genuinely starts after first paint, not just in
 * parallel with the critical one.
 */
export function useArchitectHomeInsights(modelId: UUID, userId: UUID | null): ArchitectHomeInsightsState {
  const staleAfterMonths = useStaleAfterMonths();
  const [state, setState] = useState<ArchitectHomeInsightsState>({ status: 'loading' });
  const afterFirstPaint = useAfterFirstPaint();

  useEffect(() => {
    if (!modelId || !userId || !afterFirstPaint) return undefined;
    let cancelled = false;

    async function load(): Promise<void> {
      const main = await getMainBranch(supabase, modelId);
      if (!main) {
        if (!cancelled) setState({ status: 'error', message: 'This model has no main yet.' });
        return;
      }

      const [commits, capabilities, systems, allElements, supportsEdges, ownsEdges, replacesEdges, facts, usesAndFlowsToEdges, usesAndFlowsToEndpoints, actors, duplicateCandidates, retiringElementIds, projectScope] = await Promise.all([
        // S1 item 6: "recent activity" now groups consecutive same-subject
        // commits into one line and prefers others' activity when trimming
        // to five displayed items (groupRecentActivity.ts) — both can
        // shrink an already-small raw list well below five, so this fetches
        // more raw commits than are ever shown at once, the same way it
        // always fetched more than "Oldest" alone needed.
        listRecentCommits(supabase, main.id, 30),
        listCapabilitiesForMap(supabase, main.head_commit_id),
        listSystemsForLandscape(supabase, main.head_commit_id),
        listAllElements(supabase, main.head_commit_id),
        listAllSupportsEdges(supabase, main.head_commit_id),
        listAllOwnsEdges(supabase, main.head_commit_id),
        listAllReplacesEdges(supabase, main.head_commit_id),
        listFactStalenessForCommit(supabase, main.head_commit_id),
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
        // F4 (ADR-019 "Amended (F4, ...)"): the standing duplicates report's
        // own open-candidate count — real from here on. `listDuplicateCandidates`
        // itself excludes a pair whose element was merged away or retracted
        // since the last check (that function's own doc comment), so this
        // count never lags a merge the way "next scheduled check" alone would.
        listDuplicateCandidates(supabase, modelId, main.head_commit_id),
        // F11: what open changes retire, and which open projects claim which elements.
        loadElementsRetiredByOpenChanges(supabase, modelId),
        listOpenProjectScopeForModel(supabase, modelId),
      ]);

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
            duplicatesCount: duplicateCandidates.candidates.length,
            systemsWithoutCapability: findSystemsWithoutCapability(systems, supportsEdges, containers),
            platformSupportsThatShouldMoveToModule: findPlatformSupportsThatShouldMoveToModule(systems, supportsEdges, containers),
            flowsToPlatformInsteadOfModule: findFlowsToPlatformInsteadOfModule(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            capabilitiesWithoutOwner: findCapabilitiesWithoutOwner(capabilities, supportsEdges, ownsEdges),
            staleAttributes: computeStaleAttributesFinding(facts, allElements, new Date(), staleAfterMonths),
            staleAfterMonths,
            unlabeledVerbRelationships: findUnlabeledVerbRelationships(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            // Owner-related findings check systems and their own modules
            // together (`findSystemsWithoutTechnicalOwner`'s own doc
            // comment) — a platform's own module can have a distinct
            // owner from the platform itself, so a module missing one is
            // exactly as real a finding as a system missing one.
            systemsWithoutTechnicalOwner: findSystemsWithoutTechnicalOwner([...systems, ...containers], ownsEdges),
            aiAgentsWithoutTechnicalOwner: findAiAgentsActingAloneWithoutTechnicalOwner(systems, ownsEdges),
            criticalSystemsWithoutBusinessOwner: findCriticalSystemsWithoutBusinessOwner([...systems, ...containers], ownsEdges),
            criticalExposedSystems: findCriticalExposedSystems(systems, new Date(), replacedElementIds(replacesEdges)),
            boundaryCrossingsMissingVerb: findBoundaryCrossingsMissingVerb(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            unusedIntegrationPlatforms: findUnusedIntegrationPlatforms(systems, usesAndFlowsToEdges, containers),
            unusedIntegrationInterfaces: findUnusedIntegrationInterfaces(systems, containers, usesAndFlowsToEdges),
            systemsSupportingEssentialFunctionWithoutTechnicalOwner: findSystemsSupportingEssentialFunctionWithoutTechnicalOwner([...systems, ...containers], capabilities, supportsEdges, ownsEdges),
            boundaryCrossingsMissingClassification: findBoundaryCrossingsMissingClassification(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            criticalSystemsPastOrNearSupportEnd: findCriticalSystemsPastOrNearSupportEnd(systems),
            outgoingWithoutRetiringChange: findOutgoingWithoutRetiringChange([...systems, ...containers], retiringElementIds, new Map(systems.map((el) => [el.element_id, el]))),
            projectByElementId: new Map(projectScope.map((scope) => [scope.elementId, scope])),
            externalInterfacesMissingClassification: findExternalInterfacesMissingClassification(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
            externalOrganisationAccess: findExternalOrganisationAccess(usesAndFlowsToEdges, usesAndFlowsToEndpointsById),
          },
        });
      }
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load health findings and recent activity.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load health findings and recent activity' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, userId, afterFirstPaint, staleAfterMonths]);

  return state;
}
