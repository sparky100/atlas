/**
 * Comment/mention pure logic worth testing without a database (SPEC §3.8
 * amendment, ADR-010 amendment — see
 * supabase/migrations/20260906240000_comments.sql's own module comment for
 * what changed from the original draft). Row shapes for the tables
 * themselves live in `src/db/types.ts`, not here — same split
 * `db/types.ts`'s own module comment already draws for organisations/
 * models/branches/tags (tenancy and workflow shapes `src/contracts` has no
 * reason to know about). src/contracts has no I/O, per CLAUDE.md —
 * everything here is a pure function.
 */

/** ADR-024 adds `project` (`20261002010000_anchor_type_project.sql`) — a project page's own thread. */
export type AnchorType = 'element' | 'relationship' | 'change' | 'decision' | 'version' | 'project';
export type CommentStatus = 'open' | 'resolved';
/** Sprint M1b adds `reply` (`supabase/migrations/20260906340000_notification_kind_reply.sql`/`20260906350000_comment_reply_notifications.sql`) — a reply notifies its thread's other participants, not just an @handle. F3a adds `review_assigned` (`supabase/migrations/20260914070000_notification_kind_review_assigned.sql`) — a review-assignment notification names a merge request (`notifications.merge_request_id`), not a comment. */
export type NotificationKind = 'mention' | 'reply' | 'review_assigned';

/** `atlas.profiles.handle`'s allowed charset — lowercase, matching the table's own CHECK constraint. */
const HANDLE_CHARSET = /^[a-z0-9_-]+$/;

export function isValidHandle(handle: string): boolean {
  return HANDLE_CHARSET.test(handle);
}

/**
 * Extracts the lowercased, deduplicated set of `@handle` tokens from a
 * comment body — the same pattern `atlas.process_comment_mentions`
 * (supabase/migrations/20260906240000_comments.sql) uses server-side, kept
 * in sync by this file's own round-trip test. A client can predict exactly
 * which members a body will notify before it's ever sent; the server's
 * parse is still the one that actually happens, this is a read-only preview
 * of it (e.g. for a "you're about to notify: ..." confirmation), not a
 * second enforcement point.
 */
export function parseMentionHandles(body: string): string[] {
  const matches = body.matchAll(/@([a-zA-Z0-9_-]+)/g);
  const handles = new Set<string>();
  for (const match of matches) {
    const handle = match[1];
    if (handle) handles.add(handle.toLowerCase());
  }
  return [...handles];
}

/** A thread's root never has `parent_comment_id` set (ADR-010's flat reply chain). */
export function isRootComment(comment: { parent_comment_id: string | null }): boolean {
  return comment.parent_comment_id === null;
}
