import { useCallback, useEffect, useState } from 'react';
import { getProfile } from '../../db/profiles';
import type { ProfileRow } from '../../db/types';
import { reportError } from '../errors/errorBannerStore';
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

/** The signed-in user's own `atlas.profiles` row. Used by `RequireAuth` for the Prompt 7h "first sign-in prompts for a display name" gate; any other page wanting "my own profile" (as opposed to `listProfilesByIds`' batch lookup for other people's) should use this too rather than re-querying. */
export function useOwnProfile(userId: string | null): UseOwnProfileResult {
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getProfile(supabase, userId)
      .then((row) => {
        if (!cancelled) setProfile(row);
      })
      .catch((e: unknown) => {
        // A failed lookup leaves `profile` at whatever it already was —
        // `RequireAuth`'s gate below treats "still loading" and "errored"
        // the same way (don't block the app on this) — but still reported
        // (S1 audit follow-up, same "silent fallback, still worth a trace"
        // shape `useBreadcrumbElement.ts` already established for item 15).
        reportError("Couldn't load your profile.", e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, generation]);

  const refresh = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);

  return { profile, loading, refresh };
}
