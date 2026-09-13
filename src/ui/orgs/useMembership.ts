import { useEffect, useState } from 'react';
import { getMyMembership } from '../../db/organisations';
import type { MemberRole } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

// Re-exported for every existing import site (`import { canEditOnMain, useMembership } from '../orgs/useMembership'`)
// — see roleGates.ts's own comment for why the gates themselves live there now.
export {
  canApproveOrMergeRequest,
  canArchiveModel,
  canBackfillCapabilityOrder,
  canCancelChange,
  canCreateChangeBranch,
  canCreateModel,
  canDeleteModel,
  canEditBranch,
  canEditOnMain,
  canManageOrgSettings,
  canRestoreModel,
  canReviewMergeRequest,
  canStartDecision,
} from './roleGates';

export interface UseMembershipResult {
  role: MemberRole | null;
  loading: boolean;
}

/** The signed-in user's own role in `orgId` — what the UI reads to decide what to show. RLS (not this hook) is the actual enforcement point. */
export function useMembership(orgId: UUID | null, userId: UUID | null): UseMembershipResult {
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !userId) {
      setRole(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getMyMembership(supabase, orgId, userId)
      .then((row) => {
        if (!cancelled) setRole(row?.role ?? null);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load your membership.", e);
        if (!cancelled) setRole(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  return { role, loading };
}
