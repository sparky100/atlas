import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
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

/**
 * Owns `data-theme`/`data-density` on `<html>` after the app has mounted.
 * Before mount, index.html's inline script already set both from
 * localStorage (no-flash) — this provider reads that same source on init
 * so its state matches what's already on the page, then takes over.
 *
 * Sprint U1 step 2a extends this: when signed in, `user_preferences`
 * becomes the source of truth (loaded once, reconciled here, and written
 * through to localStorage so the inline script still has a same-origin
 * cache for the *next* load's before-paint read). Nothing in this file's
 * shape needs to change for that — it gains a load + a persist call.
 *
 * `useTheme` lives in its own file (useTheme.ts), not exported from here —
 * keeps this a component-only module for Vite's fast-refresh boundary.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
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

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeStorage(THEME_STORAGE_KEY, next);
  }, []);

  const setDensity = useCallback((next: DensityPreference) => {
    setDensityState(next);
    writeStorage(DENSITY_STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, density, setTheme, setDensity }),
    [theme, resolvedTheme, density, setTheme, setDensity],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
