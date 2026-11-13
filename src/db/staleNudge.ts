/**
 * Stale-data reminder: asks the `send-review-email` edge function to email
 * each owner the elements of theirs that have gone stale (and, for an element
 * with no owner, the organisation's architects). Pressed by an owner or
 * architect; the function re-checks that, works out who gets what in SQL
 * (`atlas.stale_nudge_recipients`), skips anyone already emailed in the last
 * week or who switched the email off, and never marks anything accurate.
 * Reports what happened rather than throwing, like `sendReviewReminder`.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

type NotDueReason = 'nothing_stale' | 'already_reminded' | 'nobody_to_email';

export type SendStaleNudgesResult =
  | { status: 'sent'; sent: number }
  | { status: 'not_due'; reason: NotDueReason }
  | { status: 'error'; message: string };

export async function sendStaleNudges(supabase: Client, modelId: UUID): Promise<SendStaleNudgesResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
    const { data, error } = await supabase.functions.invoke('send-review-email', { body: { staleNudge: true, modelId } });
    if (error) return { status: 'error', message: error instanceof Error ? error.message : 'Could not reach the email service.' };
    const result = data as { status: string; sent?: number; reason?: NotDueReason; message?: string } | null;
    if (result?.status === 'sent') return { status: 'sent', sent: result.sent ?? 0 };
    if (result?.status === 'not_due' && result.reason) return { status: 'not_due', reason: result.reason };
    return { status: 'error', message: result?.message ?? 'The email service did not confirm the send.' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Could not reach the email service.' };
  }
}
