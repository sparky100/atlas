import { useCallback, useEffect, useState } from 'react';
import type { HomeMode } from '../../contracts/userPreferences';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import type { UUID } from '../../contracts/delta';
import { supabase } from '../supabaseClient';

export interface UseHomeModeResult {
  homeMode: HomeMode;
  loading: boolean;
  setHomeMode: (mode: HomeMode) => void;
}

/**
 * The two front doors' switch (UI-principles §3.3): "switching is instant,
 * remembered, and never changes what the user is permitted to do."
 * `user_preferences.home_mode` is the source of truth once a row exists —
 * no pre-paint/localStorage concern here unlike `ThemeProvider` (this only
 * ever affects `ModelHome`'s own content, never a flash-of-wrong-theme-
 * shaped problem), so this is a plain load-then-write hook, not a context
 * provider.
 *
 * `isOwnerOrArchitect` (role, loaded separately and possibly still
 * unresolved on first render) only decides the default *while no row has
 * ever been saved* (`defaultUserPreferences`'s own doc comment: "the row
 * is created on first change") — `savedHomeMode` stays `null` until the
 * real load resolves one way or the other, so the role-based default is
 * derived fresh every render rather than "settled into" state once and
 * risking a stale value if role arrives late.
 */
export function useHomeMode(userId: UUID | null, isOwnerOrArchitect: boolean): UseHomeModeResult {
  // `undefined` while the DB load is still in flight; `null` once it's
  // resolved to "no row saved yet"; a real HomeMode once one exists or the
  // user has switched (switching writes straight into this same state, so
  // there's no separate "local override" to keep in sync with it).
  const [savedHomeMode, setSavedHomeMode] = useState<HomeMode | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSavedHomeMode(null);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!cancelled) setSavedHomeMode(row?.home_mode ?? null);
      })
      .catch(() => {
        if (!cancelled) setSavedHomeMode(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = savedHomeMode === undefined;
  const homeMode = savedHomeMode ?? (isOwnerOrArchitect ? 'architect' : 'director');

  const setHomeMode = useCallback(
    (mode: HomeMode) => {
      setSavedHomeMode(mode);
      if (userId) {
        upsertUserPreferences(supabase, { userId, homeMode: mode }).catch(() => {
          // Best-effort, same stance as ThemeProvider.setTheme: the local
          // state (already updated above) is what this device shows
          // regardless of a sync failure.
        });
      }
    },
    [userId],
  );

  return { homeMode, loading, setHomeMode };
}
