import type { UUID } from '../../contracts/delta';
import { buildCommitLoader } from '../../db/commitLoader';
import type { Client } from '../../db/client';
import { selectBranchModeHead, type BranchModeProjection } from '../../db/branchProjection';
import type { BranchRow } from '../../db/types';
import type { ViewMode } from '../../db/viewMode';
import { foldFromGenesis } from '../../engine/head';
import type { Head } from '../../engine/deltas';
import { serializeHeadProjection, type HeadProjection } from '../../engine/projection';
import { queryClient } from './queryClient';
import { queryKeys } from './keys';

/**
 * E8 item (2): "main reads the projection, never folds; branch reads fold
 * once per (branch, head) and cache." Main already never folds — every
 * `ref.kind === 'main'` read path in this codebase queries
 * `elements_head`/`relationships_head`/`facts` directly, which SPEC §1 S-2
 * only ever materialises for main's current head. This file is the other
 * half: `src/db/branchProjection.ts`'s `loadProjectionAtCommit`/
 * `resolveBranchModeProjection` are already the one shared fold
 * implementation every branch-reading hook routes through (no duplicated
 * fold logic to consolidate first) — what was missing was a cache in
 * front of them, so navigating between, say, an element page and the
 * landscape while viewing the *same* branch head folded the identical
 * deltas twice, from genesis, with zero reuse.
 *
 * The cache here is content-addressed by `commitId` alone (`queryKeys.headAtCommit`)
 * and never invalidated: a commit's own folded content can never change
 * once it exists (deltas/commits are append-only — CLAUDE.md rule 5), so
 * "the cache went stale" isn't a state this key can ever be in the way
 * `mainBranch`/`editingBranch` (E8 item (1)) can — those track a row that
 * moves; this tracks an immutable fact. `staleTime: Infinity` reflects
 * that literally, not as an approximation of "long enough."
 *
 * `queryClient.query` (not `useQuery`) deliberately, since these calls
 * happen inside existing async data-loading functions
 * (`useElementPage.ts`'s `resolveElementSource`, `useLandscape.ts`, etc.),
 * not React components — `query` is the same cache, read and populated
 * imperatively, with the same request-deduplication for concurrent callers
 * asking for the same key (it replaces the now-deprecated `fetchQuery`,
 * same options shape).
 */
export function loadHeadAtCommitCached(supabase: Client, modelId: UUID, commitId: UUID): Promise<Head> {
  return queryClient.query({
    queryKey: queryKeys.headAtCommit(modelId, commitId),
    queryFn: async () => {
      const loader = await buildCommitLoader(supabase, modelId);
      return foldFromGenesis(commitId, loader);
    },
    staleTime: Infinity,
  });
}

/** Cached drop-in for `src/db/branchProjection.ts`'s `loadProjectionAtCommit` — same signature, same return shape, every call for the same `commitId` after the first is instant. */
export async function loadProjectionAtCommitCached(supabase: Client, modelId: UUID, commitId: UUID): Promise<HeadProjection> {
  const head = await loadHeadAtCommitCached(supabase, modelId, commitId);
  return serializeHeadProjection(head);
}

/**
 * Cached drop-in for `src/db/branchProjection.ts`'s `resolveBranchModeProjection`
 * — same signature, same return shape. Unlike that function, this folds
 * `base_commit_id` and `head_commit_id` as two independent cache entries
 * (`loadHeadAtCommitCached`, each keyed on its own commit id) rather than
 * one combined call sharing a single `buildCommitLoader` — the tradeoff
 * favours the cache's own "fold once, ever, per commit" property over the
 * uncached version's one-round-trip-for-both-sides optimisation on a cold
 * cache: a branch's `base_commit_id` in particular is very often a commit
 * some *other* view has already folded (it's usually not far from a
 * recent main head), so keying by commit id alone lets that reuse happen
 * across hooks, not just within repeated calls to this one function.
 * `mode` never enters the cache key: both sides are folded regardless of
 * which mode is requested, and `selectBranchModeHead` (a cheap, pure
 * selection over two already-cached `Head`s, never itself cached) is what
 * actually varies by mode — so switching As-is/To-be/Diff on an
 * already-open branch costs nothing beyond that selection, no re-fold.
 */
export async function resolveBranchModeProjectionCached(supabase: Client, modelId: UUID, branch: BranchRow, mode: ViewMode): Promise<BranchModeProjection | null> {
  if (!branch.base_commit_id || !branch.head_commit_id) return null;

  const [asIsHead, toBeHead] = await Promise.all([
    loadHeadAtCommitCached(supabase, modelId, branch.base_commit_id),
    loadHeadAtCommitCached(supabase, modelId, branch.head_commit_id),
  ]);
  const selected = selectBranchModeHead(asIsHead, branch.base_commit_id, toBeHead, branch.head_commit_id, mode);
  // `serializeHeadProjection` only ever reads `selected.head` to build
  // plain arrays — never mutates it — so the cached `asIsHead`/`toBeHead`
  // above are safe to hand `selectBranchModeHead` directly: its own
  // asIs/toBe branches return one of them unmodified, and its diff branch
  // already clones before mutating (`selectBranchModeHead`'s own doc
  // comment). Nothing downstream of this function ever sees the raw
  // `Head` at all, only the serialized projection below.
  return { commitId: selected.commitId, projection: serializeHeadProjection(selected.head), diff: selected.diff };
}
