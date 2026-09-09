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
  /** Sprint U4-1 C4's "remember last choice per user" — omitted (not `null`) leaves any previously-saved choice untouched; a caller that wants to explicitly reset it back to "no override" would need a different signature, which nothing today needs. */
  capabilityMapColourBy?: UserPreferencesRow['capability_map_colour_by'];
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
  if (input.capabilityMapColourBy !== undefined) patch.capability_map_colour_by = input.capabilityMapColourBy;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('user_preferences').upsert(patch, { onConflict: 'user_id' }).select('*').single();
  if (error) throw new Error(`upsertUserPreferences: ${error.message}`);
  return data as UserPreferencesRow;
}
