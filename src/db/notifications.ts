/**
 * `notifications` repository operations (Sprint M1a — @mentions only,
 * in-app, no email; supabase/migrations/20260906240000_comments.sql). A
 * row is written only by `atlas.process_comment_mentions`; nothing here
 * ever inserts one. This sprint's own scope decision (asked and answered)
 * is an unread count only — no inbox list UI yet — but `listMyNotifications`
 * is still built and tested here since the count is just `length` of the
 * unread subset of the same query a future inbox would use.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';
import type { NotificationRow } from './types';

export interface ListMyNotificationsOptions {
  /** Defaults to false — every notification, not just unread ones. */
  unreadOnly?: boolean;
}

/** RLS (`notifications_select`) already restricts this to the caller's own rows — `userId` here is for the `.eq()` filter, not the authorization. */
export async function listMyNotifications(supabase: Client, userId: UUID, options: ListMyNotificationsOptions = {}): Promise<NotificationRow[]> {
  let query = supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (options.unreadOnly) query = query.is('read_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`listMyNotifications: ${error.message}`);
  return (data as NotificationRow[] | null) ?? [];
}

/** The number shown in the unread badge (SPEC §11's "notification tray UI, target U4" — this sprint ships only the count). */
export async function getUnreadNotificationCount(supabase: Client, userId: UUID): Promise<number> {
  const { count, error } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null);
  if (error) throw new Error(`getUnreadNotificationCount: ${error.message}`);
  return count ?? 0;
}

/** Marks one notification read. RLS restricts this to the notification's own recipient. */
export async function markNotificationRead(supabase: Client, notificationId: UUID): Promise<NotificationRow> {
  const patch = { read_at: new Date().toISOString() };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see branches.ts's module comment.
  const { data, error } = await supabase.from('notifications').update(patch).eq('id', notificationId).select('*').single();
  if (error) throw new Error(`markNotificationRead: ${error.message}`);
  return data as NotificationRow;
}
