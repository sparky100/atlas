import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { convertSystemToModule } from '../../db/convertSystemToModule';
import { getOrCreateManualSource } from '../../db/sources';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type ConvertToModuleStatus = 'idle' | 'converting';

export interface UseConvertToModuleResult {
  status: ConvertToModuleStatus;
  error: string | null;
  convert: (targetPlatformId: UUID) => Promise<void>;
}

export interface UseConvertToModuleInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  /** The system being converted — this page's own element. */
  systemId: UUID;
  branch: BranchRow;
  expectedHeadCommitId: UUID;
  /** Called once the conversion (commit + name-alias recording) has fully succeeded — the caller navigates to the new container's own page, since this element no longer exists here (same reasoning `useElementMerge.ts`'s `onMerged` gives). */
  onConverted: (newContainerId: UUID) => void;
}

/**
 * A thin UI wrapper over `src/db/convertSystemToModule.ts`, the same shape
 * `useElementMerge.ts` follows for "Merge into…": mints a manual source,
 * reports a plain error on failure. No undo action on the save toast
 * (unlike merge's) — v1 of this operation has none, `convertSystemToModule.ts`'s
 * own doc comment explains why.
 */
export function useConvertToModule(input: UseConvertToModuleInput): UseConvertToModuleResult {
  const { modelId, orgId, userId, systemId, branch, expectedHeadCommitId, onConverted } = input;
  const [status, setStatus] = useState<ConvertToModuleStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const convert = useCallback(
    async (targetPlatformId: UUID) => {
      if (!userId) {
        setError('You must be signed in to convert this.');
        return;
      }
      setError(null);
      setStatus('converting');

      try {
        const source = await getOrCreateManualSource(supabase, { id: crypto.randomUUID(), orgId, modelId, userId });
        const result = await convertSystemToModule(supabase, {
          modelId,
          orgId,
          branchId: branch.id,
          expectedHeadCommitId,
          systemId,
          targetPlatformId,
          sourceId: source.id,
          userId,
        });

        if (result.status !== 'converted') {
          setStatus('idle');
          setError(result.status === 'conflict' ? 'This element changed since you loaded it. Reload the page and try again.' : `Could not convert: ${result.message}`);
          return;
        }

        setStatus('idle');
        onConverted(result.newContainerId);
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not convert.');
      }
    },
    [modelId, orgId, userId, systemId, branch, expectedHeadCommitId, onConverted],
  );

  return { status, error, convert };
}
