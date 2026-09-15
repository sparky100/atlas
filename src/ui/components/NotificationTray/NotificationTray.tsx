import { useId } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/useAuth';
import { useNotificationTray } from '../../comments/useNotificationTray';
import { notificationAnchorWords, notificationKindWording, truncateNotificationBody } from '../../comments/notificationFormat';
import { formatRelativeTime } from '../../time';
import { Avatar } from '../Avatar/Avatar';
import { Button } from '../Button/Button';
import { EmptyState } from '../EmptyState/EmptyState';
import { Text } from '../Text/Text';
import styles from './NotificationTray.module.css';

/**
 * The bell + inbox panel (Sprint M1b, direction 6c) — same
 * wrapper/toggle/menu shape `UserMenu.tsx` already uses (no popover
 * primitive exists yet in this design system).
 */
export function NotificationTray() {
  const { userId } = useAuth();
  const { unreadCount, open, toggle, state, markRead, markAllRead } = useNotificationTray(userId);
  const menuId = useId();
  const now = new Date();

  if (!userId) return null;

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={menuId} onClick={toggle}>
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
        <span className={styles.srOnly}>{unreadCount > 0 ? `Notifications, ${String(unreadCount)} unread` : 'Notifications'}</span>
      </button>
      <div id={menuId} className={[styles.panel, open ? styles.open : ''].filter(Boolean).join(' ')}>
        <div className={styles.header}>
          <Text as="h2" size="md">
            Inbox
          </Text>
          <Text as="span" tone="muted" size="sm">
            {unreadCount} unread
          </Text>
          {unreadCount > 0 && (
            <Button variant="ghost" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>

        {state.status === 'loading' && (
          <Text tone="muted" size="sm">
            Loading…
          </Text>
        )}
        {state.status === 'error' && <Text as="p">{state.message}</Text>}
        {state.status === 'ready' && state.rows.length === 0 && <EmptyState>Only mentions and replies notify you here — no digests, no activity feed, and a merge never waits on this.</EmptyState>}
        {state.status === 'ready' && state.rows.length > 0 && (
          <ul className={styles.list}>
            {state.rows.map(({ notification, comment, authorProfile, subjectName, href }) => {
              const unread = notification.read_at === null;
              const authorName = authorProfile?.display_name ?? (authorProfile ? `@${authorProfile.handle}` : 'Someone');
              const row = (
                <>
                  <Avatar profile={authorProfile ?? null} size="sm" />
                  <div className={styles.rowBody}>
                    <Text as="span" size="sm">
                      {notificationKindWording(notification.kind, authorName)}
                    </Text>
                    {comment && (
                      <Text as="p" tone="muted" size="sm">
                        {truncateNotificationBody(comment.body)}
                      </Text>
                    )}
                    {comment && (
                      <Text as="p" tone="faint" size="xs">
                        {notificationAnchorWords(subjectName, comment.anchor_type, comment.view_kind, now, notification.created_at)}
                      </Text>
                    )}
                    {notification.kind === 'review_assigned' && (
                      <Text as="p" tone="faint" size="xs">
                        {subjectName ?? 'a change'} · {formatRelativeTime(notification.created_at, now)}
                      </Text>
                    )}
                  </div>
                </>
              );
              return (
                <li key={notification.id} className={[styles.row, unread ? styles.unread : ''].filter(Boolean).join(' ')}>
                  {href ? (
                    <Link
                      to={href}
                      className={styles.rowLink}
                      onClick={() => {
                        if (unread) void markRead(notification.id);
                      }}
                    >
                      {row}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={styles.rowLink}
                      onClick={() => {
                        if (unread) void markRead(notification.id);
                      }}
                    >
                      {row}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
