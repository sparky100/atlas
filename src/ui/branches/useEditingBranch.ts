import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { getBranch, getMainBranch } from '../../db/branches';
import type { BranchRow } from '../../db/types';
import type { Ref } from '../../db/ref';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseEditingBranchResult {
  branch: BranchRow | null;
  loading: boolean;
}

/**
 * The branch a page should actually write to for the current `?ref=`
 * (Sprint C1 step 9): `main`'s own row for `ref.kind === 'main'`, or the
 * referenced change branch's row for `ref.kind === 'branch'` — `null` for
 * `tag` or `commit` (neither is ever editable; a page reading one already
 * renders read-only per `resolveRef`'s own doc comment). S1 item 9:
 * "editing hooks (useEditingBranch etc.) never run for commit or tag
 * refs" — this used to guard only `tag`, so a `commit:` ref fell through
 * to `getBranch(supabase, branchIdIfAny ?? '')` with `branchIdIfAny` null
 * (a commit ref has no `branchId`), which `assertRealId` throws on
 * immediately — a doomed query and a spurious error banner on every page
 * render with a commit ref selected, never a real load.
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
/** E8 item (1): shared-cache version — see `useOrganisationBySlug.ts`'s own comment for the general shape. Not invalidated by `invalidateModelHead` (that file's own comment explains why a commit to `main` never touches this query); a `main`-ref reader still shares `useMainBranch`'s own cache entry via the identical key scheme, so the two stay consistent without this hook invalidating anything itself. */
export function useEditingBranch(modelId: UUID | null, ref: Ref): UseEditingBranchResult {
  const enabled = modelId !== null && ref.kind !== 'tag' && ref.kind !== 'commit';

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.editingBranch(modelId, ref),
    queryFn: async () => {
      if (!modelId || ref.kind === 'tag' || ref.kind === 'commit') return null;
      try {
        return await (ref.kind === 'main' ? getMainBranch(supabase, modelId) : getBranch(supabase, ref.branchId));
      } catch (e) {
        // Sprint U4-2a item 2: same silent-swallow gap as useMainBranch.ts
        // — `branch: null` here means "nothing is editable," which every
        // caller's own `canEdit`/`canAdd` computation just quietly treats
        // as "no write controls," with no indication anything failed.
        reportError("Couldn't load the change to edit.", e);
        return null;
      }
    },
    enabled,
  });

  return { branch: data ?? null, loading: enabled ? isLoading : false };
}
