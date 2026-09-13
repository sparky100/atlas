import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../contracts/delta';
import type { LandscapeColourByMode } from '../../contracts/userPreferences';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { reportError } from '../errors/errorBannerStore';
import { supabase } from '../supabaseClient';

export interface UseLandscapeColourByPreferenceResult {
  colourBy: LandscapeColourByMode;
  loading: boolean;
  setColourBy: (mode: LandscapeColourByMode) => void;
}

/**
 * Prompt 7k item 1's landscape colour-by, same load-then-write shape as
 * `useColourByPreference.ts` (the capability map's own version) — the one
 * difference is there's no `resolveDefaultColourBy` step: the landscape has
 * no model-aware default to fall back to, so `null` (nothing saved yet)
 * and `'none'` currently render identically.
 */
export function useLandscapeColourByPreference(userId: UUID | null): UseLandscapeColourByPreferenceResult {
  const [savedColourBy, setSavedColourBy] = useState<LandscapeColourByMode | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSavedColourBy(null);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!cancelled) setSavedColourBy(row?.landscape_colour_by ?? null);
      })
      .catch((e: unknown) => {
        // S1 audit follow-up: the load half only — `setColourBy`'s own
        // write-path catch below is a user-triggered save, unaffected.
        reportError("Couldn't load your saved colour-by preference.", e);
        if (!cancelled) setSavedColourBy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = savedColourBy === undefined;
  const colourBy = savedColourBy ?? 'none';

  const setColourBy = useCallback(
    (mode: LandscapeColourByMode) => {
      setSavedColourBy(mode);
      if (userId) {
        upsertUserPreferences(supabase, { userId, landscapeColourBy: mode }).catch(() => {
          // Best-effort, same stance as useColourByPreference.ts's own setColourBy.
        });
      }
    },
    [userId],
  );

  return { colourBy, loading, setColourBy };
}
