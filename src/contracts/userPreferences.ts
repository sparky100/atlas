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

/**
 * Sprint U4-1 C4's "remember last choice per user" — the capability map's
 * colour-by mode. Canonical here, not in `src/ui/capabilityMap/metrics.ts`
 * (which re-exports it as `ColourByMode`, unchanged, so its own two
 * existing callers don't need to change), the same "contracts is the one
 * source of truth" reasoning `HomeMode`/`DensityPreference`/`ThemePreference`
 * already establish for this table's other columns — a UI-layer file
 * shouldn't be what a storage contract depends on.
 */
export const CAPABILITY_MAP_COLOUR_BY_MODES = ['none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality'] as const;
export type CapabilityMapColourByMode = (typeof CAPABILITY_MAP_COLOUR_BY_MODES)[number];

/**
 * Prompt 7k item 1: the landscape's own colour-by mode — a sibling column,
 * not a second value crammed into `capabilityMapColourBy`, since the two
 * canvases can show different modes at once (a landscape tile is a
 * system; a capability-map tile is a capability, whose own "criticality"
 * is a worst-of aggregate over its supporting systems — the same value,
 * read two different ways, per `src/ui/capabilityMap/metrics.ts`'s own
 * module comment on why `hostingModel` colour-by is landscape-only:
 * hosting model has no "worst of" a capability could aggregate to).
 */
export const LANDSCAPE_COLOUR_BY_MODES = ['none', 'metric:criticality', 'metric:hostingModel'] as const;
export type LandscapeColourByMode = (typeof LANDSCAPE_COLOUR_BY_MODES)[number];

export const DEFAULT_DENSITY: DensityPreference = 'comfortable';
export const DEFAULT_THEME: ThemePreference = 'system';

/** The wire shape — camelCase, as the UI and its tests use it. */
export interface UserPreferences {
  userId: UUID;
  homeMode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  /**
   * `null` — the common case — means no explicit choice has ever been
   * saved: the capability map computes a model-aware default instead
   * (`src/ui/capabilityMap/metrics.ts`'s `resolveDefaultColourBy`: exposure
   * for a director, coverage for an architect, "none" while the model has
   * no systems at all). Unlike `density`/`theme`, this can't be a single
   * fixed `not null default` — the right default genuinely depends on
   * context this table alone doesn't have — so it's nullable instead,
   * deliberately, not an oversight.
   */
  capabilityMapColourBy: CapabilityMapColourByMode | null;
  /**
   * `null` means no explicit choice has ever been saved, same reasoning as
   * `capabilityMapColourBy` — the landscape has no model-aware default to
   * fall back to yet (Prompt 7k item 1 ships only `'none'` as the
   * behaviour when unset), but the column is nullable for the same
   * "context this table alone doesn't have" reason, not because a default
   * is pending.
   */
  landscapeColourBy: LandscapeColourByMode | null;
  /** ISO 8601 timestamp; DB-assigned, never client-chosen. */
  updatedAt: string;
}

/** The literal shape of a row in `user_preferences` (SPEC §3.2). */
export interface UserPreferencesRow {
  user_id: UUID;
  home_mode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  capability_map_colour_by: CapabilityMapColourByMode | null;
  landscape_colour_by: LandscapeColourByMode | null;
  updated_at: string;
}

export function toUserPreferencesRow(prefs: UserPreferences): UserPreferencesRow {
  return {
    user_id: prefs.userId,
    home_mode: prefs.homeMode,
    density: prefs.density,
    theme: prefs.theme,
    capability_map_colour_by: prefs.capabilityMapColourBy,
    landscape_colour_by: prefs.landscapeColourBy,
    updated_at: prefs.updatedAt,
  };
}

export function fromUserPreferencesRow(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    homeMode: row.home_mode,
    density: row.density,
    theme: row.theme,
    capabilityMapColourBy: row.capability_map_colour_by,
    landscapeColourBy: row.landscape_colour_by,
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
 * `capabilityMapColourBy: null` for the same reason — no saved row means
 * no saved override, full stop.
 */
export function defaultUserPreferences(userId: UUID, isOwnerOrArchitect: boolean): UserPreferences {
  return {
    userId,
    homeMode: isOwnerOrArchitect ? 'architect' : 'director',
    density: DEFAULT_DENSITY,
    theme: DEFAULT_THEME,
    capabilityMapColourBy: null,
    landscapeColourBy: null,
    updatedAt: new Date(0).toISOString(),
  };
}
