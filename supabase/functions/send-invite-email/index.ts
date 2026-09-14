/**
 * Sprint F7 item 1: sends the invite-notification email for one existing
 * `invites` row, via Resend (the transactional provider decided on for
 * this sprint — Supabase's own built-in auth-invite email was considered
 * and rejected: it's rate-limited and meant for testing, not production
 * volume). This is the first Supabase Edge Function this repo has ever
 * shipped.
 *
 * Deliberately holds no Supabase service-role key. It forwards the
 * caller's own `Authorization` header into a normal, RLS-scoped Supabase
 * client (anon key), the same one an ordinary browser request would use —
 * `invites_select`'s own owner-only RLS is the real authorization check
 * here, re-derived server-side from the caller's own session exactly the
 * way every `security definer` RPC in this codebase re-derives its own
 * role check rather than trusting a client-supplied claim. If the caller
 * isn't the owner of this invite's own org, the `invites` read below
 * simply returns nothing and this function refuses with 404 — there is no
 * separate permission check to get wrong.
 *
 * The only secrets this function needs are `RESEND_API_KEY` and
 * `RESEND_FROM_ADDRESS` (Supabase project secrets — `supabase secrets set
 * RESEND_API_KEY=... RESEND_FROM_ADDRESS=...`; see docs/EDGE-FUNCTIONS.md
 * for the full deploy/setup steps). Without them this function returns a
 * clear, structured error rather than silently doing nothing —
 * `src/db/invites.ts`'s `sendInviteEmail` surfaces that error inline next
 * to the invite row, non-blocking (the `invites` row itself was already
 * created before this function is ever called; a failed send never loses
 * the invite).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../_shared/cors.ts';

interface SendInviteEmailRequest {
  inviteId: string;
}

interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: string;
  invited_by: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ status: 'error', message: 'Missing Authorization header.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ status: 'error', message: 'Edge function is missing its own SUPABASE_URL/SUPABASE_ANON_KEY — these are provided automatically by Supabase, this should not happen.' }, 500);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });

    const body = (await req.json()) as Partial<SendInviteEmailRequest>;
    if (typeof body.inviteId !== 'string' || body.inviteId.length === 0) {
      return jsonResponse({ status: 'error', message: 'inviteId is required.' }, 400);
    }

    // RLS (invites_select: owner-only) is the real authorization check —
    // a caller who isn't the owner of this invite's own org gets nothing
    // back here, indistinguishable from a bad id.
    const { data: invite, error: inviteError } = await supabase.from('invites').select('id, org_id, email, role, invited_by').eq('id', body.inviteId).maybeSingle();
    if (inviteError) return jsonResponse({ status: 'error', message: `Could not read the invite: ${inviteError.message}` }, 500);
    if (!invite) return jsonResponse({ status: 'error', message: 'No invite found (or you are not this organisation\'s owner).' }, 404);
    const inviteRow = invite as InviteRow;

    const { data: org, error: orgError } = await supabase.from('organisations').select('name').eq('id', inviteRow.org_id).maybeSingle();
    if (orgError) return jsonResponse({ status: 'error', message: `Could not read the organisation: ${orgError.message}` }, 500);
    const orgName = (org as { name: string } | null)?.name ?? 'an organisation';

    // atlas.profiles is member-visible (any fellow org member, any role) —
    // the caller, being this org's owner, can always read their own
    // profile. No email column exists on this table (ADR-009) — nothing
    // here ever reads or forwards the inviter's own address.
    const { data: profile } = await supabase.schema('atlas').from('profiles').select('display_name').eq('user_id', inviteRow.invited_by).maybeSingle();
    const inviterName = (profile as { display_name: string | null } | null)?.display_name ?? 'A colleague';

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const resendFrom = Deno.env.get('RESEND_FROM_ADDRESS');
    if (!resendApiKey || !resendFrom) {
      return jsonResponse({ status: 'error', message: 'Email sending is not configured for this project — RESEND_API_KEY/RESEND_FROM_ADDRESS are not set. See docs/EDGE-FUNCTIONS.md.' }, 500);
    }

    const subject = `${inviterName} invited you to join ${orgName} on Atlas`;
    const html = `<p>${escapeHtml(inviterName)} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Atlas as a <strong>${escapeHtml(inviteRow.role)}</strong>.</p><p>Sign up or sign in with this email address (${escapeHtml(inviteRow.email)}) to join.</p>`;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: resendFrom, to: inviteRow.email, subject, html }),
    });

    if (!resendResponse.ok) {
      const detail = await resendResponse.text();
      return jsonResponse({ status: 'error', message: `Resend refused the send (${String(resendResponse.status)}). Detail: ${detail}` }, 502);
    }

    const { error: updateError } = await supabase.from('invites').update({ last_sent_at: new Date().toISOString() }).eq('id', inviteRow.id);
    if (updateError) {
      // The email genuinely sent — a failure to record last_sent_at is a
      // real, separate problem (worth surfacing), but must never read as
      // "the email wasn't sent."
      return jsonResponse({ status: 'sent', warning: `Email sent, but could not record last_sent_at: ${updateError.message}` }, 200);
    }

    return jsonResponse({ status: 'sent' }, 200);
  } catch (e) {
    return jsonResponse({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error sending the invite email.' }, 500);
  }
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
