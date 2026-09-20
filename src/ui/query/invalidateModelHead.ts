import type { QueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { queryKeys } from './keys';

/**
 * E8 item (1)'s "invalidated on commit" half: call this after *any*
 * successful commit (main or a change branch alike) — every component
 * reading `useMainBranch(modelId)`/`useEditingBranch(modelId, ref)`
 * (regardless of which page mounted it) refetches on its own next render,
 * not just the one that made the commit. This replaces the old per-page
 * `reloadMainBranch()`/`reloadAll()` wiring's real job (`useMainBranch.ts`'s
 * own doc comment on why `head_commit_id` moving matters beyond a stale
 * display value) — `useMainBranch` itself still exposes a `reload()` for
 * calling sites that want to await the refetch, but that `reload()` now
 * calls this, not a component-local `reloadToken` only that one hook
 * instance ever saw.
 *
 * Unconditional, not branch-kind-gated: an earlier version of this only
 * invalidated `mainBranch`, on the reasoning that a commit to a change
 * branch never moves `main`'s own head — true, but it missed the mirror
 * case, `useEditingBranch`'s own cached row for that *same* change branch,
 * which a commit to it very much does move. Invalidating both queries
 * every time is a harmless no-op refetch for whichever one the commit
 * didn't actually touch, and it closes this exact class of gap for good
 * rather than requiring every call site to reason about which of the two
 * caches its own commit could affect (found live: `useSubmitForReview.ts`
 * reading a stale `branch.head_commit_id` right after a same-branch edit,
 * because only `mainBranch` was being invalidated).
 *
 * The `editingBranch` invalidation is intentionally broad (every ref for
 * this model, not just the one the caller happens to know about) — see
 * `queryKeys.ts`: `queryKeys.editingBranch` keys on `[..., modelId, ...]`,
 * and react-query's own partial-key matching invalidates every query whose
 * key starts with the given prefix, so passing just `['branch', 'editing',
 * modelId]` here reaches every ref's own cached row for this model without
 * this file needing to know which one.
 */
export function invalidateModelHead(queryClient: QueryClient, modelId: UUID): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.mainBranch(modelId) }),
    queryClient.invalidateQueries({ queryKey: ['branch', 'editing', modelId] }),
  ]).then(() => undefined);
}
