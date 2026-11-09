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

/** Where the app opens when a person enters a model. `home` is the Overview / My work page (its own switch, `HomeMode`, still decides which of the two it shows). */
export const START_PAGES = ['home', 'capability-map', 'landscape'] as const;
export type StartPage = (typeof START_PAGES)[number];

/**
 * The start page when none has been saved: owners and architects — the people who maintain the model — start on Home; everyone else (contributors and viewers, who mostly read it) starts on the capability map. Pure, so the same rule is used by the redirect and by the settings screen.
 */
export function resolveStartPage(saved: StartPage | null, isOwnerOrArchitect: boolean): StartPage {
  return saved ?? (isOwnerOrArchitect ? 'home' : 'capability-map');
}

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
export const CAPABILITY_MAP_COLOUR_BY_MODES = ['none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare', 'metric:fitForPurpose', 'metric:disposition'] as const;
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
export const LANDSCAPE_COLOUR_BY_MODES = ['none', 'metric:criticality', 'metric:hostingModel', 'metric:domain'] as const;
export type LandscapeColourByMode = (typeof LANDSCAPE_COLOUR_BY_MODES)[number];

/**
 * V2 "landscape focus and filters", decision 1 (UI-principles.md §10): a
 * lane's own collapse state is a two-directional override, not a single
 * "collapsed set" — a lane with no members defaults to collapsed, a lane
 * with members defaults to expanded (`src/ui/landscape/layout.ts`'s own
 * `isLaneCollapsed`), and a user can override either default in either
 * direction. Two arrays record that: a key here means "force collapsed
 * regardless of this lane's own default"; `landscapeExpandedLaneKeys`'
 * own doc comment is the mirror image. `null` — the common case — means no
 * override has ever been saved for any lane, same "no saved row, no saved
 * choice" reasoning `landscapeColourBy` already uses.
 */
export type LandscapeLaneKeyList = readonly string[];

export const DEFAULT_DENSITY: DensityPreference = 'comfortable';
export const DEFAULT_THEME: ThemePreference = 'system';

/** The wire shape — camelCase, as the UI and its tests use it. */
export interface UserPreferences {
  userId: UUID;
  homeMode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  /** `null` means no choice saved yet — `resolveStartPage` derives the default from the person's role, the same "context this table alone doesn't have" reasoning as `capabilityMapColourBy`. */
  startPage: StartPage | null;
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
  /** V2: see `LandscapeLaneKeyList`'s own doc comment. Force-collapsed lane keys. */
  landscapeCollapsedLaneKeys: LandscapeLaneKeyList | null;
  /** V2: see `LandscapeLaneKeyList`'s own doc comment. Force-expanded lane keys. */
  landscapeExpandedLaneKeys: LandscapeLaneKeyList | null;
  /**
   * V2: pinned lane keys, in the user's own chosen display order — array
   * order *is* display order among pinned lanes (`layout.ts`'s own pin
   * sort tier). `null` means nothing pinned; every lane then keeps
   * `layout.ts`'s existing `laneSortKey` order unchanged.
   */
  landscapePinnedLaneKeys: LandscapeLaneKeyList | null;
  /**
   * Hidden lane keys — a lane in this set is dropped from layout entirely
   * (no header line, no reference chips), unlike `landscapeCollapsedLaneKeys`
   * which still leaves the header/chips on the canvas. A single set, not a
   * two-directional override pair: there's no "empty defaults to X"
   * ambiguity for hide the way there is for collapse (`isLaneCollapsed`'s
   * own emptiness default), so one array is enough. `null` means nothing
   * hidden.
   */
  landscapeHiddenLaneKeys: LandscapeLaneKeyList | null;
  /**
   * Sprint F7 item 3: whether an @mention creates an in-app notification
   * for this user — always a real boolean (`not null default true`),
   * never nullable like the colour-by/lane-key fields above, since there's
   * no context-dependent default to compute: "notify" is the sensible
   * default for everyone until they say otherwise.
   */
  notifyOnMention: boolean;
  /** Sprint F7 item 3: same as `notifyOnMention`, for a reply-to-a-thread notification. */
  notifyOnReply: boolean;
  /**
   * Sprint F7 item 3 follow-up: same shape, for F3a's `review_assigned`
   * notification kind — added once F3a's review-verdict mechanism actually
   * shipped (it hadn't yet when `notifyOnMention`/`notifyOnReply` were
   * first added, hence the separate migration).
   */
  notifyOnReviewAssigned: boolean;
  /**
   * V2b: the shared Inspector panel's (`src/ui/components/Inspector`)
   * resting collapse state — see the migration's own column comment
   * (`20260917040000_inspector_collapsed_preference.sql`) for why this is
   * a plain `not null default false` rather than nullable like the
   * colour-by fields: there's no model-aware default to compute, "open"
   * is simply the sensible starting point for everyone.
   */
  inspectorCollapsed: boolean;
  /** ISO 8601 timestamp; DB-assigned, never client-chosen. */
  updatedAt: string;
}

