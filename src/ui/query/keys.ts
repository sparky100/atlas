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
};
