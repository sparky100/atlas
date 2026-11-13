import { useState } from 'react';
import type { UUID } from '../../contracts/delta';
import { sendStaleNudges } from '../../db/staleNudge';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useStaleAfterMonths } from '../orgs/staleThresholdContext';
import { supabase } from '../supabaseClient';

export interface StaleReminderBarProps {
  modelId: UUID;
  /** How many items are on the list right now. */
  count: number;
}

/**
 * The "email their owners" action above the out-of-date list. Shown only to
 * an owner or architect (the caller gates it; the email function checks again).
 * It never marks anything as still accurate: the email's links just open each
 * item, and the owner decides there. Items with no owner on record go to the
 * architects, and the bar says so.
 */
export function StaleReminderBar({ modelId, count }: StaleReminderBarProps) {
  const months = useStaleAfterMonths();
  const [state, setState] = useState<'idle' | 'sending' | { message: string }>('idle');
  if (count === 0) return null;

  async function send() {
    setState('sending');
    const result = await sendStaleNudges(supabase, modelId);
    if (result.status === 'sent') {
      setState({ message: `Reminder emailed to ${String(result.sent)} ${result.sent === 1 ? 'person' : 'people'}.` });
    } else if (result.status === 'not_due') {
      setState({
        message:
          result.reason === 'already_reminded'
            ? 'Everyone with something to check has already been reminded this week.'
            : result.reason === 'nobody_to_email'
              ? 'Nobody to email: the people involved have switched these emails off.'
              : 'Nothing is out of date.',
      });
    } else {
      setState({ message: `Could not send the reminder. ${result.message}` });
    }
  }

  return (
    <div role="status">
      <Text as="p" size="sm">
        {count} {count === 1 ? 'item has' : 'items have'} not been checked for over {months} months. Open an item and press Still accurate if nothing has changed.
      </Text>
      <Text as="p" tone="muted" size="sm">
        You can email each owner their items. Anything with no owner on record goes to the architects. Nobody is emailed twice in a week.
      </Text>
      <Button variant="ghost" disabled={state === 'sending'} onClick={() => void send()}>
        {state === 'sending' ? 'Sending…' : 'Email owners a reminder'}
      </Button>
      {typeof state === 'object' && (
        <Text as="p" size="sm">
          {state.message}
        </Text>
      )}
    </div>
  );
}
