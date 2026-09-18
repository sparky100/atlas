import { useState, useEffect } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow, RelationshipsHeadRow } from '../../contracts/rows';
import { projectionContainersForLandscape, projectionElementById, projectionElementsByIds, projectionFlowsViaElement, projectionRelationshipsForElement, projectionRelationshipsTouchingAny, resolveBranchModeProjection } from '../../db/branchProjection';
import { getElementHead, getElementsByIds, listFlowsViaElement, listRelationshipsForElement } from '../../db/elements';
import type { HeadProjection } from '../../engine/projection';
import { listContainersForLandscape } from '../../db/landscape';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listRelationshipsTouchingAny } from '../../db/structureView';
import { getOrCreateScopedView } from '../../db/views';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import type { ViewRow } from '../../db/types';
import { computeContextGroup, computePlatformConnections, type ContextGroup, type PlatformConnection } from './contextGrouping';
import { buildPlatformModulesById, type ContextModule } from './contextDiagramData';
import { isIntegrationPlatform, isPlatform } from '../elements/systemKind';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

/**
 * V3's own "platform context simplified to structure only": a platform with
 * at least one module renders as its module grid alone — no neighbours, no
 * drawn edges, no labels (item 2's whole point: the multi-module,
 * multi-neighbour crowding problem is removed by never putting both on one
 * diagram again). `connections` is the structure page's own plain-text
 * escape hatch for a genuine direct edge on the platform itself (rare, see
 * `computePlatformConnections`'s own comment) — a real fact, never a canvas
 * node.
 */
export interface PlatformStructureData {
  kind: 'platform-structure';
  commitId: UUID;
  view: ViewRow;
  hub: ElementsHeadRow;
  modules: ContextModule[];
  connections: PlatformConnection[];
  diff: VersionDiff | null;
}

/**
 * The ordinary Context view (UI-principles §6.1): a plain system, a
 * container (V3: now a hub in its own right, item 1), or a platform with
 * zero modules — its own direct neighbours only, since a platform's modules
 * are never grouped onto the same diagram as neighbours any more.
 */
export interface ElementGroupData {
  kind: 'group';
  commitId: UUID;
  view: ViewRow;
  group: ContextGroup;
  diff: VersionDiff | null;
}

/**
 * Integration platform context: a `kind: 'integration_platform'` system
 * hub — its own direct neighbours are never the point (rare in practice,
 * per `computePlatformConnections`'s own comment on the sibling
 * "platforms and modules" concept); what matters is every `uses`/
 * `flows_to` edge elsewhere in the model naming this element as its
 * `via`. Reuses the exact same query the element page's own "Flows via
 * this platform" section already runs (`listFlowsViaElement`/
 * `projectionFlowsViaElement`) rather than a second definition of "what
 * counts as a flow via this platform."
 */
export interface IntegrationPlatformContextData {
  kind: 'integration-platform';
  commitId: UUID;
  view: ViewRow;
  hub: ElementsHeadRow;
  flows: RelationshipsHeadRow[];
  /** Every flow's own `from`/`to` endpoint, by id — never the hub itself, which is only ever the `via`, not an endpoint, of these edges (same as `ElementPageData.flowsViaThisPlatformEndpoints`'s own doc comment). */
  endpoints: Map<UUID, ElementsHeadRow>;
}

export type ElementContextData = PlatformStructureData | IntegrationPlatformContextData | ElementGroupData;

export type ElementContextState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  /** The ref resolved, but `elementId` isn't a System or Container there (retracted, wrong id, or an actor/capability, S1's "not present at this ref") — not a 404. */
  | { status: 'notPresentAtRef' }
  | { status: 'ready'; data: ElementContextData };

/**
 * Loads the Context view for a system or container (UI-principles §6.1;
 * V3 item 1 extends it from systems-only to any container too, since a
 * container is now structurally terminal — the "component" element type's
 * removal left containers with no further descend link of their own, so a
 * container's own neighbours need somewhere to live). A platform with at
 * least one module takes the separate `PlatformStructureData` branch
 * instead (V3 item 2) — see that interface's own comment.
 *
 * Sprint C1: a branch ref folds via src/db/branchProjection.ts instead of
 * querying `elements_head`/`relationships_head` — same reasoning as
 * useLandscape.ts's own Sprint C1 note.
 */
