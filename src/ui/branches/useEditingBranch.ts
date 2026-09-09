import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { getBranch, getMainBranch } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import type { Ref } from '../../db/ref';
import { supabase } from '../supabaseClient';

export interface UseEditingBranchResult {
  branch: BranchRow | null;
  loading: boolean;
}

/**
 * The branch a page should actually write to for the current `?ref=`
 * (Sprint C1 step 9): `main`'s own row for `ref.kind === 'main'`, or the
 * referenced change branch's row for `ref.kind === 'branch'` — `null` for
 * `tag` (a tag is never editable; a page reading one already renders
 * read-only per `resolveRef`'s own doc comment).
 *
 * This closes a gap `useMainBranch.ts`'s own module comment named but
 * didn't finish: "every editing hook now takes an explicit `branch:
 * BranchRow` rather than looking main up for itself" generalised the
 * *hooks* (`useElementEditor`, `useElementRetract`, `useElementRename`,
 * `CapabilityTailoringActions` — renamed `CapabilityRetractAction` in
 * Sprint U4-1 D3, once rename moved out of it) in Sprint C1 step 4, but
 * every actual call site kept feeding them `useMainBranch()` regardless
 * of `ref` — meaning "editing while a change is selected writes deltas
 * to the branch" (the user's own Sprint C1 brief, item 2) had no real UI
 * path to a change branch at all until this hook existed to pick the
 * right one.
 */
export function useEditingBranch(modelId: UUID | null, ref: Ref): UseEditingBranchResult {
  const [branch, setBranch] = useState<BranchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const branchIdIfAny = ref.kind === 'branch' ? ref.branchId : null;

  useEffect(() => {
    if (!modelId || ref.kind === 'tag') {
      setBranch(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const load = ref.kind === 'main' ? getMainBranch(supabase, modelId) : getBranch(supabase, branchIdIfAny ?? '');
    load
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
  }, [modelId, ref.kind, branchIdIfAny]);

  return { branch, loading };
}
