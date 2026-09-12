import { formatRelativeTime } from '../time';
import type { AnchorType, NotificationKind, ViewKind } from '../../db/types';

const BODY_TRUNCATE_LENGTH = 80;

/** A notification row's own body preview (Sprint M1b, `docs/HANDOFF-M1b-comments.md`'s 6c: "the comment body (truncated with '…' when clipped)"). */
export function truncateNotificationBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.length <= BODY_TRUNCATE_LENGTH ? trimmed : `${trimmed.slice(0, BODY_TRUNCATE_LENGTH)}…`;
}

/** "X mentioned you" / "X replied to your thread" — kind-dependent (the handoff's own 6c), now that `notification_kind` has both values (Sprint M1b step 1). */
export function notificationKindWording(kind: NotificationKind, authorName: string): string {
  return kind === 'mention' ? `${authorName} mentioned you` : `${authorName} replied to your thread`;
}

/**
 * The anchor stated in words — "Northgate Revenues · element · landscape ·
 * 2d" (the handoff's own example). `subjectName` falls back to a plain
 * `"a {anchorType}"` when unresolved (`useNotificationTray.ts`'s own
 * deep-link scope comment: only `element` anchors resolve a real name this
 * sprint), and `viewKind` is simply omitted when the comment doesn't carry
 * one.
 */
export function notificationAnchorWords(subjectName: string | undefined, anchorType: AnchorType, viewKind: ViewKind | null, now: Date, createdAt: string): string {
  const parts = [subjectName ?? `a ${anchorType}`, anchorType];
  if (viewKind) parts.push(viewKind);
  parts.push(formatRelativeTime(createdAt, now));
  return parts.join(' · ');
}
