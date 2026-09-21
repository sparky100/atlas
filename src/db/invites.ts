/**
 * Sprint 7j item 4: invite-by-email. Thin, typed wrappers — same
 * untyped-client `eslint-disable` boundary organisations.ts's own module
 * comment names.
 */
import type { Client } from './client';
import type { InviteRow, MemberRole } from './types';
import type { UUID } from '../contracts/delta';

export interface CreateInviteInput {
  /** Minted by the caller (S-1) — never generated here. Use `crypto.randomUUID()` at the call site. */
  id: UUID;
  orgId: UUID;
  email: string;
  role: MemberRole;
  invitedBy: UUID;
}

export type CreateInviteResult = { status: 'created'; invite: InviteRow } | { status: 'already_pending' };

/**
 * Owner only (`invites_insert`'s RLS). Normalises the email to lowercase
 * before writing — the same invariant `invites`' own check constraint
 * enforces server-side, so a lookup at consumption time
 * (`atlas.consume_invites_for_user`) is a plain equality check. A second
 * invite to an email that already has a pending (unconsumed) one at this
 * org is a resend, not a new row — the partial unique index
 * `(org_id, email) where consumed_at is null` refuses it; this function
 * catches that specific violation (`23505`, the same code
 * `commits.ts`'s own `CONFLICT_ERROR_CODES` checks for a different
 * conflict) and returns a structured result rather than letting the raw
 * Postgres error surface.
 */
export async function createInvite(supabase: Client, input: CreateInviteInput): Promise<CreateInviteResult> {
  const email = input.email.trim().toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.from('invites').insert({ id: input.id, org_id: input.orgId, email, role: input.role, invited_by: input.invitedBy }).select('*').single();
  if (error) {
    if (error.code === '23505') return { status: 'already_pending' };
    throw new Error(`createInvite: ${error.message}`);
  }
  return { status: 'created', invite: data as InviteRow };
}

/** Owner only (`invites_select`'s RLS) — every invite for the org, pending and consumed alike (an owner can see who they invited and whether it landed), newest first. */
export async function listInvites(supabase: Client, orgId: UUID): Promise<InviteRow[]> {
  const { data, error } = await supabase.from('invites').select('*').eq('org_id', orgId).order('created_at', { ascending: false });
  if (error) throw new Error(`listInvites: ${error.message}`);
  return (data as InviteRow[] | null) ?? [];
}

/**
 * Owner only (`invites_delete`'s RLS) — deletes the row outright, pending or already consumed; there's no soft-revoke state, same "delete means delete" the row itself already is (a consumed invite is history the `members` row it created now carries, not something this row alone needs to preserve).
 *
 * A blocked `DELETE` under RLS isn't a Postgres error — the `using` clause
 * just excludes the row from the scan, so the statement matches zero rows
 * and Postgres/PostgREST report an ordinary success. `.select('id')` and an
 * explicit empty-result check turn that into a real, throwable failure
 * (found live: a non-owner's revoke was silently resolving instead of
 * rejecting).
 */
export async function revokeInvite(supabase: Client, id: UUID): Promise<void> {
  const { data, error } = await supabase.from('invites').delete().eq('id', id).select('id');
  if (error) throw new Error(`revokeInvite: ${error.message}`);
  if (data.length === 0) throw new Error('revokeInvite: not permitted or already revoked');
}

export type SendInviteEmailResult = { status: 'sent' } | { status: 'error'; message: string };

/**
 * Sprint F7 item 1: invokes the `send-invite-email` edge function (Resend)
 * for one already-created invite — never bundled into `createInvite`
 * itself (decision, see the F7 plan's own "create and send are decoupled"
 * note): a failed send must never lose the invite row, so this is always
 * a separate call the caller can retry ("Resend") independent of creation.
 * The edge function re-derives its own owner check from the caller's
 * forwarded session via `invites_select`'s RLS — this wrapper trusts
 * nothing client-side either; a non-owner caller just gets `status:
 * 'error'` back from the function's own 404.
 */
export async function sendInviteEmail(supabase: Client, inviteId: UUID): Promise<SendInviteEmailResult> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped client; see module comment.
  const { data, error } = await supabase.functions.invoke('send-invite-email', { body: { inviteId } });
  if (error) return { status: 'error', message: error instanceof Error ? error.message : 'Could not reach the email service.' };
  const result = data as { status: 'sent' } | { status: 'error'; message: string } | null;
  if (result?.status === 'sent') return { status: 'sent' };
  return { status: 'error', message: result?.status === 'error' ? result.message : 'The email service did not confirm the send.' };
}

/**
 * Re-runs invite consumption against the now-authenticated caller —
 * closes the one gap the `auth.users`-insert trigger alone can't cover
 * (`20260911060000_invites.sql`'s own module comment): an invite sent to
 * an email that already had an account before the invite existed. Called
 * once per sign-in from `AuthProvider.tsx`, not per token refresh; a
 * no-op the overwhelming majority of the time (no pending invite matches
 * the caller's email).
 */
export async function consumeMyInvites(supabase: Client): Promise<void> {
  const { error } = await supabase.schema('atlas').rpc('consume_my_invites');
  if (error) throw new Error(`consumeMyInvites: ${error.message}`);
}
