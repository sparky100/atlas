/**
 * Theme/density preference resolution — the one piece of logic shared
 * between index.html's inline before-paint script (plain JS, no imports
 * possible there) and ThemeProvider (this file, imported and unit-tested).
 * Keep them in sync by hand if you ever change this; preferences.test.ts
 * pins the exact algorithm so a drift shows up as a failing test rather
 * than a flash-of-wrong-theme bug found by a person.
 *
 * Sprint U1 step 2a wires `user_preferences` (SPEC §3.2) as the source of
 * truth when signed in; localStorage stays as the pre-paint cache the
 * inline script reads (a network fetch can't complete before first paint).
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export type DensityPreference = 'comfortable' | 'compact';

export const THEME_STORAGE_KEY = 'atlas:theme';
export const DENSITY_STORAGE_KEY = 'atlas:density';

export const DEFAULT_THEME: ThemePreference = 'system';
export const DEFAULT_DENSITY: DensityPreference = 'comfortable';

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function isDensityPreference(value: string | null): value is DensityPreference {
  return value === 'comfortable' || value === 'compact';
}

/** Reads localStorage defensively — private-mode/disabled storage throws, and that's not an error worth surfacing (falls back to the documented defaults, SPEC §3.2). */
export function readStoredThemePreference(storage: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const stored = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function readStoredDensityPreference(storage: Pick<Storage, 'getItem'>): DensityPreference {
  try {
    const stored = storage.getItem(DENSITY_STORAGE_KEY);
    return isDensityPreference(stored) ? stored : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

export function applyThemeAttributes(root: Pick<HTMLElement, 'setAttribute'>, preference: ThemePreference, resolved: ResolvedTheme): void {
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-preference', preference);
}

export function applyDensityAttribute(root: Pick<HTMLElement, 'setAttribute'>, density: DensityPreference): void {
  root.setAttribute('data-density', density);
}
