import { useEffect, useState } from 'react';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import type { UUID } from '../../contracts/delta';
import { listSupportsEdgesForCapabilities, listCapabilitiesForMap } from '../../db/capabilityMap';
import { getElementsByIds } from '../../db/elements';
import { refParamOf, resolveRef, type Ref } from '../../db/ref';
import { getOrCreateModelView } from '../../db/views';
import type { ViewRow } from '../../db/types';
import { computeCapabilityMapTree, type CapabilityMapTree } from './layout';
import { supabase } from '../supabaseClient';

export interface CapabilityMapData {
  commitId: UUID;
  view: ViewRow;
  tree: CapabilityMapTree;
  supportsEdges: RelationshipsHeadRow[];
  systemsById: Map<UUID, ElementsHeadRow>;
}

export type CapabilityMapState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: CapabilityMapData };

export interface UseCapabilityMapResult {
  state: CapabilityMapState;
  /** Re-fetches everything at the current ref — used after a successful import/add (Sprint U2 step 2), same purpose as useElementPage.ts's `reload`. */
  reload: () => void;
}

/**
 * Loads the capability map's data (UI-principles §6.1, §3.1). Unlike the
 * landscape (src/ui/landscape/useLandscape.ts), this never reads or writes
 * `view_layouts`: the map is plain DOM/CSS (src/ui/capabilityMap/layout.ts's
 * module comment explains why), so there is no manual position to persist
 * — ADR-011's litmus test is trivially satisfied by never writing a row in
 * the first place. `getOrCreateModelView` still records the `views` row
 * itself ("a view is a saved query", ADR-011), which is what a future
 * feature (per-user expand state, annotations) would hang off later.
 */
export function useCapabilityMap(modelId: UUID, orgId: UUID, userId: UUID | null, ref: Ref): UseCapabilityMapResult {
  const [state, setState] = useState<CapabilityMapState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!userId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      const commitId = await resolveRef(supabase, modelId, ref);
      if (!commitId) {
        if (!cancelled) setState({ status: 'refNotFound' });
        return;
      }

      const capabilities = await listCapabilitiesForMap(supabase, commitId);
      const capabilityIds = capabilities.map((c) => c.element_id);
      const supportsEdges = await listSupportsEdgesForCapabilities(supabase, commitId, capabilityIds);
      const systemIds = [...new Set(supportsEdges.map((edge) => edge.from_element_id))];
      const systemsById = await getElementsByIds(supabase, commitId, systemIds);

      const view = await getOrCreateModelView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'capability_map', name: 'Capability map', createdBy: currentUserId });
      const tree = computeCapabilityMapTree(capabilities);

      if (!cancelled) setState({ status: 'ready', data: { commitId, view, tree, supportsEdges, systemsById } });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the capability map' });
    });

    return () => {
      cancelled = true;
    };
    // Same pitfall/fix as useElementPage.ts / useLandscape.ts: `refParam`
    // (a stable string) is the real dependency, not `ref` itself.
  }, [modelId, orgId, userId, refParam, reloadToken]);

  return {
    state,
    reload: () => {
      setReloadToken((t) => t + 1);
    },
  };
}
