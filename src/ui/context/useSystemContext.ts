import { useState, useEffect } from 'react';
import type { UUID } from '../../contracts/delta';
import { projectionContainersForLandscape, projectionElementById, projectionElementsByIds, projectionRelationshipsForElement, projectionRelationshipsTouchingAny, resolveBranchModeProjection } from '../../db/branchProjection';
import { getElementHead, getElementsByIds, listRelationshipsForElement } from '../../db/elements';
import type { HeadProjection } from '../../engine/projection';
import { listContainersForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listRelationshipsTouchingAny } from '../../db/structureView';
import { getOrCreateScopedView } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import { computeContextGroup, type ContextGroup } from './contextGrouping';
import { buildPlatformModulesById, type ContextModule } from './contextDiagramData';
import { isPlatform } from '../elements/systemKind';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface SystemContextData {
  commitId: UUID;
  view: ViewRow;
  group: ContextGroup;
  /** V1's own context diagram: every candidate platform (the hub, or any internal/external neighbour) that has at least one module, mapped to its own modules — `contextDiagramData.ts`'s own doc comment explains the shape. Absent for a plain (no platform anywhere in view) context, same as that function's own "nothing to show" convention. */
  platformModulesById: Map<UUID, ContextModule[]>;
  /** Populated only when `ref` is a branch and `mode === 'diff'` (UI-principles §6.2/§6.3). */
  diff: VersionDiff | null;
}

export type SystemContextState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  /** The ref resolved, but `systemId` isn't a System there (retracted, wrong id, or not a System at all) — §2.4's "not present at this ref", not a 404. */
  | { status: 'notPresentAtRef' }
  | { status: 'ready'; data: SystemContextData };

/**
 * Loads the Context view (UI-principles §6.1): the given system, every
 * system/actor it has a relationship with, grouped by
 * src/ui/context/contextGrouping.ts. No `view_layouts` — like the
 * capability map (and for the same reason: DOM/CSS grouping, not pixel
 * placement — see ContextView.tsx's module comment), there is no computed
 * position to persist or reset.
 *
 * Sprint C1: a branch ref folds via src/db/branchProjection.ts instead of
 * querying `elements_head`/`relationships_head` — same reasoning as
 * useLandscape.ts's own Sprint C1 note.
 */
