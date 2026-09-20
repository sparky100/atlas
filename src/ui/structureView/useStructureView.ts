import { useEffect, useState } from 'react';
import type { ElementType, RelationshipType, UUID } from '../../contracts/delta';
import { projectionChildrenOf, projectionElementById, projectionElementsByIds, projectionRelationshipsTouchingAny } from '../../db/branchProjection';
import { getElementHead, getElementsByIds, listChildrenOf } from '../../db/elements';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listRelationshipsTouchingAny } from '../../db/structureView';
import { getOrCreateScopedView } from '../../db/views';
import type { ViewKind, ViewRow } from '../../db/types';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import { resolveBranchModeProjectionCached } from '../query/cachedBranchProjection';
import { computeStructureGroup, type StructureGroup } from './structureGrouping';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface StructureViewData {
  commitId: UUID;
  view: ViewRow;
  group: StructureGroup;
  /** Populated only when `ref` is a branch and `mode === 'diff'` (UI-principles §6.2/§6.3). */
  diff: VersionDiff | null;
}

export type StructureViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'refNotFound' }
  /** `parentId` isn't the right element type at this ref (retracted, wrong id, or not a Container view request against a real Container et al.) — §2.4's "not present at this ref", not a 404. */
  | { status: 'notPresentAtRef' }
  | { status: 'ready'; data: StructureViewData };

interface StructureViewKindConfig {
  viewKind: ViewKind;
  parentType: ElementType;
  relationshipTypes: readonly RelationshipType[];
  viewNamePrefix: string;
}

/**
 * S1 item 18: this used to be a `kind`-parameterised config shared with a
 * Component view one level deeper (UI-principles §6.1: "one
 * [system|container], its [containers|components], plus external
 * [systems/containers|containers] they `uses`[/`flows_to`]") — the
 * component level is gone from the taxonomy entirely now, so Container is
 * this hook's only shape and the config collapses to a single constant
 * rather than a `Record` keyed by a union with one member left.
 */
const CONFIG: StructureViewKindConfig = { viewKind: 'container', parentType: 'system', relationshipTypes: ['uses', 'flows_to'], viewNamePrefix: 'Containers' };

/**
 * Loads the Container view. No `view_layouts` — same reason as
 * useElementContext.ts: DOM/CSS grouping, no pixel position to persist.
 *
 * Sprint C1: a branch ref folds via src/db/branchProjection.ts instead of
 * querying `elements_head`/`relationships_head` — same reasoning as
 * useLandscape.ts's own Sprint C1 note.
 */
export function useStructureView(
  modelId: UUID,
  orgId: UUID,
  userId: UUID | null,
  parentId: UUID,
  ref: Ref,
  mode: ViewMode,
  /**
   * S1 item 15 (A2 remainder): the caller's own already-resolved main
   * head commit id (`useMainBranch`), same dedup shape `useLandscape.ts`/
   * `useCapabilityLandscape.ts` already use — skips this hook's own
   * `resolveRef` round trip for a `main` ref when the caller has one in
   * hand. Race-tolerant, not blocking (unlike `useLandscape.ts`'s own
   * "wait for it" choice): a `main` ref still loads via `resolveRef`
   * exactly as before whenever the hint is momentarily absent, so a
   * caller that doesn't pass one yet never stalls.
   */
  mainCommitIdHint: UUID | null = null,
): StructureViewState {
  const [state, setState] = useState<StructureViewState>({ status: 'loading' });
  const refParam = refParamOf(ref);
  const config = CONFIG;

  useEffect(() => {
    // S1 item 15: guard on `modelId`/`parentId` too, not just `userId` —
    // same fix as `useBreadcrumbElement.ts`'s own precedent for this exact
    // shape (a caller's `model?.id ?? ''` fires this effect once before its
    // own model resolves; left unguarded, `reportError`'s new catch-all
    // here would otherwise post a banner that outlives the load that
    // follows it).
    if (!userId || !modelId || !parentId) return undefined;
    const currentUserId = userId;
    let cancelled = false;
    setState({ status: 'loading' });

    async function load(): Promise<void> {
      let commitId: UUID;
      let branchId: UUID | null = null;
      let diff: VersionDiff | null = null;
      let parent;
      let children;
      let relationships;
      let elementsById;

      if (ref.kind === 'branch') {
        const branch = await resolveBranchRef(supabase, ref);
        if (!branch) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        const resolved = await resolveBranchModeProjectionCached(supabase, modelId, branch, mode);
        if (!resolved) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolved.commitId;
        branchId = branch.id;
        diff = resolved.diff;
        parent = projectionElementById(resolved.projection, parentId);
        if (parent?.element_type !== config.parentType) {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        children = projectionChildrenOf(resolved.projection, parentId);
        const childIds = children.map((c) => c.element_id);
        relationships = projectionRelationshipsTouchingAny(resolved.projection, childIds, config.relationshipTypes);
        const externalIds = [...new Set(relationships.flatMap((r) => [r.from_element_id, r.to_element_id]).filter((id) => !childIds.includes(id)))];
        elementsById = projectionElementsByIds(resolved.projection, externalIds);
      } else {
        const resolvedCommitId = ref.kind === 'main' && mainCommitIdHint ? mainCommitIdHint : await resolveRef(supabase, modelId, ref);
        if (!resolvedCommitId) {
          if (!cancelled) setState({ status: 'refNotFound' });
          return;
        }
        commitId = resolvedCommitId;
        parent = await getElementHead(supabase, commitId, parentId);
        if (parent?.element_type !== config.parentType) {
          if (!cancelled) setState({ status: 'notPresentAtRef' });
          return;
        }
        children = await listChildrenOf(supabase, commitId, parentId);
        const childIds = children.map((c) => c.element_id);
        relationships = await listRelationshipsTouchingAny(supabase, commitId, childIds, config.relationshipTypes);
        const externalIds = [...new Set(relationships.flatMap((r) => [r.from_element_id, r.to_element_id]).filter((id) => !childIds.includes(id)))];
        elementsById = await getElementsByIds(supabase, commitId, externalIds);
      }

      const view = await getOrCreateScopedView(supabase, {
        id: crypto.randomUUID(),
        orgId,
        modelId,
        kind: config.viewKind,
        name: `${config.viewNamePrefix}: ${parent.name}`,
        scopeElementId: parentId,
        createdBy: currentUserId,
        branchId,
      });
      const group = computeStructureGroup(parent, children, relationships, elementsById);

      if (!cancelled) setState({ status: 'ready', data: { commitId, view, group, diff } });
    }

    load().catch((e: unknown) => {
      reportError("Couldn't load this container.", e);
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load this container' });
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, orgId, userId, parentId, refParam, mode, mainCommitIdHint]);

  return state;
}
