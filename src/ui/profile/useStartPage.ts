import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { StartPage } from '../../contracts/userPreferences';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseStartPageResult {
  /** The saved choice, `null` when none has been saved (the role decides — `resolveStartPage`). Meaningful only once `loading` is false. */
  saved: StartPage | null;
  loading: boolean;
  /** Saves the choice (`null` goes back to "decide by my role"). The screen updates at once; a failed save is reported. */
  setStartPage: (page: StartPage | null) => void;
}

/** A person's saved start page (`user_preferences.start_page`) — follows them across organisations, like their home view choice. */
export function useStartPage(userId: UUID | null): UseStartPageResult {
  // `undefined` while the load is in flight; `null` once resolved to "nothing saved".
  const [saved, setSaved] = useState<StartPage | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSaved(null);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId).then(
      (row) => {
        // A choice made while this load was in flight must not be undone by the older saved value.
        if (!cancelled) setSaved((current) => (current === undefined ? (row?.start_page ?? null) : current));
      },
      (e: unknown) => {
        reportError("Couldn't load your start page.", e);
        if (!cancelled) setSaved(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setStartPage = useCallback(
    (page: StartPage | null) => {
      setSaved(page);
      if (!userId) return;
      upsertUserPreferences(supabase, { userId, startPage: page }).catch((e: unknown) => {
        reportError("Couldn't save your start page.", e);
      });
    },
    [userId],
  );

  return { saved: saved ?? null, loading: saved === undefined, setStartPage };
}
