/**
 * Atlas's first cross-org role — see `platform_admins`' own migration
 * comment (`supabase/migrations/20260917030000_platform_admin.sql`) for
 * the full design reasoning. `platform_admins_select_self`'s RLS only
 * ever lets a caller see their own row, so this is the one query a client
 * can meaningfully make against this table.
 */
import type { Client } from './client';
import type { UUID } from '../contracts/delta';

/** Same shape as `organisations.ts`'s `getMyMembership` — a plain, RLS-scoped table read, not an RPC. */
export async function isPlatformAdmin(supabase: Client, userId: UUID): Promise<boolean> {
  const { data, error } = await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`isPlatformAdmin: ${error.message}`);
  return data !== null;
}
