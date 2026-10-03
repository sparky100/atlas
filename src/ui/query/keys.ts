import type { UUID } from '../../contracts/delta';
import type { Ref } from '../../db/ref';

/**
 * E8 item (1)'s query-key factory — the single naming scheme every hook
 * under `src/ui/orgs/`, `src/ui/models/`, `src/ui/branches/`,
 * `src/ui/auth/useOwnProfile.ts` and `src/ui/comments/useOrgMemberProfiles.ts`
 * now reads and invalidates through, so two pages requesting "the main
 * branch of model X" (say, ElementPage and CapabilityMapPage) share one
 * cache entry instead of each fetching and holding their own copy — the
 * duplication E8 item (1) names directly ("caching org, model, branches,
 * head, profiles across routes").
 *
 * Kept centralised, not inlined per hook, specifically so
 * `invalidateModelHead.ts` (the "invalidated on commit" half) can target
 * the exact same keys these hooks query with, without either file having
 * to import the other's internals.
 */
export const queryKeys = {
  organisationBySlug: (slug: string) => ['organisation', 'bySlug', slug] as const,
  modelsForOrg: (orgId: UUID | null) => ['models', 'forOrg', orgId] as const,
  mainBranch: (modelId: UUID | null) => ['branch', 'main', modelId] as const,
  editingBranch: (modelId: UUID | null, ref: Ref) => ['branch', 'editing', modelId, ref.kind, ref.kind === 'branch' ? ref.branchId : null] as const,
  membership: (orgId: UUID | null, userId: UUID | null) => ['membership', orgId, userId] as const,
  ownProfile: (userId: string | null) => ['profile', 'own', userId] as const,
  orgMemberProfiles: (orgId: UUID | null) => ['profiles', 'forOrg', orgId] as const,
  /**
   * E8 item (2)'s "branch reads fold once per (branch, head) and cache" —
   * content-addressed: a commit's own folded content never changes once it
   * exists (deltas/commits are append-only, SPEC §2/§9), so unlike every
   * other key in this file, nothing ever needs to invalidate this one —
   * see `cachedBranchProjection.ts`'s own `staleTime: Infinity`. Keyed by
   * `commitId` alone (not `branchId`): a branch's `head_commit_id` and an
   * arbitrary `commit:` ref can name the exact same commit, and both
   * should share one cache entry.
   */
  headAtCommit: (modelId: UUID | null, commitId: UUID | null) => ['headAtCommit', modelId, commitId] as const,
  /** F9 step 2: the review queue's item count (open merge requests the queue shows, plus capture drafts waiting) — the Changes nav badge and the Changes page's "Review queue" tab read the same entry. */
  reviewQueueCount: (modelId: UUID | null) => ['reviewQueue', 'count', modelId] as const,
  /** The Changes nav badge: how many changes are still open (`countOpenChangeBranches`). */
  openChangeCount: (modelId: UUID | null) => ['changes', 'openCount', modelId] as const,
  /** The Decisions nav badge: how many decisions are still proposed (`countProposedDecisions`). */
  proposedDecisionCount: (modelId: UUID | null) => ['decisions', 'proposedCount', modelId] as const,
};
