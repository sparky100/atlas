import { useQuery } from '@tanstack/react-query';
import type { UUID } from '../../contracts/delta';
import { countOpenChangeBranches } from '../../db/branches';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

/**
 * How many changes are still open on this model — the Changes nav item's
 * badge, so the number matches what that page lists as live work (never
 * the cancelled or merged ones). `staleTime: 0` and `null` until known, the
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
        reportError("Couldn't load the open changes count.", e);
        throw e;
      }
    },
    enabled: modelId !== null,
    staleTime: 0,
  });
  return data ?? null;
}
