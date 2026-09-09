import { useCallback, useState } from 'react';
import type { CommitEnvelope, Delta, UUID } from '../../contracts/delta';
import type { ElementsHeadRow, FactsRow } from '../../contracts/rows';
import { commitToBranch } from '../../db/commits';
import { describeEnvelope } from '../../engine/describeEnvelope';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type ElementRetractStatus = 'idle' | 'retracting';

export interface UseElementRetractResult {
  status: ElementRetractStatus;
  error: string | null;
  retract: () => Promise<void>;
}

export interface UseElementRetractInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  element: ElementsHeadRow;
  facts: Map<string, FactsRow>;
  /** Which branch this retract commits to — see useElementEditor.ts's `branch` doc comment (Sprint C1). */
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  onRetracted: () => void;
}

/**
 * Retracting at `main` or on a draft change branch (same gate as
 * edit/rename, ADR-015/ADR-009).
 * A single `element.retract` delta — no cascade. C8 (src/contracts/delta.ts
 * COMMIT_INVARIANTS) requires every relationship touching the element and
 * every child re-parented or retracted in the *same* commit; this hook
 * doesn't attempt that (a cascading delete is a bigger, separate feature,
 * and CLAUDE.md rule 2/SPEC's own "no cascades" language argue against
 * silently sweeping up children/relationships a person didn't explicitly
 * ask to remove). Callers must gate the retract affordance on the element
 * actually being a leaf with no live relationships — src/ui/routes/
 * ElementPage.tsx does this before ever calling `retract()` — so this hook
 * never has to translate a C8 rejection into UI copy.
 */
export function useElementRetract(input: UseElementRetractInput): UseElementRetractResult {
  const { modelId, orgId, userId, element, facts, branch, expectedHeadCommitId, onRetracted } = input;
  const [status, setStatus] = useState<ElementRetractStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const retract = useCallback(async () => {
    if (!userId) {
      setError('You must be signed in to retract.');
      return;
    }
    setError(null);
    setStatus('retracting');

    try {
      const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });

      const delta: Delta = {
        kind: 'element.retract',
        id: crypto.randomUUID(),
        elementId: element.element_id,
        elementType: element.element_type,
        previousDeltaId: facts.get('$exists')?.delta_id ?? element.exists_delta_id,
        sourceId: source.id,
        confidence: 1,
      };

      const deltas = [delta];
      const envelope: CommitEnvelope = {
        id: crypto.randomUUID(),
        branchId: branch.id,
        parentCommitId: expectedHeadCommitId,
        mergedBranchHeadCommitId: null,
        kind: 'manual',
        title: describeEnvelope(deltas, (id) => (id === element.element_id ? element.name : undefined)),
        body: `Retract ${element.name}`,
        deltas,
      };

      const result = await commitToBranch(supabase, { modelId, branchId: branch.id, expectedHeadCommitId, envelope });
      if (!result.ok) {
        setStatus('idle');
        setError(
          result.reason === 'conflict'
            ? 'This element changed since you loaded it. Reload the page and try again.'
            : `Could not retract: ${result.message}`,
        );
        return;
      }

      setStatus('idle');
      onRetracted();
    } catch (e) {
      setStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not retract.');
    }
  }, [element, facts, modelId, orgId, userId, branch, expectedHeadCommitId, onRetracted]);

  return { status, error, retract };
}
