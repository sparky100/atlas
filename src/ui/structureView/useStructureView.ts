import { useEffect, useState } from 'react';
import type { ElementType, RelationshipType, UUID } from '../../contracts/delta';
import { projectionChildrenOf, projectionElementById, projectionElementsByIds, projectionRelationshipsTouchingAny, resolveBranchModeProjection } from '../../db/branchProjection';
import { getElementHead, getElementsByIds, listChildrenOf } from '../../db/elements';
import { refParamOf, resolveBranchRef, resolveRef, type Ref } from '../../db/ref';
import { listRelationshipsTouchingAny } from '../../db/structureView';
import { getOrCreateScopedView } from '../../db/views';
import type { ViewKind, ViewRow } from '../../db/types';
import type { ViewMode } from '../../db/viewMode';
import type { VersionDiff } from '../../engine/versionDiff';
import { computeStructureGroup, type StructureGroup } from './structureGrouping';
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
 * Container and Component are the same shape (UI-principles §6.1: "one
 * [system|container], its [containers|components], plus external
 * [systems/containers|containers] they `uses`[/`flows_to`]") — one
 * `kind`-parameterised config, not two near-duplicate hooks. The one real
 * difference `relationship_type_rules` (ADR-001) draws between them:
 * Container also has `flows_to` at container grain; Component only ever
 * has `uses`.
 */
const CONFIG: Record<'container' | 'component', StructureViewKindConfig> = {
  container: { viewKind: 'container', parentType: 'system', relationshipTypes: ['uses', 'flows_to'], viewNamePrefix: 'Containers' },
  component: { viewKind: 'component', parentType: 'container', relationshipTypes: ['uses'], viewNamePrefix: 'Components' },
};

/**
 * Loads the Container or Component view. No `view_layouts` — same reason
 * as useSystemContext.ts: DOM/CSS grouping, no pixel position to persist.
 *
 * Sprint C1: a branch ref folds via src/db/branchProjection.ts instead of
 * querying `elements_head`/`relationships_head` — same reasoning as
 * useLandscape.ts's own Sprint C1 note.
 */
export function useStructureView(kind: 'container' | 'component', modelId: UUID, orgId: UUID, userId: UUID | null, parentId: UUID, ref: Ref, mode: ViewMode): StructureViewState {
  const [state, setState] = useState<StructureViewState>({ status: 'loading' });
  const refParam = refParamOf(ref);
  const config = CONFIG[kind];

  useEffect(() => {
    if (!userId) return undefined;
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
        const resolved = await resolveBranchModeProjection(supabase, modelId, branch, mode);
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
        const resolvedCommitId = await resolveRef(supabase, modelId, ref);
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
      if (!cancelled) setState({ status: 'error', message: e instanceof Error ? e.message : `Failed to load this ${kind}` });
    });

    return () => {
      cancelled = true;
    };
  }, [kind, modelId, orgId, userId, parentId, refParam, mode, config.parentType, config.relationshipTypes, config.viewKind, config.viewNamePrefix]);

  return state;
}
