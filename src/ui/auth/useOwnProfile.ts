import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getProfile } from '../../db/profiles';
import type { ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
import { queryKeys } from '../query/keys';
import { supabase } from '../supabaseClient';

export interface UseOwnProfileResult {
  /**
   * `null` either while still loading, or genuinely absent — a signed-in
   * user with no organisation membership yet has no `atlas.profiles` row
   * at all, since `atlas.ensure_profile` (Sprint M1a) only fires on the
   * first `members` insert. `loading` is how a caller tells the two apart.
   */
  profile: ProfileRow | null;
  loading: boolean;
  /** Re-fetches — call after `updateMyProfile` changes this user's own row. */
  refresh: () => void;
}

/**
 * The signed-in user's own `atlas.profiles` row. Used by `RequireAuth` for
 * the Prompt 7h "first sign-in prompts for a display name" gate; any other
 * page wanting "my own profile" (as opposed to `listProfilesByIds`' batch
 * lookup for other people's) should use this too rather than re-querying.
 *
 * E8 item (1): shared-cache version — see `useOrganisationBySlug.ts`'s own
 * comment for the general shape. `refresh()` now invalidates the one
 * cache entry every caller of this hook shares, not just this component's
 * own local state.
 */
export function useOwnProfile(userId: string | null): UseOwnProfileResult {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.ownProfile(userId),
    queryFn: async () => {
      if (!userId) return null;
      try {
        return await getProfile(supabase, userId);
      } catch (e) {
        // A failed lookup leaves `profile` at whatever it already was —
        // `RequireAuth`'s gate below treats "still loading" and "errored"
        // the same way (don't block the app on this) — but still reported
        // (S1 audit follow-up, same "silent fallback, still worth a trace"
        // shape `useBreadcrumbElement.ts` already established for item 15).
        reportError("Couldn't load your profile.", e);
        return null;
      }
    },
    enabled: userId !== null,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.ownProfile(userId) });
  }, [queryClient, userId]);

  return { profile: data ?? null, loading: isLoading, refresh };
}