export function useElementContext(modelId: UUID, orgId: UUID, userId: UUID | null, elementId: UUID, ref: Ref, mode: ViewMode): ElementContextState {
  const [state, setState] = useState<ElementContextState>({ status: 'loading' });
  const refParam = refParamOf(ref);

  useEffect(() => {
    // S1 item 15: guard on `modelId`/`elementId` too, not just `userId` —
    // same fix as `useBreadcrumbElement.ts`'s own precedent for this exact
    // shape (a caller's `model?.id ?? ''` fires this effect once before its
    // own model resolves; left unguarded, `reportError`'s new catch-all
    // here would otherwise post a banner that outlives the load that
    // follows it).
    if (!userId || !modelId || !elementId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let branchId: UUID | null = null;
      let diff: VersionDiff | null = null;
      let hub;
      let hubRelationships;
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
        hub = projectionElementById(resolved.projection, elementId);
        if (hub?.element_type !== 'system' && hub?.element_type !== 'container') {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        hubRelationships = projectionRelationshipsForElement(resolved.projection, elementId);
      } else {
        const resolvedCommitId = await resolveRef(supabase, modelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        projection = null;
        hub = await getElementHead(supabase, commitId, elementId);
        if (hub?.element_type !== 'system' && hub?.element_type !== 'container') {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        hubRelationships = await listRelationshipsForElement(supabase, commitId, elementId);
      }

      const view = await getOrCreateScopedView(supabase, { id: crypto.randomUUID(), orgId, modelId, kind: 'context', name: `Context: ${hub.name}`, scopeElementId: elementId, createdBy: currentUserId, branchId });

      // V3 item 2: a platform with at least one module takes the
      // structure-only branch instead of the ordinary neighbour diagram —
      // checked before anything else is gathered, since that branch never
      // needs `hub`'s own neighbours at all (only its own direct edges, for
      // "Platform-level connections").
      if (isPlatform(hub)) {
        const hubContainers = projection ? projectionContainersForLandscape(projection) : await listContainersForLandscape(supabase, commitId);
        const moduleContainers = hubContainers.filter((c) => c.parent_id === elementId);
        if (moduleContainers.length > 0) {
          const moduleIds = moduleContainers.map((c) => c.element_id);
          const supportsEdges = projection ? projectionRelationshipsTouchingAny(projection, moduleIds, ['supports']) : await listRelationshipsTouchingAny(supabase, commitId, moduleIds, ['supports']);
          const capabilityIds = [...new Set(supportsEdges.map((e) => e.to_element_id))];
          const capabilitiesById = projection ? projectionElementsByIds(projection, capabilityIds) : await getElementsByIds(supabase, commitId, capabilityIds);
          const modules = buildPlatformModulesById([hub], hubContainers, supportsEdges, capabilitiesById).get(elementId) ?? [];

          const ownEdges = hubRelationships.filter((r) => r.relationship_type === 'uses' || r.relationship_type === 'flows_to');
          const otherIds = [...new Set(ownEdges.flatMap((r) => [r.from_element_id, r.to_element_id]))].filter((id) => id !== elementId);
          const elementsById = projection ? projectionElementsByIds(projection, otherIds) : await getElementsByIds(supabase, commitId, otherIds);
          const connections = computePlatformConnections(hub, ownEdges, elementsById);

          if (!cancelled) setState({ status: 'ready', data: { kind: 'platform-structure', commitId, view, hub, modules, connections, diff } });
          return;
        }
      }

      // Integration platform context: a `kind: 'integration_platform'`
      // hub's own direct neighbours are never the point (this branch never
      // even reaches `computeContextGroup`) — what matters is every
      // `uses`/`flows_to` edge elsewhere in the model naming this element
      // as its `via`, the same query `PlatformFlowsSection`'s own element-
      // page data already runs.
      if (hub.element_type === 'system' && isIntegrationPlatform(hub)) {
        const flows = projection ? projectionFlowsViaElement(projection, elementId) : await listFlowsViaElement(supabase, commitId, elementId);
        const endpointIds = [...new Set(flows.flatMap((f) => [f.from_element_id, f.to_element_id]))];
        const endpoints = projection ? projectionElementsByIds(projection, endpointIds) : await getElementsByIds(supabase, commitId, endpointIds);
        if (!cancelled) setState({ status: 'ready', data: { kind: 'integration-platform', commitId, view, hub, flows, endpoints } });
        return;
      }

      // Every relationship type (`RELATIONSHIP_TYPES`) is one `computeContextGroup` itself already classifies — no further filtering needed here.
      const otherIds = [...new Set(hubRelationships.flatMap((r) => [r.from_element_id, r.to_element_id]))].filter((id) => id !== elementId);
      const elementsById = projection ? projectionElementsByIds(projection, otherIds) : await getElementsByIds(supabase, commitId, otherIds);
      const group = computeContextGroup(hub, hubRelationships, elementsById);

      if (!cancelled) setState({ status: 'ready', data: { kind: 'group', commitId, view, group, diff } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load this context.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this context' });
    });

    return () => {
      cancelled = true;
    };
    // Same `refParam` pitfall/fix as every other view hook here.
  }, [modelId, orgId, userId, elementId, refParam, mode]);

  return state;
}
