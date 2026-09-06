/**
 * Per-person UI preferences (SPEC-data-model.md §3.2, UI-principles.md §3 /
 * §10 decision 1). Keyed on the user, not the membership — these follow a
 * person across organisations, unlike everything else in this product,
 * which is org-scoped (§2's `org_id` convention explicitly excludes this
 * table and `organisations` itself).
 *
 * Wire ↔ storage mapping only (matching rows.ts's delta/commit contracts):
 * no I/O, no validation beyond constructing a well-typed value.
 */

import type { UUID } from './delta';

export const HOME_MODES = ['director', 'architect'] as const;
export type HomeMode = (typeof HOME_MODES)[number];

export const DENSITY_PREFERENCES = ['comfortable', 'compact'] as const;
export type DensityPreference = (typeof DENSITY_PREFERENCES)[number];

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_DENSITY: DensityPreference = 'comfortable';
export const DEFAULT_THEME: ThemePreference = 'system';

/** The wire shape — camelCase, as the UI and its tests use it. */
export interface UserPreferences {
  userId: UUID;
  homeMode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  /** ISO 8601 timestamp; DB-assigned, never client-chosen. */
  updatedAt: string;
}

/** The literal shape of a row in `user_preferences` (SPEC §3.2). */
export interface UserPreferencesRow {
  user_id: UUID;
  home_mode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  updated_at: string;
}

export function toUserPreferencesRow(prefs: UserPreferences): UserPreferencesRow {
  return {
    user_id: prefs.userId,
    home_mode: prefs.homeMode,
    density: prefs.density,
    theme: prefs.theme,
    updated_at: prefs.updatedAt,
  };
}

export function fromUserPreferencesRow(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    homeMode: row.home_mode,
    density: row.density,
    theme: row.theme,
    updatedAt: row.updated_at,
  };
}

/**
 * SPEC §3.2's documented default when no row exists yet ("the row is
 * created on first change, not on sign-up"): architect door for
 * owner/architect members, director door otherwise (UI-principles §3).
 * `updatedAt` is a placeholder — a value never actually read from a
 * pretend row, only used so callers have a complete `UserPreferences` to
 * render against before any preference has ever been saved.
 */
export function defaultUserPreferences(userId: UUID, isOwnerOrArchitect: boolean): UserPreferences {
  return {
    userId,
    homeMode: isOwnerOrArchitect ? 'architect' : 'director',
    density: DEFAULT_DENSITY,
    theme: DEFAULT_THEME,
    updatedAt: new Date(0).toISOString(),
  };
}