/** The literal shape of a row in `user_preferences` (SPEC §3.2). */
export interface UserPreferencesRow {
  user_id: UUID;
  home_mode: HomeMode;
  density: DensityPreference;
  theme: ThemePreference;
  start_page: StartPage | null;
  capability_map_colour_by: CapabilityMapColourByMode | null;
  landscape_colour_by: LandscapeColourByMode | null;
  landscape_collapsed_lane_keys: LandscapeLaneKeyList | null;
  landscape_expanded_lane_keys: LandscapeLaneKeyList | null;
  landscape_pinned_lane_keys: LandscapeLaneKeyList | null;
  landscape_hidden_lane_keys: LandscapeLaneKeyList | null;
  notify_on_mention: boolean;
  notify_on_reply: boolean;
  notify_on_review_assigned: boolean;
  inspector_collapsed: boolean;
  updated_at: string;
}

export function toUserPreferencesRow(prefs: UserPreferences): UserPreferencesRow {
  return {
    user_id: prefs.userId,
    home_mode: prefs.homeMode,
    density: prefs.density,
    theme: prefs.theme,
    start_page: prefs.startPage,
    capability_map_colour_by: prefs.capabilityMapColourBy,
    landscape_colour_by: prefs.landscapeColourBy,
    landscape_collapsed_lane_keys: prefs.landscapeCollapsedLaneKeys,
    landscape_expanded_lane_keys: prefs.landscapeExpandedLaneKeys,
    landscape_pinned_lane_keys: prefs.landscapePinnedLaneKeys,
    landscape_hidden_lane_keys: prefs.landscapeHiddenLaneKeys,
    notify_on_mention: prefs.notifyOnMention,
    notify_on_reply: prefs.notifyOnReply,
    notify_on_review_assigned: prefs.notifyOnReviewAssigned,
    inspector_collapsed: prefs.inspectorCollapsed,
    updated_at: prefs.updatedAt,
  };
}

export function fromUserPreferencesRow(row: UserPreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    homeMode: row.home_mode,
    density: row.density,
    theme: row.theme,
    startPage: row.start_page,
    capabilityMapColourBy: row.capability_map_colour_by,
    landscapeColourBy: row.landscape_colour_by,
    landscapeCollapsedLaneKeys: row.landscape_collapsed_lane_keys,
    landscapeExpandedLaneKeys: row.landscape_expanded_lane_keys,
    landscapePinnedLaneKeys: row.landscape_pinned_lane_keys,
    landscapeHiddenLaneKeys: row.landscape_hidden_lane_keys,
    notifyOnMention: row.notify_on_mention,
    notifyOnReply: row.notify_on_reply,
    notifyOnReviewAssigned: row.notify_on_review_assigned,
    inspectorCollapsed: row.inspector_collapsed,
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
    startPage: null,
    capabilityMapColourBy: null,
    landscapeColourBy: null,
    landscapeCollapsedLaneKeys: null,
    landscapeExpandedLaneKeys: null,
    landscapePinnedLaneKeys: null,
    landscapeHiddenLaneKeys: null,
    notifyOnMention: true,
    notifyOnReply: true,
    notifyOnReviewAssigned: true,
    inspectorCollapsed: false,
    updatedAt: new Date(0).toISOString(),
  };
}
