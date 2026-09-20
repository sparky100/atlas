import type { QueryClient } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import type { BranchRow } from '../../db/types';
import type { Head } from '../../engine/deltas';
import { invalidateModelHead } from './invalidateModelHead';
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
 * Only `head_commit_id` is patched optimistically — every other column
 * (`updated_at`, review/lifecycle state, …) comes from the background
 * revalidation this still triggers via `invalidateModelHead`, unawaited, the
 * same "don't block the caller on it" behaviour item (1) already established.
 *
 * `branch.id` is only used to pick the right row out of `editingBranch`'s
 * cache, which can hold more than one change branch's row under the same
 * `['branch', 'editing', modelId]` prefix (`invalidateModelHead.ts`'s own
 * comment on why that invalidation is broad). `mainBranch`'s cache holds
 * exactly one row per model — there's nothing to disambiguate — so a caller
 * that knows a commit moved main but doesn't have main's own `BranchRow` in
 * hand (`mergeApprovedRequest`'s callers: a merge always lands on main, but
 * neither hook fetches main's row just to name its id) can pass `id: null`.
 */
export function applyCommitToCache(queryClient: QueryClient, modelId: UUID, branch: { id: UUID | null; kind: BranchRow['kind'] }, newHeadCommitId: UUID, newHead: Head): void {
  queryClient.setQueryData(queryKeys.headAtCommit(modelId, newHeadCommitId), newHead);

  if (branch.kind === 'main') {
    queryClient.setQueryData(queryKeys.mainBranch(modelId), (row: BranchRow | null | undefined) => (row ? { ...row, head_commit_id: newHeadCommitId } : row));
  } else {
    queryClient.setQueriesData({ queryKey: ['branch', 'editing', modelId] }, (row: BranchRow | null | undefined) => (row?.id === branch.id ? { ...row, head_commit_id: newHeadCommitId } : row));
  }

  void invalidateModelHead(queryClient, modelId);
}
