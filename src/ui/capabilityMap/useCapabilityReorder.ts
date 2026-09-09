import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { listFactsForSubject } from '../../db/elements';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { attributesRecord } from '../elements/attributesRecord';
import { supabase } from '../supabaseClient';

export type CapabilityReorderStatus = 'idle' | 'reordering';

export interface UseCapabilityReorderResult {
  status: CapabilityReorderStatus;
  error: string | null;
  /**
   * Swaps `capability` and `neighbor`'s `attributes.order` — moving
   * `capability` one place among its siblings, Sprint U4-1 C1's "drag-to-
   * reorder" (a swap, not a drag gesture — see this hook's own module
   * comment). Both must already carry a real `order`: a hand-added
   * capability that's never been given one has no position to swap into
   * yet, so the caller (`CapabilityMapView.tsx`) never offers this for it.
   */
  swap: (capability: ElementsHeadRow, neighbor: ElementsHeadRow) => Promise<void>;
}

export interface UseCapabilityReorderInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onReordered: () => void;
}

/**
 * The tailoring flow's reorder action (Sprint U4-1 C1: "tailoring allows
 * drag-to-reorder among siblings"). Implemented as move-left/right
 * (L1)/move-up/down (L2) buttons in `CapabilityMapView.tsx`, not a mouse
 * drag gesture — this codebase has no drag-and-drop anywhere else and no
 * DnD library installed, and buttons are keyboard- and screen-reader-
 * operable the way a bare `draggable` element isn't (§8.7's own bar every
 * other control here meets); the *effect* — one capability changes places
 * with an adjacent sibling — is the same either way. One commit, two
 * `element.update` deltas swapping `attributes.order`: `capability` gets
 * `neighbor`'s current order and vice versa, so both stay distinct and
 * every other sibling's position is untouched — no renumbering, no
 * fractional/midpoint math.
 *
 * `previousDeltaId` for each delta is the delta currently asserting
 * `order` for that element — its own `element.create` the first time
 * anyone reorders it, or whichever `element.update` last touched `order`
 * after that. Not knowable from the capability map's own already-loaded
 * data (`CapabilityMapView` never loads per-element facts, unlike the
 * element page's `useElementEditor.ts`), so this hook fetches each
 * side's facts itself, lazily, only when a swap actually happens — two
 * small `listFactsForSubject` calls, not a bulk read the map view pays
 * for on every load.
 */
export function useCapabilityReorder(input: UseCapabilityReorderInput): UseCapabilityReorderResult {
  const { modelId, orgId, userId, branch, expectedHeadCommitId, onReordered } = input;
  const [status, setStatus] = useState<CapabilityReorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const swap = useCallback(
    async (capability: ElementsHeadRow, neighbor: ElementsHeadRow) => {
      if (!userId) {
        setError('You must be signed in to reorder capabilities.');
        return;
      }
      const capabilityOrder = attributesRecord(capability.attributes).order;
      const neighborOrder = attributesRecord(neighbor.attributes).order;
      if (typeof capabilityOrder !== 'number' || typeof neighborOrder !== 'number') {
        setError('Both capabilities need an existing order before they can swap places.');
        return;
      }
      setError(null);
      setStatus('reordering');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const [capabilityFacts, neighborFacts] = await Promise.all([
          listFactsForSubject(supabase, expectedHeadCommitId, capability.element_id),
          listFactsForSubject(supabase, expectedHeadCommitId, neighbor.element_id),
        ]);
        const capabilityPreviousDeltaId = capabilityFacts.find((f) => f.attribute === 'order')?.delta_id ?? capability.exists_delta_id;
        const neighborPreviousDeltaId = neighborFacts.find((f) => f.attribute === 'order')?.delta_id ?? neighbor.exists_delta_id;

        const deltas: Delta[] = [
          {
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: capability.element_id,
            elementType: 'capability',
            attribute: 'order',
            value: neighborOrder,
            previousDeltaId: capabilityPreviousDeltaId,
            sourceId: source.id,
            confidence: 1,
          },
          {
            kind: 'element.update',
            id: crypto.randomUUID(),
            elementId: neighbor.element_id,
            elementType: 'capability',
            attribute: 'order',
            value: capabilityOrder,
            previousDeltaId: neighborPreviousDeltaId,
            sourceId: source.id,
            confidence: 1,
          },
        ];

        const nameLookup = (id: UUID): string | undefined => (id === capability.element_id ? capability.name : id === neighbor.element_id ? neighbor.name : undefined);
        const envelope: CommitEnvelope = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          parentCommitId: expectedHeadCommitId,
          mergedBranchHeadCommitId: null,
          kind: 'manual',
          title: describeEnvelope(deltas, nameLookup),
          body: `Reorder ${capability.name} and ${neighbor.name}`,
          deltas,
        };

        const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
        if (!result.ok) {
          setStatus('idle');
          setError(
            result.reason === 'conflict'
              ? 'The capability map changed since you loaded it. Reload the page and try again.'
              : `Could not reorder: ${result.message}`,
          );
          return;
        }

        setStatus('idle');
        onReordered();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not reorder capabilities.');
      }
    },
    [modelId, orgId, userId, branch, expectedHeadCommitId, onReordered],
  );

  return { status, error, swap };
}
