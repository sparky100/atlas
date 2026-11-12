import { Loading } from '../components/Loading/Loading';
import { useId } from 'react';
import type { UUID } from '../../contracts/delta';
import { Panel } from '../components/Panel/Panel';
import { Text } from '../components/Text/Text';
import { useNotificationPreferences } from './useNotificationPreferences';

export interface NotificationPreferencesPanelProps {
  userId: UUID;
}

/**
 * Sprint F7 item 3: mentions, replies, and (follow-up, once F3a's
 * review-verdict mechanism actually shipped — it hadn't when this panel
 * first landed, so it said "assigned reviews aren't available yet"; now
 * that `notification_kind`'s `review_assigned` value and
 * `atlas.submit_merge_request`/`atlas.set_reviewers` exist, this toggle
 * does too) reviewer assignment.
 */
export function NotificationPreferencesPanel({ userId }: NotificationPreferencesPanelProps) {
  const { preferences, loading, setNotifyOnMention, setNotifyOnReply, setNotifyOnReviewAssigned, setEmailOnReviewAssigned, setEmailOnStaleNudge } = useNotificationPreferences(userId);
  const mentionId = useId();
  const replyId = useId();
  const reviewAssignedId = useId();
  const reviewEmailId = useId();
  const staleEmailId = useId();

  return (
    <Panel>
      <Text as="h2" size="lg">
        Notifications
      </Text>
      {loading ? (
        <Loading />
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
          <label htmlFor={reviewAssignedId}>
            <input
              id={reviewAssignedId}
              type="checkbox"
              checked={preferences.notifyOnReviewAssigned}
              onChange={(e) => {
                setNotifyOnReviewAssigned(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Notify me when I'm assigned as a reviewer
            </Text>
          </label>
          <label htmlFor={reviewEmailId}>
            <input
              id={reviewEmailId}
              type="checkbox"
              checked={preferences.emailOnReviewAssigned}
              onChange={(e) => {
                setEmailOnReviewAssigned(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Also email me, with a link, when I'm asked to review a change
            </Text>
          </label>
          <label htmlFor={staleEmailId}>
            <input
              id={staleEmailId}
              type="checkbox"
              checked={preferences.emailOnStaleNudge}
              onChange={(e) => {
                setEmailOnStaleNudge(e.target.checked);
              }}
            />{' '}
            <Text as="span" size="sm">
              Email me when things I own haven't been checked for a while
            </Text>
          </label>
        </>
      )}
    </Panel>
  );
}
