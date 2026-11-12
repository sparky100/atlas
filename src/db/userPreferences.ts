/**
 * user_preferences repository operations. Thin, typed wrappers — see
 * branches.ts/tags.ts's module comment for the untyped-client
 * `eslint-disable` boundary this follows.
 */
import type { UserPreferencesRow } from '../contracts/userPreferences';
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

export async function getUserPreferences(supabase: Client, userId: UUID): Promise<UserPreferencesRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('user_preferences').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`getUserPreferences: ${error.message}`);
  return data as UserPreferencesRow | null;
}

export interface UpsertUserPreferencesInput {
  userId: UUID;
  homeMode?: UserPreferencesRow['home_mode'];
  density?: UserPreferencesRow['density'];
  theme?: UserPreferencesRow['theme'];
  /** Where the app opens — same omitted-leaves-untouched convention. */
  startPage?: UserPreferencesRow['start_page'];
  /** Sprint U4-1 C4's "remember last choice per user" — omitted (not `null`) leaves any previously-saved choice untouched; a caller that wants to explicitly reset it back to "no override" would need a different signature, which nothing today needs. */
  capabilityMapColourBy?: UserPreferencesRow['capability_map_colour_by'];
  /** Prompt 7k item 1: the landscape's own colour-by mode — same omitted-leaves-untouched convention as `capabilityMapColourBy`. */
  landscapeColourBy?: UserPreferencesRow['landscape_colour_by'];
  /** V2: force-collapsed lane keys — same omitted-leaves-untouched convention. */
  landscapeCollapsedLaneKeys?: UserPreferencesRow['landscape_collapsed_lane_keys'];
  /** V2: force-expanded lane keys — same omitted-leaves-untouched convention. */
  landscapeExpandedLaneKeys?: UserPreferencesRow['landscape_expanded_lane_keys'];
  /** V2: pinned lane keys, in display order — same omitted-leaves-untouched convention. */
  landscapePinnedLaneKeys?: UserPreferencesRow['landscape_pinned_lane_keys'];
  /** Hidden lane keys — same omitted-leaves-untouched convention. */
  landscapeHiddenLaneKeys?: UserPreferencesRow['landscape_hidden_lane_keys'];
  /** Sprint F7 item 3 — same omitted-leaves-untouched convention. */
  notifyOnMention?: UserPreferencesRow['notify_on_mention'];
  /** Sprint F7 item 3 — same omitted-leaves-untouched convention. */
  notifyOnReply?: UserPreferencesRow['notify_on_reply'];
  /** Sprint F7 item 3 follow-up (F3a's `review_assigned` kind) — same omitted-leaves-untouched convention. */
  notifyOnReviewAssigned?: UserPreferencesRow['notify_on_review_assigned'];
  /** Review-assigned email opt-out — same omitted-leaves-untouched convention. */
  emailOnReviewAssigned?: UserPreferencesRow['email_on_review_assigned'];
  /** Stale-data nudge email opt-out — same omitted-leaves-untouched convention. */
  emailOnStaleNudge?: UserPreferencesRow['email_on_stale_nudge'];
  /** V2b: the shared Inspector panel's own collapsed state — same omitted-leaves-untouched convention. */
  inspectorCollapsed?: UserPreferencesRow['inspector_collapsed'];
}

/**
 * Creates the row on first change or merges into an existing one (SPEC
 * §3.2: "the row is created on first change, not on sign-up") — an upsert,
 * not a plain update, since most users will never have a row until they
 * touch a preference for the first time.
 */
export async function upsertUserPreferences(supabase: Client, input: UpsertUserPreferencesInput): Promise<UserPreferencesRow> {
  const patch: Record<string, unknown> = { user_id: input.userId };
  if (input.homeMode !== undefined) patch.home_mode = input.homeMode;
  if (input.density !== undefined) patch.density = input.density;
  if (input.theme !== undefined) patch.theme = input.theme;
  if (input.startPage !== undefined) patch.start_page = input.startPage;
  if (input.capabilityMapColourBy !== undefined) patch.capability_map_colour_by = input.capabilityMapColourBy;
  if (input.landscapeColourBy !== undefined) patch.landscape_colour_by = input.landscapeColourBy;
  if (input.landscapeCollapsedLaneKeys !== undefined) patch.landscape_collapsed_lane_keys = input.landscapeCollapsedLaneKeys;
  if (input.landscapeExpandedLaneKeys !== undefined) patch.landscape_expanded_lane_keys = input.landscapeExpandedLaneKeys;
  if (input.landscapePinnedLaneKeys !== undefined) patch.landscape_pinned_lane_keys = input.landscapePinnedLaneKeys;
  if (input.landscapeHiddenLaneKeys !== undefined) patch.landscape_hidden_lane_keys = input.landscapeHiddenLaneKeys;
  if (input.notifyOnMention !== undefined) patch.notify_on_mention = input.notifyOnMention;
  if (input.notifyOnReply !== undefined) patch.notify_on_reply = input.notifyOnReply;
  if (input.notifyOnReviewAssigned !== undefined) patch.notify_on_review_assigned = input.notifyOnReviewAssigned;
  if (input.emailOnReviewAssigned !== undefined) patch.email_on_review_assigned = input.emailOnReviewAssigned;
  if (input.emailOnStaleNudge !== undefined) patch.email_on_stale_nudge = input.emailOnStaleNudge;
  if (input.inspectorCollapsed !== undefined) patch.inspector_collapsed = input.inspectorCollapsed;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('user_preferences').upsert(patch, { onConflict: 'user_id' }).select('*').single();
  if (error) throw new Error(`upsertUserPreferences: ${error.message}`);
  return data as UserPreferencesRow;
}
