import { useEffect, useState } from 'react';
import { getMyMembership } from '../../db/organisations';
import type { MemberRole } from '../../db/types';
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';

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
      .catch(() => {
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

/** Mirrors `models_insert`'s RLS check (`atlas.has_role(org_id, 'owner', 'architect')`, supabase/migrations/20260906071300_models.sql) — for showing/hiding the affordance; the database enforces the real rule regardless of what this returns. */
export function canCreateModel(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}

/**
 * Mirrors `atlas.commit_deltas`'s main-only role gate (ADR-015: "only
 * owners and architects may commit directly to main") — for showing/hiding
 * `Edit` at `main` (UI-principles §4.2). A contributor gets no edit
 * affordance at all in Sprint U1 rather than an inert `Propose a change…`
 * (there is no branch UI yet for that to open) — the same "no demo
 * shortcut" call the element page already made for every role before this
 * step existed.
 */
export function canEditOnMain(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}
