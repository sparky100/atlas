/**
 * `atlas.profiles` repository operations. Lives in the `atlas` schema, not
 * `public` (supabase/migrations/20260906230000_profiles.sql's own module
 * comment) — every call below goes through `.schema('atlas')`, the same
 * override src/db/commits.ts's module comment already documents for every
 * atlas.* RPC. A profile row is created automatically by
 * `atlas.ensure_profile` on first membership; there is no `createProfile`
 * here because a client never inserts one.
 *
 * Commit and comment author display reads these — `author_id` on a
 * `commits`/`comments` row is a bare uuid with nothing human-readable of
 * its own; resolving it to a handle/display name always goes through this
 * module, never a raw join against `auth.users` (which RLS never exposes to
 * a client at all).
 */
import type { UUID } from '../contracts/delta';
import { assertInFilterSize } from './inFilterLimit';
import type { Client } from './client';
import type { ProfileRow } from './types';

/** One user's profile, or `null` if — impossible in practice past first membership, but a caller shouldn't have to trust that — no row exists yet. */
export async function getProfile(supabase: Client, userId: UUID): Promise<ProfileRow | null> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`getProfile: ${error.message}`);
  return (data as ProfileRow | null) ?? null;
}

/**
 * Every profile in `userIds`, for resolving a batch of commit/comment
 * authors at once. `userIds` is bounded by however many distinct authors
 * appear on one page (SPEC §6.7) — call sites must not let this list grow
 * with the model itself.
 */
export async function listProfilesByIds(supabase: Client, userIds: readonly UUID[]): Promise<ProfileRow[]> {
  if (userIds.length === 0) return [];
  assertInFilterSize('listProfilesByIds', 'user_id', userIds);
  const { data, error } = await supabase.schema('atlas').from('profiles').select('*').in('user_id', userIds as UUID[]);
  if (error) throw new Error(`listProfilesByIds: ${error.message}`);
  return (data as ProfileRow[] | null) ?? [];
}

export interface UpdateMyProfileInput {
  userId: UUID;
  displayName?: string | null;
  /** Must already satisfy `atlas.profiles`' own `profiles_handle_format`/`profiles_handle_unique` constraints (lowercase, `[a-z0-9_-]+`, globally unique) — `isValidHandle` (src/contracts/comments.ts) checks the format client-side; the database still re-checks both on write. */
  handle?: string;
  avatarUrl?: string | null;
}

/** Editable by the user only (RLS): `user_id = auth.uid()` is enforced server-side regardless of what `input.userId` says, so a stale or wrong id here fails the update rather than silently editing someone else's row. */
export async function updateMyProfile(supabase: Client, input: UpdateMyProfileInput): Promise<ProfileRow> {
  const patch: Record<string, unknown> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.handle !== undefined) patch.handle = input.handle;
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.schema('atlas').from('profiles').update(patch).eq('user_id', input.userId).select('*').single();
  if (error) throw new Error(`updateMyProfile: ${error.message}`);
  return data as ProfileRow;
}
