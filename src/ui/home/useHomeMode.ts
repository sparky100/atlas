import { useCallback, useEffect, useState } from 'react';
import type { HomeMode } from '../../contracts/userPreferences';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import type { UUID } from '../../contracts/delta';
import { reportError } from '../errors/errorBannerStore';
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
        // Never overwrite a switch the user made while this load was still
        // in flight — clicking "Capability view" straight after landing used
        // to be silently undone when the (older) saved value arrived.
        if (!cancelled) setSavedHomeMode((current) => (current === undefined ? (row?.home_mode ?? null) : current));
      })
      .catch((e: unknown) => {
        // S1 audit follow-up: the load half only — `setHomeMode`'s own
        // write-path catch below is a user-triggered save, unaffected.
        reportError("Couldn't load your saved home view preference.", e);
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
