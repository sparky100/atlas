import { useEffect, useState } from 'react';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { listSupportsEdgesForCapabilities } from '../../db/capabilityMap';
import { listChangeBranches, getMainBranch } from '../../db/branches';
import { buildCommitLoader } from '../../db/commitLoader';
import { listAllElements, listOwnsEdges } from '../../db/elementBrowse';
import { getElementsByIds } from '../../db/elements';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import type { BranchRow } from '../../db/types';
import { loadMainCommittedRoadmapEventsForModel, loadRoadmapChangeEventsForModel, type RoadmapBranchEvents } from '../../db/roadmapChangeEvents';
import { listAllEnablesEdges } from '../../db/valueStreams';
import { reportError } from '../errors/errorBannerStore';
import { isRoadmapEligibleBranch } from './roadmapEligibility';
import { groupBarsByValueStream, groupRoadmapLifecycleBars, type RoadmapGroup } from './roadmapLifecycleRows';
import { systemsAndModulesFor } from './roadmapModules';
import { supabase } from '../supabaseClient';

export interface RoadmapData {
  commitId: UUID;
  groups: RoadmapGroup[];
  /** F6 Step 6: the same bars grouped by value stream instead of capability (`groupBarsByValueStream`) — computed alongside `groups` so switching `?groupBy=` never refetches. */
  valueStreamGroups: RoadmapGroup[];
  /**
   * Every change branch eligible under *either* as-is or to-be
   * (`isRoadmapEligibleBranch`'s own to-be superset — merged, or still
   * open with a stated date) — computed once regardless of the current
   * mode, so switching as-is/to-be never refetches; `RoadmapView` filters
   * this down to the current mode's own subset at render time.
   */
  branchEvents: RoadmapBranchEvents[];
  /** Every capability in scope, keyed by id — the capability filter facet's own labels (`RoadmapGroup` already carries the label for a real group, but `UNASSIGNED_GROUP_KEY` has none). */
  capabilitiesById: Map<UUID, ElementsHeadRow>;
  /** Every actor referenced as an `owns` edge's own `from` — the owner filter facet's own labels. */
  ownerActorsById: Map<UUID, ElementsHeadRow>;
}

export type RoadmapState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: RoadmapData };

export interface UseRoadmapResult {
  state: RoadmapState;
  reload: () => void;
}

/**
 * F5's own data (docs/prompts/atlas-prompt-pack.md) — same "query the
 * model scope once, filter client-side" shape `useCapabilityMap.ts`/
 * `elementBrowse.ts` already establish (CLAUDE.md rule 8), not a
 * per-filter or per-mode refetch. `groupRoadmapLifecycleBars` runs
 * unfiltered here; `RoadmapView` applies `matchesRoadmapFilters` and the
 * as-is/to-be mode at render time, the same split `useLandscapeDisplay.ts`
 * already draws between "what's loaded" and "what's currently shown."
 */
export function useRoadmap(
  modelId: UUID,
  orgId: UUID,
  userId: UUID | null,
  ref: Ref,
  /** F6 Step 6: slugs, only to build each `RoadmapGroup`'s element-page `href` — the grouping functions produce a link the roadmap page itself (which owns the slugs) renders. */
  orgSlug: string,
  modelSlug: string,
  mainCommitIdHint: UUID | null = null,
): UseRoadmapResult {
  const [state, setState] = useState<RoadmapState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!userId || !modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const allElements = await listAllElements(supabase, commitId);
      const systemsAndModules = systemsAndModulesFor(allElements);
      const capabilities = allElements.filter((e) => e.element_type === 'capability');
      const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));
      const capabilityIds = capabilities.map((c) => c.element_id);
      const valueStreamsById = new Map(allElements.filter((e) => e.element_type === 'value_stream').map((e) => [e.element_id, e]));

      const [supportsEdges, ownsEdges, changeBranches, enablesEdges, mainBranch] = await Promise.all([listSupportsEdgesForCapabilities(supabase, commitId, capabilityIds), listOwnsEdges(supabase, commitId), listChangeBranches(supabase, modelId), listAllEnablesEdges(supabase, commitId), getMainBranch(supabase, modelId)]);

      const elementHref = (id: UUID): string => `/o/${orgSlug}/m/${modelSlug}/e/${id}`;
      const groups = groupRoadmapLifecycleBars(systemsAndModules, supportsEdges, ownsEdges, capabilitiesById, elementHref);
      const valueStreamGroups = groupBarsByValueStream(systemsAndModules, supportsEdges, ownsEdges, capabilitiesById, valueStreamsById, enablesEdges, elementHref);

      const ownerActorIds = [...new Set(ownsEdges.map((edge) => edge.from_element_id))];
      const ownerActorsById = ownerActorIds.length > 0 ? await getElementsByIds(supabase, commitId, ownerActorIds) : new Map<UUID, ElementsHeadRow>();

      const eligibleBranches = changeBranches.filter((branch): branch is BranchRow => isRoadmapEligibleBranch(branch, 'toBe'));
      // One loader shared by both event sources so the roadmap's two derivations never load the model twice (`loadRoadmapChangeEventsForModel`'s sharedLoader).
      const commitLoader = await buildCommitLoader(supabase, modelId);
      const branchEvents = await loadRoadmapChangeEventsForModel(supabase, modelId, eligibleBranches, commitLoader);
      // Lifecycle facts committed straight onto main (no change branch, so the
      // branch path above would never see them) — derived from main's own
      // commits and dated at each element's own plannedEnd
      // (`deriveMainCommittedChangeEvents`), one pseudo-branch per event.
      const mainCommittedEvents = mainBranch ? await loadMainCommittedRoadmapEventsForModel(supabase, modelId, mainBranch, branchEvents, commitLoader) : [];
      const allBranchEvents = [...branchEvents, ...mainCommittedEvents];

      if (!cancelled) setState({ status: 'ready', data: { commitId, groups, valueStreamGroups, branchEvents: allBranchEvents, capabilitiesById, ownerActorsById } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load the roadmap.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the roadmap' });
    });

    return () => {
      cancelled = true;
    };
    // `refParam` (a stable string), not `ref` itself — same pitfall/fix as useCapabilityMap.ts/useLandscape.ts.
  }, [modelId, orgId, userId, refParam, reloadToken, mainCommitIdHint, orgSlug, modelSlug]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
