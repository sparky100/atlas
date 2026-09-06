import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getUserPreferences, upsertUserPreferences } from '../../db/userPreferences';
import { supabase } from '../supabaseClient';
import {
  applyDensityAttribute,
  applyThemeAttributes,
  DENSITY_STORAGE_KEY,
  readStoredDensityPreference,
  readStoredThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type DensityPreference,
  type ThemePreference,
} from './preferences';
import { ThemeContext, type ThemeContextValue } from './themeContext';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Best-effort write; a full storage quota or a private-mode throw shouldn't break the toggle it's backing. */
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // See preferences.ts's read-side comment: not worth surfacing.
  }
}

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * The signed-in user's id, or `null` when signed out / not yet resolved.
   * When set, `user_preferences` (SPEC §3.2) becomes the source of truth:
   * loaded once per sign-in and reconciled into local state, and every
   * `setTheme`/`setDensity` call also persists there. When `null`,
   * behaviour is exactly step 1's — localStorage only, no network call.
   */
  userId?: string | null;
}

/**
 * Owns `data-theme`/`data-density` on `<html>` after the app has mounted.
 * Before mount, index.html's inline script already set both from
 * localStorage (no-flash) — this provider reads that same source on init
 * so its state matches what's already on the page, then takes over.
 *
 * `useTheme` lives in its own file (useTheme.ts), not exported from here —
 * keeps this a component-only module for Vite's fast-refresh boundary.
 */
export function ThemeProvider({ children, userId = null }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredThemePreference(localStorage));
  const [density, setDensityState] = useState<DensityPreference>(() => readStoredDensityPreference(localStorage));
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setPrefersDark(media.matches);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(theme, prefersDark), [theme, prefersDark]);

  useEffect(() => {
    applyThemeAttributes(document.documentElement, theme, resolvedTheme);
  }, [theme, resolvedTheme]);

  useEffect(() => {
    applyDensityAttribute(document.documentElement, density);
  }, [density]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      writeStorage(THEME_STORAGE_KEY, next);
      if (userId) {
        upsertUserPreferences(supabase, { userId, theme: next }).catch(() => {
          // Best-effort: the local/localStorage state (already updated
          // above) is what the UI shows regardless. A sync failure here
          // means the *next device* won't see it yet, not that this one
          // silently reverted.
        });
      }
    },
    [userId],
  );

  const setDensity = useCallback(
    (next: DensityPreference) => {
      setDensityState(next);
      writeStorage(DENSITY_STORAGE_KEY, next);
      if (userId) {
        upsertUserPreferences(supabase, { userId, density: next }).catch(() => {
          // See setTheme's comment.
        });
      }
    },
    [userId],
  );

  // On sign-in, user_preferences becomes the source of truth: load once per
  // userId and reconcile local state + the localStorage cache to match it.
  // No row yet ("created on first change", SPEC §3.2) means nothing to
  // reconcile — local defaults stand until the user changes something.
  const loadedForUserId = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || loadedForUserId.current === userId) return;
    loadedForUserId.current = userId;
    getUserPreferences(supabase, userId)
      .then((row) => {
        if (!row) return;
        setThemeState(row.theme);
        setDensityState(row.density);
        writeStorage(THEME_STORAGE_KEY, row.theme);
        writeStorage(DENSITY_STORAGE_KEY, row.density);
      })
      .catch(() => {
        // Network/RLS failure: fall back to whatever localStorage/defaults
        // already resolved to above, rather than blocking the UI on it.
      });
  }, [userId]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, density, setTheme, setDensity }),
    [theme, resolvedTheme, density, setTheme, setDensity],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
