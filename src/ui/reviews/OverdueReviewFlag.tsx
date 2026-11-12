import { useState } from 'react';
import { isReviewOverdue, reviewDueDate } from '../../contracts/thresholds';
import { sendReviewReminder } from '../../db/reviewEmail';
import type { MergeRequestRow } from '../../db/types';
import { Button } from '../components/Button/Button';
import { Chip } from '../components/Chip/Chip';
import { Text } from '../components/Text/Text';
import { supabase } from '../supabaseClient';
import { formatDate, formatRelativeTime } from '../time';

export interface OverdueReviewFlagProps {
  request: MergeRequestRow;
  /** The organisation's review period; `null` while unknown — nothing is flagged. */
  periodDays: number | null;
  /** Requester, owner or architect — the same people the reminder email function accepts. */
  canRemind: boolean;
}

/**
 * The "Overdue" flag on a review that has waited longer than the
 * organisation's review period for its reviewers, with the one-time
 * "Remind reviewers" action beside it. Renders nothing for a review that is
 * not overdue — a healthy review gets no chip. The flag sits on the review
 * itself (its queue row, its own page), so it is always a direct link target.
 */
export function OverdueReviewFlag({ request, periodDays, canRemind }: OverdueReviewFlagProps) {
  const [remindedAt, setRemindedAt] = useState<string | null>(request.reminded_at);
  const [state, setState] = useState<'idle' | 'sending' | { message: string }>('idle');
  if (periodDays === null || !isReviewOverdue(request, periodDays)) return null;

  async function remind() {
    setState('sending');
    const result = await sendReviewReminder(supabase, request.id);
    if (result.status === 'sent') {
      setRemindedAt(new Date().toISOString());
      setState('idle');
    } else if (result.status === 'not_due') {
      setState({
        message:
          result.reason === 'already_reminded'
            ? 'A reminder has already been sent.'
            : result.reason === 'nobody_to_email'
              ? 'Nobody to remind: every reviewer who has not responded has switched reminder emails off.'
              : 'This review is no longer overdue.',
      });
    } else {
      setState({ message: `Could not send the reminder. ${result.message}` });
    }
  }

  return (
    <>
      <Chip tone="warn">Overdue — was due {formatDate(reviewDueDate(request.created_at, periodDays).toISOString())}</Chip>
      {remindedAt !== null ? (
        <Text as="span" tone="muted" size="sm">
          Reviewers reminded {formatRelativeTime(remindedAt, new Date())}
        </Text>
      ) : (
        canRemind && (
          <Button
            variant="secondary"
            disabled={state === 'sending'}
            onClick={() => {
              void remind();
            }}
          >
            {state === 'sending' ? 'Sending…' : 'Remind reviewers'}
          </Button>
        )
      )}
      {typeof state === 'object' && (
        <span role="status">
          <Text as="span" tone="muted" size="sm">
            {state.message}
          </Text>
        </span>
      )}
    </>
  );
}
