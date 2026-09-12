import { useCallback, useState } from 'react';
import { cancelChange } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export type CancelChangeStatus = 'idle' | 'cancelling';

export interface UseCancelChangeResult {
  status: CancelChangeStatus;
  error: string | null;
  /** `atlas.cancel_change` (S1 item 4) — requires a non-empty reason. Resolves `true` on success, so the caller can navigate/clear its own selected ref exactly once the branch is actually cancelled. */
  cancel: (reason: string) => Promise<boolean>;
}

/**
 * The change page's "Cancel this change" action (S1 item 4) — same shape
 * as `useSubmitForReview.ts`: `branch` may still be `null` while the page
 * is loading, called unconditionally either way (rules of hooks).
 */
export function useCancelChange(branch: BranchRow | null): UseCancelChangeResult {
  const [status, setStatus] = useState<CancelChangeStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(
    async (reason: string): Promise<boolean> => {
      if (!branch) return false;
      if (reason.trim().length === 0) {
        setError('A reason is required.');
        return false;
      }
      setError(null);
      setStatus('cancelling');
      try {
        await cancelChange(supabase, branch.id, reason.trim());
        setStatus('idle');
        return true;
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not cancel this change.');
        return false;
      }
    },
    [branch],
  );

  return { status, error, cancel };
}
