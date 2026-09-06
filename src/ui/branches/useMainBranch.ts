import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getMainBranch } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import { supabase } from '../supabaseClient';

export interface UseMainBranchResult {
  branch: BranchRow | null;
  loading: boolean;
}

/**
 * A model's `main` branch row (Sprint C1 step 4) — every editing hook now
 * takes an explicit `branch: BranchRow` rather than looking `main` up for
 * itself (src/ui/elements/useElementEditor.ts's own doc comment), so every
 * page that edits at `main` needs this once. Reload isn't wired here: none
 * of `main`'s own row fields (`id`, `kind`) that editing actually reads
 * ever change once a model exists, only `head_commit_id` — and every
 * editing hook already takes that separately as `expectedHeadCommitId`,
 * refreshed by the page's own reload.
 */
export function useMainBranch(modelId: UUID | null): UseMainBranchResult {
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!modelId) {
      setBranch(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMainBranch(supabase, modelId)
      .then((row) => {
        if (!cancelled) setBranch(row);
      })
      .catch(() => {
        if (!cancelled) setBranch(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return { branch, loading };
}
