import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch, updateBranchMetadata, type UpdateBranchMetadataInput } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export type ChangeStatus = 'loading' | 'idle' | 'saving' | 'not_found';

export interface UseChangeResult {
  status: ChangeStatus;
  branch: BranchRow | null;
  error: string | null;
  updateMetadata: (input: UpdateBranchMetadataInput) => Promise<void>;
  reload: () => void;
}

/** One change branch's own metadata (name/title/description/target date/status) — the change page's foundation (Sprint C1 step 3). Deltas grouped by element, affected capabilities, and other open changes touching the same elements are a later step (UI-principles' change page spec) — not built here. */
export function useChange(branchId: UUID): UseChangeResult {
  const [status, setStatus] = useState<ChangeStatus>('loading');
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    getBranch(supabase, branchId)
      .then((row) => {
        if (cancelled) return;
        setBranch(row);
        setStatus(row ? 'idle' : 'not_found');
      })
      .catch((e: unknown) => {
        reportError("Couldn't load this change.", e);
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load this change.');
          setStatus('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [branchId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((t) => t + 1);
  }, []);

  const updateMetadata = useCallback(
    async (input: UpdateBranchMetadataInput) => {
      setError(null);
      setStatus('saving');
      try {
        await updateBranchMetadata(supabase, branchId, input);
        setStatus('idle');
        reload();
      } catch (e) {
        setStatus('idle');
        setError(e instanceof Error ? e.message : 'Could not save this change.');
      }
    },
    [branchId, reload],
  );

  return { status, branch, error, updateMetadata, reload };
}
