import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { BranchRow } from '../../db/types';
import { applyCommitToCache } from '../query/applyCommitToCache';
import { supabase } from '../supabaseClient';
import { reportToast } from '../toasts/toastStore';
import { commitAttestation } from './attestation';

export interface UseAttestationInput {
  modelId: UUID;
  orgId: UUID;
  userId: UUID | null;
  branch: BranchRow | null;
  onConfirmed: () => void;
}

export interface AttestationController {
  /** The element currently being confirmed, if any — one at a time. */
  confirmingId: UUID | null;
  error: string | null;
  confirm: (element: ElementsHeadRow, expectedHeadCommitId: UUID) => Promise<void>;
}

/** ADR-025: "Still accurate" — the element page's and the grid's shared confirm action. */
export function useAttestation({ modelId, orgId, userId, branch, onConfirmed }: UseAttestationInput): AttestationController {
  const [confirmingId, setConfirmingId] = useState<UUID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const confirm = useCallback(
    async (element: ElementsHeadRow, expectedHeadCommitId: UUID) => {
      if (!userId || !branch) {
        setError(!userId ? 'You must be signed in to confirm.' : 'Still loading — try again in a moment.');
        return;
      }
      setConfirmingId(element.element_id);
      setError(null);
      try {
        const result = await commitAttestation(supabase, { modelId, orgId, userId, branch, expectedHeadCommitId, element, today: new Date().toISOString().slice(0, 10) });
        if (!result.ok) {
          setError(result.reason === 'conflict' ? 'This element changed since you loaded it. Reload and try again.' : result.message);
          return;
        }
        applyCommitToCache(queryClient, modelId, branch, result.commitId, result.newHead);
        reportToast(branch.kind === 'change' ? `Confirmed ${element.name} still accurate, in change: ${branch.title ?? branch.name}` : `Confirmed ${element.name} still accurate`);
        onConfirmed();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not confirm.');
      } finally {
        setConfirmingId(null);
      }
    },
    [modelId, orgId, userId, branch, queryClient, onConfirmed],
  );

  return { confirmingId, error, confirm };
}
