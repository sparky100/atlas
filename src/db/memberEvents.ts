/**
 * F7 item 5: membership audit — read-only. Every row is written by
 * `20260916030000_member_events.sql`'s own five triggers; there is nothing
 * else for this module to do (no insert/update/delete grant exists for
 * `authenticated` at all).
 */
import type { Client } from './client';
import type { MemberEventRow } from './types';
import type { UUID } from '../contracts/delta';

/** Owner-only (`member_events_select`'s RLS) — reverse-chronological, matching the audit panel's own display order. */
export async function listMemberEvents(supabase: Client, orgId: UUID): Promise<MemberEventRow[]> {
  const { data, error } = await supabase.from('member_events').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw new Error(`listMemberEvents: ${error.message}`);
  return (data as MemberEventRow[] | null) ?? [];
}
