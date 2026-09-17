import { useCallback, useEffect, useState } from 'react';
import type { UUID } from '../../../contracts/delta';
import { getUserPreferences, upsertUserPreferences } from '../../../db/userPreferences';
import { reportError } from '../../errors/errorBannerStore';
import { supabase } from '../../supabaseClient';

export interface UseInspectorCollapsedPreferenceResult {
  /** The saved resting state — `false` (open) until a user has ever collapsed it, same "no row yet" default `defaultUserPreferences` gives. */
  collapsed: boolean;
  loading: boolean;
  setCollapsed: (value: boolean) => void;
}

/**
 * V2b: the shared Inspector panel's own collapsed/expanded resting state,
 * remembered per user — same load-then-write shape every other
 * `use*Preference` hook in this codebase already follows
 * (`useLandscapeColourByPreference.ts`'s own module comment names it as
 * the template). One preference for every view the Inspector appears in
 * (Landscape first, `LandscapePage.tsx`; Capability map and Context to
 * follow), not per-view — `inspector_collapsed`'s own migration comment
 * explains why a single shared column is the right scope.
 */
export function useInspectorCollapsedPreference(userId: UUID | null): UseInspectorCollapsedPreferenceResult {
  const [saved, setSaved] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setSaved(false);
      return;
    }
    let cancelled = false;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!cancelled) setSaved(row?.inspector_collapsed ?? false);
      })
      .catch((e: unknown) => {
        reportError("Couldn't load your saved inspector panel state.", e);
        if (!cancelled) setSaved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = saved === undefined;
  const collapsed = saved ?? false;

  const setCollapsed = useCallback(
    (value: boolean) => {
      setSaved(value);
      if (userId) {
        upsertUserPreferences(supabase, { userId, inspectorCollapsed: value }).catch(() => {
          // Best-effort, same stance as useLandscapeColourByPreference.ts's own setColourBy.
        });
      }
    },
    [userId],
  );

  return { collapsed, loading, setCollapsed };
}
