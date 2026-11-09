/**
 * Review-assigned email: asks the `send-review-email` edge function to email
 * the reviewers just assigned to one merge request, with a link to that
 * review. Called right after the assignment itself succeeds
 * (`submitMergeRequest` with a reviewer set, `setReviewers`).
 *
 * Best-effort by design, like `sendInviteEmail`: the assignment and the
 * in-app notification already exist, so a failed or unconfigured email must
 * never fail the submit. It resolves to a result instead of throwing, and
 * the function itself decides who gets mail (notification exists, email not
 * switched off, not already emailed) — nothing here names recipients.
 */
import type { UUID } from '../contracts/delta';
import type { Client } from './client';

export type SendReviewEmailResult = { status: 'sent'; sent: number } | { status: 'error'; message: string };

export async function sendReviewEmail(supabase: Client, mergeRequestId: UUID): Promise<SendReviewEmailResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see invites.ts.
    const { data, error } = await supabase.functions.invoke('send-review-email', { body: { mergeRequestId } });
    if (error) return { status: 'error', message: error instanceof Error ? error.message : 'Could not reach the email service.' };
    const result = data as { status: 'sent'; sent?: number } | { status: 'error'; message: string } | null;
    if (result?.status === 'sent') return { status: 'sent', sent: result.sent ?? 0 };
    return { status: 'error', message: result?.status === 'error' ? result.message : 'The email service did not confirm the send.' };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Could not reach the email service.' };
  }
}
