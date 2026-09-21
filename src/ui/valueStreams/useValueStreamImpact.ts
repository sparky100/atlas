import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listAllEnablesEdges, listValueStreamElements } from '../../db/valueStreams';
import { reportError } from '../errors/errorBannerStore';
import { resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { supabase } from '../supabaseClient';
import { valueStreamsReachedFrom, type AffectedValueStream } from './impactTraversal';

export type ValueStreamImpactState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; affected: AffectedValueStream[] };

/**
 * The element page's own "Impact" section (F6/ADR-023, system/container/
 * capability pages): the one shared `impactTraversal.ts` hop, fed
 * `capabilityIds` the caller already resolved its own way (a capability
 * page's own id, alone; a system/container page's own `supports` edges,
 * already loaded by `useElementPage.ts` — see that hook's `relationshipEndpoints`).
 * This hook only fetches the two things the hop itself needs and hasn't
 * already been given — every `value_stream` element and `enables` edge at
 * the selected ref — same branch/main split as `useValueStreams.ts`.
 *
 * `capabilitiesById` supplies the *names* of the reached capabilities
 * themselves (`valueStreamsReachedFrom`'s own `elementsById` — a stage's
 * `viaCapabilities` needs to resolve them) — the caller already has these
 * rows in hand (the element itself, or `relationshipEndpoints`), so this
 * hook never re-fetches a capability.
 */
export function useValueStreamImpact(
  modelId: UUID | null,
  ref: Ref,
  mainCommitIdHint: UUID | null,
  enabled: boolean,
  capabilityIds: readonly UUID[],
  capabilitiesById: ReadonlyMap<UUID, ElementsHeadRow>,
): ValueStreamImpactState {
  const [state, setState] = useState<ValueStreamImpactState>({ status: 'loading' });
  const refParam = refParamOf(ref);
  const capabilityIdsKey = [...capabilityIds].sort().join(',');

  useEffect(() => {
    if (!modelId || !enabled) return undefined;
    if (ref.kind === 'main' && !mainCommitIdHint) return undefined;
    const currentModelId = modelId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let valueStreams: ElementsHeadRow[];
      let enablesEdges: RelationshipsHeadRow[];

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'ready', affected: [] });
          return;
        }
        const resolved = await resolveBranchModeProjectionCached(supabase, currentModelId, branch, 'toBe');
        if (!resolved) {
          if (!cancelled) setState({ status: 'ready', affected: [] });
          return;
        }
        valueStreams = resolved.projection.elementsHead.filter((e) => e.element_type === 'value_stream');
        enablesEdges = resolved.projection.relationshipsHead.filter((r) => r.relationship_type === 'enables');
      } else {
        const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, currentModelId, ref);
        if (!commitId) {
          if (!cancelled) setState({ status: 'ready', affected: [] });
          return;
        }
        [valueStreams, enablesEdges] = await Promise.all([listValueStreamElements(supabase, commitId), listAllEnablesEdges(supabase, commitId)]);
      }

      const elementsById = new Map<UUID, ElementsHeadRow>([...valueStreams.map((e): [UUID, ElementsHeadRow] => [e.element_id, e]), ...capabilitiesById]);
      const affected = valueStreamsReachedFrom(capabilityIds, elementsById, enablesEdges);
      if (!cancelled) setState({ status: 'ready', affected });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load affected value streams.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load affected value streams' });
    });

    return () => {
      cancelled = true;
    };
    // `capabilityIds`/`capabilitiesById` are derived fresh from the caller's
    // own already-loaded data every render and would never compare equal by
    // reference — `capabilityIdsKey` is their real dependency, the same
    // "string form stands in for the object" convention `refParam` above
    // and `useLandscape.ts`'s own `refParam` already use.
  }, [modelId, refParam, mainCommitIdHint, enabled, capabilityIdsKey]);

  return state;
}
