import { useCallback, useEffect, useState } from 'react';
import type { HomeMode } from '../../contracts/userPreferences';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import type { UUID } from '../../contracts/delta';
import { resolveDefaultColourBy, type ColourByMode } from './metrics';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseColourByPreferenceResult {
  colourBy: ColourByMode;
  loading: boolean;
  setColourBy: (mode: ColourByMode) => void;
}

/**
 * Sprint U4-1 C4's "default colour-by... remember last choice per user".
 * Same load-then-write shape as `useHomeMode.ts` (this hook's own direct
 * model): `user_preferences.capability_map_colour_by` is the source of
 * truth once a row exists; `savedColourBy` stays `null` (not yet resolved
 * to a saved choice) until the real load settles one way or the other, so
 * `resolveDefaultColourBy`'s context (`homeMode`, `hasSystems`) is applied
 * fresh every render rather than "settled into" state once and risking a
 * stale default if either arrives after the initial render.
 */
export function useColourByPreference(userId: UUID | null, homeMode: HomeMode, hasSystems: boolean): UseColourByPreferenceResult {
  // `undefined` while the DB load is still in flight; `null` once resolved
  // to "no row saved yet" (or no `userId`); a real mode once one exists or
  // the user has switched (switching writes straight into this same
  // state, same as `useHomeMode.ts`'s `savedHomeMode`).
  const [savedColourBy, setSavedColourBy] = useState<ColourByMode | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSavedColourBy(null);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!cancelled) setSavedColourBy(row?.capability_map_colour_by ?? null);
      })
      .catch((e: unknown) => {
        // S1 audit follow-up: the load half only — `setColourBy`'s own
        // write-path catch below is a user-triggered save with its own
        // "best-effort, local state already updated" stance, unaffected.
        reportError("Couldn't load your saved colour-by preference.", e);
        if (!cancelled) setSavedColourBy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = savedColourBy === undefined;
  const colourBy = resolveDefaultColourBy(savedColourBy ?? null, homeMode, hasSystems);

  const setColourBy = useCallback(
    (mode: ColourByMode) => {
      setSavedColourBy(mode);
      if (userId) {
        upsertUserPreferences(supabase, { userId, capabilityMapColourBy: mode }).catch(() => {
          // Best-effort, same stance as useHomeMode.ts's own setHomeMode:
          // the local state (already updated above) is what this device
          // shows regardless of a sync failure.
        });
      }
    },
    [userId],
  );

  return { colourBy, loading, setColourBy };
}
