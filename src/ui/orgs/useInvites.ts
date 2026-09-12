import { useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { createInvite, listInvites, revokeInvite, type CreateInviteResult } from '../../db/invites';
import type { InviteRow, MemberRole } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseInvitesResult {
  invites: InviteRow[];
  loading: boolean;
  error: string | null;
  /** `null` on a real failure (already reported); the result's own `status` distinguishes 'created' from 'already_pending', which a caller shows inline rather than as a global error — same convention `useModelSettings.ts`'s own `remove` established. */
  create: (email: string, role: MemberRole) => Promise<CreateInviteResult | null>;
  revoke: (id: UUID) => Promise<void>;
}

/**
 * Sprint 7j item 4's invite list — list plus the two mutations
 * (`createInvite`/`revokeInvite`), same reload-after-mutation shape
 * `useMembers.ts` already established for the member directory sitting
 * right next to this on the same settings page.
 */
export function useInvites(orgId: UUID | null, invitedBy: UUID | null): UseInvitesResult {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!orgId) {
      setInvites([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listInvites(supabase, orgId)
      .then((rows) => {
        if (!cancelled) setInvites(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load invites');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadToken is a deliberate refetch trigger, not a value the effect
    // reads — the react-hooks plugin only runs on .tsx files (eslint.config.js).
  }, [orgId, reloadToken]);

  const create = async (email: string, role: MemberRole): Promise<CreateInviteResult | null> => {
    if (!orgId || !invitedBy) return null;
    setError(null);
    try {
      const result = await createInvite(supabase, { id: crypto.randomUUID(), orgId, email, role, invitedBy });
      setReloadToken((t) => t + 1);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not send this invite.';
      setError(message);
      reportError('Could not send this invite.', e);
      return null;
    }
  };

  const revoke = async (id: UUID) => {
    setError(null);
    try {
      await revokeInvite(supabase, id);
      setReloadToken((t) => t + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not revoke this invite.';
      setError(message);
      reportError('Could not revoke this invite.', e);
    }
  };

  return { invites, loading, error, create, revoke };
}
