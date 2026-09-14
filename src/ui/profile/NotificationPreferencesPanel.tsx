import { useId } from 'react';
import type { UUID } from '../../contracts/delta';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useNotificationPreferences } from './useNotificationPreferences';

export interface NotificationPreferencesPanelProps {
  userId: UUID;
}

/**
 * Sprint F7 item 3: mentions/replies only — "assigned reviews" is named in
 * the prompt this panel implements, but ships no toggle of its own: no
 * `notification_kind` for it exists yet (F3a's review-verdict mechanism,
 * which would produce that kind, was paused mid-planning, not built). A
 * checkbox that toggled nothing would be exactly the kind of inert control
 * CLAUDE.md rule 7 rules out — this panel says so in plain text instead.
 */
export function NotificationPreferencesPanel({ userId }: NotificationPreferencesPanelProps) {
  const { preferences, loading, setNotifyOnMention, setNotifyOnReply } = useNotificationPreferences(userId);
  const mentionId = useId();
  const replyId = useId();

  return (
    <Panel>
      <Text as="h2" size="lg">
        Notifications
      </Text>
      {loading ? (
        <Text tone="muted">Loading…</Text>
      ) : (
        <>
          <label htmlFor={mentionId}>
            <input
              id={mentionId}
              type="checkbox"
              checked={preferences.notifyOnMention}
              onChange={(e) => {
                setNotifyOnMention(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Notify me when someone @mentions me
            </Text>
          </label>
          <label htmlFor={replyId}>
            <input
              id={replyId}
              type="checkbox"
              checked={preferences.notifyOnReply}
              onChange={(e) => {
                setNotifyOnReply(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Notify me when someone replies on a thread I'm in
            </Text>
          </label>
          <Text as="p" tone="muted" size="sm">
            Assigned-review notifications aren't available yet — reviewer assignment itself hasn't been built.
          </Text>
        </>
      )}
    </Panel>
  );
}
