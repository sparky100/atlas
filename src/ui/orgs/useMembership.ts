import { useQuery } from '@tanstack/react-query';
import { getMyMembership } from '../../db/organisations';
import type { MemberRole } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

// Re-exported for every existing import site (`import { canEditOnMain, useMembership } from '../orgs/useMembership'`)
// — see roleGates.ts's own comment for why the gates themselves live there now.
export {
  canApproveOrMergeRequest,
  canArchiveModel,
  canBackfillCapabilityOrder,
  canCancelChange,
  canChooseDecisionOption,
  canCreateChangeBranch,
  canCreateModel,
  canDeleteModel,
  canEditBranch,
  canEditOnMain,
  canEditValueStreamStructure,
  canManageDuplicatesCheck,
  canManageOrgSettings,
  canRateDecisionOption,
  canRestoreModel,
  canReviewMergeRequest,
  canRunCapture,
  canRunDuplicateCheck,
  canStartDecision,
} from './roleGates';

export interface UseMembershipResult {
  role: MemberRole | null;
  loading: boolean;
}

/** The signed-in user's own role in `orgId` — what the UI reads to decide what to show. RLS (not this hook) is the actual enforcement point. E8 item (1): shared-cache version — see `useOrganisationBySlug.ts`'s own comment for the general shape. */
export function useMembership(orgId: UUID | null, userId: UUID | null): UseMembershipResult {
  const enabled = orgId !== null && userId !== null;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.membership(orgId, userId),
    queryFn: async () => {
      if (!orgId || !userId) return null;
      try {
        const row = await getMyMembership(supabase, orgId, userId);
        return row?.role ?? null;
      } catch (e) {
        reportError("Couldn't load your membership.", e);
        return null;
      }
    },
    enabled,
  });

  return { role: data ?? null, loading: enabled ? isLoading : false };
}
