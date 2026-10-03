import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import type { UUID } from '../../contracts/delta';
import { countOpenChangeBranches } from '../../db/branches';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * How many changes on this model are still open (`OPEN_CHANGE_STATUSES`:
 * not merged, cancelled, rejected or archived) — the Changes nav item's
 * badge. `null` until known, so the badge shows nothing rather than a
 * guessed zero.
 *
 * Re-read on every navigation, not just when the nav mounts: the nav stays
 * mounted across pages on a wide screen, and a change's status moves from
 * many places (submit, merge, reject, cancel, a decision's Choose, a new
 * change) — one re-read here keeps the badge current after any of them
 * without each call site having to remember to invalidate it.
 */
export function useOpenChangeCount(modelId: UUID | null): number | null {
  const { pathname } = useLocation();
  const { data, refetch } = useQuery({
    queryKey: queryKeys.openChangeCount(modelId),
    queryFn: async () => {
      if (!modelId) return 0;
      try {
        return await countOpenChangeBranches(supabase, modelId);
      } catch (e) {
        reportError("Couldn't load the changes count.", e);
        throw e;
      }
    },
    enabled: modelId !== null,
    staleTime: 0,
  });
  useEffect(() => {
    if (modelId !== null) void refetch();
  }, [pathname, modelId, refetch]);
  return data ?? null;
}
