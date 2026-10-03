import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { countOpenChangeBranches } from '../../db/branches';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * How many changes on this model are still open (`OPEN_CHANGE_STATUSES`:
 * not merged, cancelled, rejected or archived) — the Changes nav item's
 * badge. `staleTime: 0` and `null` until known, the
 * same as `useReviewQueueCount`: re-checked on every page mount, and the
 * badge shows nothing rather than a guessed zero.
 */
export function useOpenChangeCount(modelId: UUID | null): number | null {
  const { data } = useQuery({
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
  return data ?? null;
}
