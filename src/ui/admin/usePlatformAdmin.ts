import { useEffect, useState } from 'react';
import { isPlatformAdmin } from '../../db/platformAdmins';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UsePlatformAdminResult {
  isPlatformAdmin: boolean;
  loading: boolean;
}

/** The signed-in user's own platform-admin status — same fetch-on-mount shape as `useMembership.ts`, minus the org dimension (this is Atlas's first cross-org role). RLS (`platform_admins_select_self`), not this hook, is the actual enforcement point. */
export function usePlatformAdmin(userId: UUID | null): UsePlatformAdminResult {
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setAdmin(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    isPlatformAdmin(supabase, userId)
      .then((result) => {
        if (!cancelled) setAdmin(result);
      })
      .catch((e: unknown) => {
        reportError("Couldn't check platform-admin status.", e);
        if (!cancelled) setAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { isPlatformAdmin: admin, loading };
}
