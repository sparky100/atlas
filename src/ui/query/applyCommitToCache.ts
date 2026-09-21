import type { QueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import type { Head } from '../../engine/deltas';
import { queryKeys } from './keys';

/**
 * E8 item (3): "after a commit, apply the returned deltas to the cached
 * head and re-render, then revalidate in the background; no full reload."
 *
 * Every commit path in this codebase (`commitToBranch`, `mergeApprovedRequest`,
 * `backfillCapabilityOrder`, `seedModelFromCapabilityMap`) already folds the
 * committed deltas onto the previous head locally, to build the RPC's own
 * payload — that `newHead` is thrown away by every caller of this function's
 * predecessor (`invalidateModelHead` alone), which instead marked the caches
 * stale and waited on a refetch to learn something the client had already
 * computed. This seeds that known-correct result straight into the caches
 * E8 items (1)/(2) built:
 *
 * - `queryKeys.headAtCommit(modelId, newHeadCommitId)` (item (2)'s
 *   content-addressed, never-invalidated fold cache) gets `newHead` directly
 *   — a page reading the branch this commit landed on via
 *   `loadHeadAtCommitCached` gets an instant cache hit for the commit it just
 *   made, no fold and no round trip.
 * - The committed branch's own cached row (`mainBranch`/`editingBranch`, item
 *   (1)) gets its `head_commit_id` patched in place, so a re-render right
 *   after this call already reads the new head — not the one from before the
 *   commit, which react-query would otherwise keep serving until the
 *   background refetch below resolves.
 *
 * Only `head_commit_id` is patched optimistically — every other column of
 * the *just-committed* branch's own row (`updated_at`, review/lifecycle
 * state, …) is stale until that row's next ordinary refetch (a later
 * navigation, an unrelated invalidation elsewhere), not refreshed
 * immediately here (#242, below).
 *
 * `branch.id` is only used to pick the right row out of `editingBranch`'s
 * cache, which can hold more than one change branch's row under the same
 * `['branch', 'editing', modelId]` prefix (`invalidateModelHead.ts`'s own
 * comment on why that invalidation is broad). `mainBranch`'s cache holds
 * exactly one row per model — there's nothing to disambiguate — so a caller
 * that knows a commit moved main but doesn't have main's own `BranchRow` in
 * hand (`mergeApprovedRequest`'s callers: a merge always lands on main, but
 * neither hook fetches main's row just to name its id) can pass `id: null`.
 *
 * #242: this used to call `invalidateModelHead` unconditionally, which
 * invalidates *both* `mainBranch` and `editingBranch` every time — but
 * whichever one this commit actually landed on was just patched directly,
 * above, with the exact head this commit produced. Re-invalidating that
 * same query key a moment later only wins a redundant background refetch
 * of a value already known correct: real new network traffic the pre-E8
 * code never made, competing with whatever the foreground UI does next
 * (`docs/perf/2026-09.md`'s own regression). A commit can only ever move
 * the one branch it landed on — never both main and a change branch at
 * once — so the *other* query key was never touched by it in the first
 * place and still gets its own ordinary invalidation, same as before;
 * only the just-patched key's own redundant re-invalidation is dropped.
 */
export function applyCommitToCache(queryClient: QueryClient, modelId: UUID, branch: { id: UUID | null; kind: BranchRow['kind'] }, newHeadCommitId: UUID, newHead: Head): void {
  queryClient.setQueryData(queryKeys.headAtCommit(modelId, newHeadCommitId), newHead);

  if (branch.kind === 'main') {
    queryClient.setQueryData(queryKeys.mainBranch(modelId), (row: BranchRow | null | undefined) => (row ? { ...row, head_commit_id: newHeadCommitId } : row));
    void queryClient.invalidateQueries({ queryKey: ['branch', 'editing', modelId] });
  } else {
    queryClient.setQueriesData({ queryKey: ['branch', 'editing', modelId] }, (row: BranchRow | null | undefined) => (row?.id === branch.id ? { ...row, head_commit_id: newHeadCommitId } : row));
    void queryClient.invalidateQueries({ queryKey: queryKeys.mainBranch(modelId) });
  }
}
