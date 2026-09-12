import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { changeMemberRole, listMembers, removeMember, type MemberWithProfile } from '../../db/organisations';
import type { MemberRole } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseMembersResult {
  members: MemberWithProfile[];
  loading: boolean;
  error: string | null;
  changeRole: (userId: UUID, role: MemberRole) => Promise<void>;
  remove: (userId: UUID) => Promise<void>;
}

/**
 * Sprint 7j item 2's member directory — list plus the two mutations
 * (`changeMemberRole`/`removeMember`). Reloads the whole list after each
 * mutation rather than editing local state optimistically:
 * `atlas.guard_last_owner` (20260906071200_tenancy.sql) can refuse either
 * one server-side (demoting or removing an org's last owner), and the
 * re-fetched list is the source of truth for what actually happened.
 */
export function useMembers(orgId: UUID | null): UseMembersResult {
  const [members, setMembers] = useState<MemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listMembers(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load members');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect
    // reads — the react-hooks plugin only runs on .tsx files (eslint.config.js),
    // so no exhaustive-deps disable is needed here.
  }, [orgId, reloadToken]);

  const changeRole = async (userId: UUID, role: MemberRole) => {
    if (!orgId) return;
    setError(null);
    try {
      await changeMemberRole(supabase, orgId, userId, role);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not change this member's role.";
      setError(message);
      reportError("Could not change this member's role.", e);
    }
  };

  const remove = async (userId: UUID) => {
    if (!orgId) return;
    setError(null);
    try {
      await removeMember(supabase, orgId, userId);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not remove this member.';
      setError(message);
      reportError('Could not remove this member.', e);
    }
  };

  return { members, loading, error, changeRole, remove };
}
