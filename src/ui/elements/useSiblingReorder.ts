import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, ElementType, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { listFactsForSubject } from '../../db/elements';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { resolveOrders } from '../capabilityMap/resolveCapabilityOrders';

// Re-exported so every existing import site of the pre-generalisation name is unaffected.
export { resolveOrders } from '../capabilityMap/resolveCapabilityOrders';

export type SiblingReorderStatus = 'idle' | 'reordering';

export interface UseSiblingReorderResult {
  status: SiblingReorderStatus;
  error: string | null;
  /** See `useCapabilityReorder`'s own former doc comment (this hook's direct ancestor) for the full swap/`resolveOrders` reasoning — unchanged by the generalisation below. */
  swap: (element: ElementsHeadRow, neighbor: ElementsHeadRow, siblings: readonly ElementsHeadRow[]) => Promise<void>;
}

export interface UseSiblingReorderInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** F6 (ADR-023): the only thing `useCapabilityReorder` had hardcoded — every sibling reordered through this hook shares one `element_type` (a capability's own siblings, or a value stream's own stages), same as every other generic row-shaped function in this codebase (`resolveOrders` itself already took no type parameter at all). */
  elementType: ElementType;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onReordered: () => void;
}

/**
 * Sibling reorder, general (F6/ADR-023 generalises Sprint U4-1 C1's
 * capability-only `useCapabilityReorder` — see that hook's own retired doc
 * comment for the move-buttons-not-drag reasoning, unchanged here): one
 * commit, two `element.update` deltas swapping `attributes.order` between
 * `element` and `neighbor`, with `previousDeltaId` resolved per side via a
 * lazy `listFactsForSubject` call — no bulk read the caller's own view pays
 * for on every load.
 */
export function useSiblingReorder(input: UseSiblingReorderInput): UseSiblingReorderResult {
  const { modelId, orgId, userId, elementType, branch, expectedHeadCommitId, onReordered } = input;
  const [status, setStatus] = useState<SiblingReorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const swap = useCallback(
    async (element: ElementsHeadRow, neighbor: ElementsHeadRow, siblings: readonly ElementsHeadRow[]) => {
      if (!userId) {
        setError('You must be signed in to reorder.');
        return;
      }
      const { capabilityOrder: elementOrder, neighborOrder } = resolveOrders(siblings, element, neighbor);
      setError(null);
      setStatus('reordering');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const [elementFacts, neighborFacts] = await Promise.all([
          listFactsForSubject(supabase, expectedHeadCommitId, element.element_id),
          listFactsForSubject(supabase, expectedHeadCommitId, neighbor.element_id),
        ]);
        const elementPreviousDeltaId = elementFacts.find((f) => f.attribute === 'order')?.delta_id ?? element.exists_delta_id;
        const neighborPreviousDeltaId = neighborFacts.find((f) => f.attribute === 'order')?.delta_id ?? neighbor.exists_delta_id;

        const deltas: Delta[] = [
          {
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: element.element_id,
            elementType,
            attribute: 'order',
            value: neighborOrder,
            previousDeltaId: elementPreviousDeltaId,
            sourceId: source.id,
            confidence: 1,
          } as Delta,
          {
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: neighbor.element_id,
            elementType,
            attribute: 'order',
            value: elementOrder,
            previousDeltaId: neighborPreviousDeltaId,
            sourceId: source.id,
            confidence: 1,
          } as Delta,
        ];

        const nameLookup = (id: UUID): string | undefined => (id === element.element_id ? element.name : id === neighbor.element_id ? neighbor.name : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: `Reorder ${element.name} and ${neighbor.name}`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(result.reason === 'conflict' ? 'This changed since you loaded it. Reload the page and try again.' : `Could not reorder: ${result.message}`);
          return;
        }

        setStatus('idle');
        // E8 item (3): seeds the cache with the head this commit already computed — see applyCommitToCache.ts's own comment.
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        onReordered();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not reorder.');
      }
    },
    [modelId, orgId, userId, elementType, branch, expectedHeadCommitId, onReordered, queryClient],
  );

  return { status, error, swap };
}
