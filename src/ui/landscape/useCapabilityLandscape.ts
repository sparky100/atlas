import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { projectionActorsForLandscape, projectionElementsByIds, projectionLandscapeEdges, resolveBranchModeProjection } from '../../db/branchProjection';
import { listSupportsEdgesForCapabilities, listCapabilitiesForMap } from '../../db/capabilityMap';
import { ownersByElementIdFromOwnsEdges, listOwnsEdges } from '../../db/elementBrowse';
import { getElementsByIds } from '../../db/elements';
import { listActorsForLandscape, listLandscapeEdges } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import type { ViewMode } from '../../db/viewMode';
import { capabilitySubtreeIds, computeCapabilityLandscapeRows, type CapabilityLandscapeRows } from './capabilityLandscapeRows';
import { withModuleLabels } from './landscapeModules';
import { supabase } from '../supabaseClient';

export type CapabilityLandscapeState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'refNotFound' } | { status: 'ready'; data: CapabilityLandscapeRows };

export interface UseCapabilityLandscapeResult {
  state: CapabilityLandscapeState;
}

/**
 * Sprint U4-2c item 2's own data: `/landscape?capability=X` (`capabilityId`
 * here is never null — `LandscapePage.tsx` only renders the component this
 * feeds while it's set, same "gate at the call site, not inside the hook"
 * shape `useElementPage.ts`'s own required-id hooks already use elsewhere).
 * Rolled up through X's own descendant capabilities (never just the exact
 * match the capability map tile's own count uses) — see
 * `capabilityLandscapeRows.ts`'s own module comment.
 *
 * Mirrors `useLandscape.ts`'s main/tag-vs-branch split (SPEC §1 S-2: a
 * change branch's head is never materialised) but is otherwise a
 * completely separate load: no layout, no worker, no `views` bookkeeping —
 * this is a flat list, not a diagram, so ADR-011/CLAUDE.md rule 2's
 * "no hand-drawn diagrams, every view is a query plus a layout algorithm"
 * rule has nothing to govern here (there are no positions at all, the same
 * reason `LandscapeMobileList`/`ElementBrowseTable` never touch `views`
 * either).
 */
export function useCapabilityLandscape(
  modelId: UUID | null,
  ref: Ref,
  mode: ViewMode,
  capabilityId: UUID | null,
  /** See `useLandscape.ts`'s identical parameter's own doc comment — the caller's already-resolved `main` head, so a `main` ref here never re-resolves it a second time. */
  mainCommitIdHint: UUID | null = null,
): UseCapabilityLandscapeResult {
  const [state, setState] = useState<CapabilityLandscapeState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    if (!modelId || !capabilityId) return undefined;
    if (ref.kind === 'main' && !mainCommitIdHint) return undefined;
    const currentModelId = modelId;
    const currentCapabilityId = capabilityId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let capabilities: ElementsHeadRow[];
      let subtreeSupportsEdges: RelationshipsHeadRow[];
      let elementsByIds: (ids: readonly UUID[]) => Promise<Map<UUID, ElementsHeadRow>>;
      let landscapeEdges: RelationshipsHeadRow[];
      let ownersByElementId: Map<UUID, ElementsHeadRow>;

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjection(supabase, currentModelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const { projection } = resolved;
        capabilities = projection.elementsHead.filter((e) => e.element_type === 'capability');
        const subtreeIds = capabilitySubtreeIds(currentCapabilityId, capabilities);
        subtreeSupportsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'supports' && subtreeIds.has(r.to_element_id));
        elementsByIds = (ids) => Promise.resolve(projectionElementsByIds(projection, ids));
        const systemIds = [...new Set(subtreeSupportsEdges.map((e) => e.from_element_id))];
        landscapeEdges = projectionLandscapeEdges(projection, systemIds);
        const actorsById = new Map(projectionActorsForLandscape(projection).map((a) => [a.element_id, a]));
        const systemIdSet = new Set(systemIds);
        const ownsEdges = projection.relationshipsHead.filter((r) => r.relationship_type === 'owns' && systemIdSet.has(r.to_element_id));
        ownersByElementId = ownersByElementIdFromOwnsEdges(ownsEdges, actorsById);
      } else {
        const commitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, currentModelId, ref);
        if (!commitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        capabilities = await listCapabilitiesForMap(supabase, commitId);
        const subtreeIds = capabilitySubtreeIds(currentCapabilityId, capabilities);
        subtreeSupportsEdges = await listSupportsEdgesForCapabilities(supabase, commitId, [...subtreeIds]);
        elementsByIds = (ids) => getElementsByIds(supabase, commitId, ids);
        const systemIds = [...new Set(subtreeSupportsEdges.map((e) => e.from_element_id))];
        const [edges, allOwnsEdges, allActors] = await Promise.all([listLandscapeEdges(supabase, commitId, systemIds), listOwnsEdges(supabase, commitId), listActorsForLandscape(supabase, commitId)]);
        landscapeEdges = edges;
        const actorsById = new Map(allActors.map((a) => [a.element_id, a]));
        const systemIdSet = new Set(systemIds);
        ownersByElementId = ownersByElementIdFromOwnsEdges(
          allOwnsEdges.filter((r) => systemIdSet.has(r.to_element_id)),
          actorsById,
        );
      }

      const systemIds = [...new Set(subtreeSupportsEdges.map((e) => e.from_element_id))];
      const rawSystemsById = await elementsByIds(systemIds);
      // "Platforms and modules": a module (Container) among the resolved
      // systems needs its own parent (the platform) resolved too, purely to
      // decide its display label (`withModuleLabels`) — bounded by however
      // many modules are actually in scope here, never the model's whole
      // container set (unlike `useLandscape.ts`, which already has every
      // container loaded for the full canvas).
      const parentIds = [...new Set([...rawSystemsById.values()].filter((e): e is ElementsHeadRow & { parent_id: UUID } => e.element_type === 'container' && e.parent_id !== null).map((e) => e.parent_id))];
      const parentsById = parentIds.length > 0 ? await elementsByIds(parentIds) : new Map<UUID, ElementsHeadRow>();
      const systemsById = new Map(withModuleLabels([...rawSystemsById.values()], parentsById).map((s) => [s.element_id, s]));
      const capabilitiesById = new Map(capabilities.map((c) => [c.element_id, c]));

      const rows = computeCapabilityLandscapeRows(currentCapabilityId, subtreeSupportsEdges, systemsById, capabilitiesById, landscapeEdges, ownersByElementId);
      if (!cancelled) setState({ status: 'ready', data: rows });
    }

    load().catch((e: unknown) => {
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the capability landscape' });
    });

    return () => {
      cancelled = true;
    };
    // `ref`'s string form (`refParam`) is the real dependency, same pitfall/fix as useLandscape.ts.
  }, [modelId, refParam, mode, capabilityId, mainCommitIdHint]);

  return { state };
}
