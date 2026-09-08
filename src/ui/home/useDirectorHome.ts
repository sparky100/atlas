import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { listChangeBranches } from '../../db/branches';
import { listCapabilitiesForMap } from '../../db/capabilityMap';
import { listSystemsForLandscape } from '../../db/landscape';
import { computeExposureTone, listAllSupportsEdges, loadModelCounts, type ExposureTone, type ModelCounts } from '../../db/modelHome';
import { listTagsForModel } from '../../db/tags';
import type { BranchRow, TagRow } from '../../db/types';
import { resolveRef } from '../../db/ref';
import { computeCapabilityMapTree, type CapabilityMapTree } from '../capabilityMap/layout';
import { supabase } from '../supabaseClient';

export interface ChangesByStatus {
  status: BranchRow['status'];
  branches: BranchRow[];
}

export interface DirectorHomeData {
  tree: CapabilityMapTree;
  exposureTone: ExposureTone;
  counts: ModelCounts;
  changesInFlight: ChangesByStatus[];
  recentVersions: TagRow[];
}

export type DirectorHomeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DirectorHomeData };

// UI-principles §3.1's "changes in flight" list is `proposed | in_review |
// approved`; `draft` work isn't proposed yet, so it's excluded here even
// though loadModelCounts's own openChanges count includes it (that count
// answers a different question — "how much is in motion at all", not "what
// would a director recognise as a change already underway").
const IN_FLIGHT_STATUSES: BranchRow['status'][] = ['proposed', 'in_review', 'approved'];

/**
 * The director door's data (Sprint U3b, scoped down from UI-principles
 * §3.1 — see src/db/modelHome.ts's own module comment for exactly what's
 * deferred). Always reads `main` — the director's door has no branch
 * selector (§3.1: "no sidebar, no branch selector, no editing affordance").
 */
export function useDirectorHome(modelId: UUID, orgId: UUID): DirectorHomeState {
  const [state, setState] = useState<DirectorHomeState>({ status: 'loading' });

  useEffect(() => {
    if (!modelId) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, { kind: 'main' });
      if (!commitId) {
        // ADR-018: a real model's main always has a head. An empty tree
        // (no capabilities yet) is `ready` with zero tiles, not this.
        if (!cancelled) setState({ status: 'error', message: 'This model has no commits yet.' });
        return;
      }

      const [capabilities, supportsEdges, systems, counts, changeBranches, tags] = await Promise.all([
        listCapabilitiesForMap(supabase, commitId),
        listAllSupportsEdges(supabase, commitId),
        listSystemsForLandscape(supabase, commitId),
        loadModelCounts(supabase, commitId, modelId),
        listChangeBranches(supabase, modelId),
        listTagsForModel(supabase, modelId),
      ]);

      const systemsById = new Map<UUID, ElementsHeadRow>(systems.map((s) => [s.element_id, s]));
      const tree = computeCapabilityMapTree(capabilities);
      const exposureTone = computeExposureTone(supportsEdges, systemsById);
      const changesInFlight = IN_FLIGHT_STATUSES.map((status) => ({ status, branches: changeBranches.filter((b) => b.status === status) })).filter(
        (group) => group.branches.length > 0,
      );
      const recentVersions = [...tags].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);

      if (!cancelled) setState({ status: 'ready', data: { tree, exposureTone, counts, changesInFlight, recentVersions } });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the director view' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, orgId]);

  return state;
}
