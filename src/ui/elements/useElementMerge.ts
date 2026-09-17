import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { mergeElements, undoElementMerge } from '../../db/elementMerges';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';

export type ElementMergeStatus = 'idle' | 'merging';

export interface UseElementMergeResult {
  status: ElementMergeStatus;
  error: string | null;
  merge: (survivorId: UUID, survivorName: string, rationale: string) => Promise<void>;
}

export interface UseElementMergeInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The element being merged away — this page's own element; it becomes `loserId` (SPEC §3.6's own naming). */
  loserId: UUID;
  loserName: string;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Called once the merge (commit + `element_merges`/alias recording) has fully succeeded — the caller navigates to the survivor's own page, since this element no longer exists here. */
  onMerged: (survivorId: UUID) => void;
}

/**
 * E7's own "Merge into…" — a thin UI wrapper over `src/db/elementMerges.ts`'s
 * `mergeElements`/`undoElementMerge`; the delta-building and commit/RPC work
 * happens there and in `src/engine/mergeElements.ts`. This hook's own job is
 * what those don't do: minting a manual source, reporting the save toast
 * with a real, working "Undo" action (`toastStore.ts`'s `action` field —
 * clicking it calls `undoElementMerge` directly, no navigation of its own,
 * since the toast can fire long after the page that started the merge is
 * gone), and surfacing a plain error message on failure — the same shape
 * every other editing hook here already follows.
 */
export function useElementMerge(input: UseElementMergeInput): UseElementMergeResult {
  const { modelId, orgId, userId, loserId, loserName, branch, expectedHeadCommitId, onMerged } = input;
  const [status, setStatus] = useState<ElementMergeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const merge = useCallback(
    async (survivorId: UUID, survivorName: string, rationale: string) => {
      if (!userId) {
        setError('You must be signed in to merge this.');
        return;
      }
      if (rationale.trim() === '') {
        setError('Say why these are the same real thing before merging.');
        return;
      }
      setError(null);
      setStatus('merging');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const result = await mergeElements(supabase, {
          modelId,
          branchId: branch.id,
          expectedHeadCommitId,
          survivorId,
          loserId,
          sourceId: source.id,
          rationale: rationale.trim(),
        });

        if (result.status !== 'merged') {
          setStatus('idle');
          setError(result.status === 'conflict' ? 'This element changed since you loaded it. Reload the page and try again.' : `Could not merge: ${result.message}`);
          return;
        }

        setStatus('idle');
        const { elementMergeId, commitId } = result;
        reportToast(`Merged "${loserName}" into "${survivorName}"`, {
          label: 'Undo',
          onClick: () => {
            void (async () => {
              try {
                const undoSource = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
                const undoResult = await undoElementMerge(supabase, {
                  modelId,
                  branchId: branch.id,
                  expectedHeadCommitId: commitId,
                  elementMergeId,
                  sourceId: undoSource.id,
                });
                if (!undoResult.ok) {
                  reportError('Could not undo the merge.', new Error(undoResult.message));
                  return;
                }
                reportToast(`Undid merge of "${loserName}" into "${survivorName}"`);
              } catch (e) {
                reportError('Could not undo the merge.', e);
              }
            })();
          },
        });
        onMerged(survivorId);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not merge.');
      }
    },
    [modelId, orgId, userId, loserId, loserName, branch, expectedHeadCommitId, onMerged],
  );

  return { status, error, merge };
}