export function useSystemContext(modelId: UUID, orgId: UUID, userId: UUID | null, systemId: UUID, ref: Ref, mode: ViewMode): SystemContextState {
  const [state, setState] = useState<SystemContextState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    // S1 item 15: guard on `modelId`/`systemId` too, not just `userId` —
    // same fix as `useBreadcrumbElement.ts`'s own precedent for this exact
    // shape (a caller's `model?.id ?? ''` fires this effect once before its
    // own model resolves; left unguarded, `reportError`'s new catch-all
    // here would otherwise post a banner that outlives the load that
    // follows it).
    if (!userId || !modelId || !systemId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let branchId: UUID | null = null;
      let diff: VersionDiff | null = null;
      let hub;
      let ownHubRelationships;
      let projection: HeadProjection | null;

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjection(supabase, modelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        branchId = branch.id;
        diff = resolved.diff;
        projection = resolved.projection;
        hub = projectionElementById(resolved.projection, systemId);
        if (hub?.element_type !== 'system') {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        ownHubRelationships = projectionRelationshipsForElement(resolved.projection, systemId);
      } else {
        const resolvedCommitId = await resolveRef(supabase, modelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        projection = null;
        hub = await getElementHead(supabase, commitId, systemId);
        if (hub?.element_type !== 'system') {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        ownHubRelationships = await listRelationshipsForElement(supabase, commitId, systemId);
      }

      // V1: a platform hub's own modules (Containers whose `parent_id` is
      // the hub) — needed *before* relationships are gathered, since a
      // `uses`/`flows_to` edge can now attach to a specific module directly
      // rather than the platform itself (S1 item 20's own
      // container↔system rules), and that edge never touches `systemId` as
      // either endpoint at all. Scoped to the hub only, deliberately not
      // extended to a platform *neighbour* too — nesting a neighbour's own
      // modules risks the same module showing up twice (once nested,
      // once as its own flat neighbour tile reached by a real edge of its
      // own) with no clean way to pick one; the hub is the one place this
      // view's own "tile contains its module tiles" unambiguously applies,
      // and the V1 prompt's own named scenario (SAP as the hub) needs
      // nothing more than that.
      let hubModuleIds = new Set<UUID>();
      let hubContainers: ReturnType<typeof projectionContainersForLandscape> = [];
      if (isPlatform(hub)) {
        hubContainers = projection ? projectionContainersForLandscape(projection) : await listContainersForLandscape(supabase, commitId);
        hubModuleIds = new Set(hubContainers.filter((c) => c.parent_id === systemId).map((c) => c.element_id));
      }

      const ownHubUsesFlowsEdges = ownHubRelationships.filter((r) => r.relationship_type === 'uses' || r.relationship_type === 'flows_to');
      const ownHubOwnsSupportsEdges = ownHubRelationships.filter((r) => r.relationship_type === 'owns' || r.relationship_type === 'supports');
      const moduleUsesFlowsEdges =
        hubModuleIds.size === 0
          ? []
          : projection
            ? projectionRelationshipsTouchingAny(projection, [...hubModuleIds], ['uses', 'flows_to'])
            : await listRelationshipsTouchingAny(supabase, commitId, [...hubModuleIds], ['uses', 'flows_to']);
      // A module-attached edge whose *other* end happens to be the hub
      // itself (shouldn't occur — a platform's own module reaching its own
      // parent isn't a real relationship this product models — but
      // deduplicated defensively rather than assumed away) would otherwise
      // double-count against `ownHubUsesFlowsEdges` above.
      const seenRelationshipIds = new Set(ownHubUsesFlowsEdges.map((r) => r.relationship_id));
      const relationships = [...ownHubUsesFlowsEdges, ...ownHubOwnsSupportsEdges, ...moduleUsesFlowsEdges.filter((r) => !seenRelationshipIds.has(r.relationship_id))];

      const otherIds = [...new Set(relationships.flatMap((r) => [r.from_element_id, r.to_element_id]))].filter((id) => id !== systemId && !hubModuleIds.has(id));
      const elementsById = projection ? projectionElementsByIds(projection, otherIds) : await getElementsByIds(supabase, commitId, otherIds);

      const view = await getOrCreateScopedView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'context', name: `Context: ${hub.name}`, scopeElementId: systemId, createdBy: currentUserId, branchId });
      const group = computeContextGroup(hub, relationships, elementsById, hubModuleIds);

      let platformModulesById = new Map<UUID, ContextModule[]>();
      if (hubModuleIds.size > 0) {
        const moduleIds = [...hubModuleIds];
        const supportsEdges = projection ? projectionRelationshipsTouchingAny(projection, moduleIds, ['supports']) : await listRelationshipsTouchingAny(supabase, commitId, moduleIds, ['supports']);
        const capabilityIds = [...new Set(supportsEdges.map((e) => e.to_element_id))];
        const capabilitiesById = projection ? projectionElementsByIds(projection, capabilityIds) : await getElementsByIds(supabase, commitId, capabilityIds);
        platformModulesById = buildPlatformModulesById([hub], hubContainers, supportsEdges, capabilitiesById);
      }

      if (!cancelled) setState({ status: 'ready', data: { commitId, view, group, platformModulesById, diff } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load this system's context.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this system’s context' });
    });

    return () => {
      cancelled = true;
    };
    // Same `refParam` pitfall/fix as every other view hook here.
  }, [modelId, orgId, userId, systemId, refParam, mode]);

  return state;
}
