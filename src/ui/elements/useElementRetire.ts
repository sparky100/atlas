import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import { validateAttributeValue } from '../../contracts/attributeSchema';
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../../contracts/rows';
import { attributesRecord } from './attributesRecord';
import { commitToBranch } from '../../db/commits';
import { buildCopiedEdgeDeltas } from './replacementEdges';
import { buildReplacesDelta } from '../../engine/buildReplacesDelta';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { projectionRelationshipsForElement } from '../../db/branchProjection';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { loadProjectionAtCommitCached } from '../query/cachedBranchProjection';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ElementRetireStatus = 'idle' | 'retiring';

export interface RetireReplacement {
  elementId: UUID;
  name: string;
}

export interface UseElementRetireResult {
  status: ElementRetireStatus;
  error: string | null;
  retire: (plannedEnd: string, replacement: RetireReplacement | null, copyEdgeIds?: ReadonlySet<UUID>) => Promise<void>;
}

export interface UseElementRetireInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /**
   * The retiring element — a system, or (post-"platforms and modules") a
   * container/module. Not capability/component/actor: `lifecycleStatus`
   * (what this action actually sets) is only a field `SystemAttributes`/
   * `ContainerAttributes` carry.
   */
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** The retiring element's own live relationships (`ElementPageData.relationships`) — used to find its own `supports` edges when a replacement is given; no new round trip. */
  relationships: readonly RelationshipsHeadRow[];
  /** Which branch this commits to — see `useElementEditor.ts`'s identical `branch` doc comment. */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRetired: () => void;
}

/**
 * Prompt 7k item 5's "Retire…" (generalised beyond system-only by
 * "platforms and modules" — a platform's module is a Container, and
 * `ContainerAttributes` now carries `lifecycleStatus`/`plannedEnd` too):
 * sets `lifecycleStatus: 'retiring'` and `plannedEnd` via the same
 * `element.update` shape `useElementEditor.ts` already uses (no new engine
 * primitive), plus an optional "replaced by" picker that (a) transfers the
 * retiring element's own `supports` edges to the replacement, one
 * capability at a time, in the *same* commit — the old edge is KEPT and a
 * new `role: 'secondary'` edge is created on the replacement (a copy, never
 * a move; Simon, 2026-11-16) — and (b) records the replacement
 * itself as a first-class fact: a `replaces` edge (ADR-001 amendment,
 * `buildReplacesDelta`) from the replacement to the retiring element. Capability
 * links and interfaces (`uses`, `flows_to`) are copied (a person can untick any);
 * other links are left on the old system for a person to review. The old system stops counting
 * once its planned end passes (`supportsEdgesInForce`), and a capability's
 * "lifecycle exposure" check ignores a replaced system through the `replaces`
 * edge (`replacedElementIds`), so keeping the old edge no longer leaves the
 * capability reading exposed.
 *
 * New edges always get `role: 'secondary'`, never a copy of the original
 * edge's own role — promoting one to `role: 'primary'` could collide with
 * a `primary` edge the replacement already has elsewhere (C17, anchored on
 * `fromElementId`), and finding out requires reading the replacement's own
 * relationships at whatever ref is selected, which for a change branch
 * means the branch-projection path `useElementPage.ts`'s own module
 * comment describes (its materialised-table read is empty for a branch's
 * own commits) — not worth adding here. A user who wants the replacement's
 * new supports edge to be primary can promote it afterward via the
 * existing supports "primary?" prompt.
 */
export function useElementRetire(input: UseElementRetireInput): UseElementRetireResult {
  const { modelId, orgId, userId, element, facts, relationships, branch, expectedHeadCommitId, onRetired } = input;
  const [status, setStatus] = useState<ElementRetireStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const retire = useCallback(
    async (plannedEnd: string, replacement: RetireReplacement | null, copyEdgeIds?: ReadonlySet<UUID>) => {
      if (!userId) {
        setError('You must be signed in to retire this.');
        return;
      }
      // `plannedEnd` is optional on `SystemAttributes`/`ContainerAttributes`
      // in general (an ordinary edit may set it without touching lifecycle
      // at all), but this action's whole point is recording one — enforced
      // here, at the product level, rather than by widening the schema's
      // own `required` flag for every other caller of
      // `validateAttributeValue`.
      if (plannedEnd.trim() === '') {
        setError('Planned end is required to retire this.');
        return;
      }
      const validated = validateAttributeValue(element.element_type, 'plannedEnd', plannedEnd);
      if (!validated.ok) {
        setError(validated.error);
        return;
      }
      setError(null);
      setStatus('retiring');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const deltas: Delta[] = [];

        const currentLifecycleStatus = attributesRecord(element.attributes).lifecycleStatus;
        if (currentLifecycleStatus !== 'retiring') {
          deltas.push({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: element.element_type,
            attribute: 'lifecycleStatus',
            value: 'retiring',
            previousDeltaId: facts.get('lifecycleStatus')?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          } as Delta);
        }

        const currentPlannedEnd = attributesRecord(element.attributes).plannedEnd;
        if (currentPlannedEnd !== validated.value) {
          deltas.push({
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType: element.element_type,
            attribute: 'plannedEnd',
            value: validated.value,
            previousDeltaId: facts.get('plannedEnd')?.delta_id ?? element.exists_delta_id,
            sourceId: source.id,
            confidence: 1,
          } as Delta);
        }

        if (replacement) {
          // A link the replacement already has is skipped, never duplicated (C10 would reject the whole commit). Read from the projection at this branch's head, so it also sees a change's own edges.
          const projection = await loadProjectionAtCommitCached(supabase, modelId, expectedHeadCommitId);
          const alreadyThere = new Set(projectionRelationshipsForElement(projection, replacement.elementId).map((rel) => `${rel.relationship_type}|${rel.from_element_id}|${rel.to_element_id}`));
          // Copy, never move: the old system keeps its own links (it stops counting once its planned end passes — `supportsEdgesInForce`). Capability links go across as secondary; interfaces keep their direction (`replacementEdges.ts`).
          deltas.push(...buildCopiedEdgeDeltas({ oldId: element.element_id, newId: replacement.elementId, relationships, chosen: copyEdgeIds, alreadyThere, sourceId: source.id }));

          deltas.push(buildReplacesDelta(replacement.elementId, element.element_id, source.id));
        }

        if (deltas.length === 0) {
          setStatus('idle');
          return;
        }

        const nameLookup = (id: UUID) => (id === element.element_id ? element.name : id === replacement?.elementId ? replacement.name : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: replacement ? `Retire ${element.name}, replaced by ${replacement.name}` : `Retire ${element.name}`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'This element changed since you loaded it. Reload the page and try again.'
              : `Could not retire: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        // Item 2: see useElementEditor.ts's identical comment.
        if (branch.kind === 'change') reportToast(`Saved to change: ${branch.title ?? branch.name}`);
        // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onRetired();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not retire.');
      }
    },
    [element, facts, relationships, modelId, orgId, userId, branch, expectedHeadCommitId, onRetired, queryClient],
  );

  return { status, error, retire };
}
