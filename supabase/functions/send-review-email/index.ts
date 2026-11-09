/**
 * Emails each newly assigned reviewer of one merge request ("X asked you to
 * review ..."), with a link straight to that review. Called by the app right
 * after a change is submitted for review or its reviewer set is edited —
 * the moment a reviewer is assigned — and always best-effort: the
 * assignment and the in-app notification already exist by then (written by
 * atlas.submit_merge_request / atlas.set_reviewers), so a failed email never
 * loses a review.
 *
 * Unlike send-invite-email this holds the Supabase service-role key, because
 * a reviewer's email address lives in auth.users and is deliberately not
 * readable by any member (ADR-009; atlas.profiles has no email column). The
 * authorization check is therefore done by hand, before any service-role
 * read: the caller's own session must (a) see the merge request through
 * RLS, and (b) be its requester or an owner/architect of its organisation —
 * the same rule atlas.set_reviewers applies. Recipients are never taken from
 * the request body: only people who already have an un-emailed
 * `review_assigned` notification for this merge request (so people who
 * opted out of the in-app notification, and the caller themselves, never
 * get one) and who have not switched off `email_on_review_assigned`.
 * `notifications.emailed_at` makes a repeat call a no-op for anyone already
 * emailed.
 *
 * Secrets: RESEND_API_KEY, RESEND_FROM_ADDRESS (shared with
 * send-invite-email) and ATLAS_APP_URL (the app's public base URL, used to
 * build the link). See docs/EDGE-FUNCTIONS.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../_shared/cors.ts';

interface Body {
  mergeRequestId?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ status: 'error', message: 'Missing Authorization header.' }, 401);

    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ status: 'error', message: 'Edge function is missing its own Supabase environment — this should not happen.' }, 500);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const resendFrom = Deno.env.get('RESEND_FROM_ADDRESS');
    const appUrl = Deno.env.get('ATLAS_APP_URL');
    if (!resendApiKey || !resendFrom || !appUrl) {
      return json({ status: 'error', message: 'Email sending is not configured for this project — RESEND_API_KEY, RESEND_FROM_ADDRESS and ATLAS_APP_URL must all be set. See docs/EDGE-FUNCTIONS.md.' }, 500);
    }

    const body = (await req.json()) as Body;
    if (typeof body.mergeRequestId !== 'string' || body.mergeRequestId.length === 0) return json({ status: 'error', message: 'mergeRequestId is required.' }, 400);
    const mergeRequestId = body.mergeRequestId;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await asCaller.auth.getUser();
    if (userError || !userData.user) return json({ status: 'error', message: 'Not signed in.' }, 401);
    const callerId = userData.user.id;

    // (a) RLS: a caller who cannot see the request gets nothing back.
    const { data: mr } = await asCaller.from('merge_requests').select('id, org_id, model_id, branch_id, requested_by').eq('id', mergeRequestId).maybeSingle();
    if (!mr) return json({ status: 'error', message: 'No such review.' }, 404);
    const request = mr as { id: string; org_id: string; model_id: string; branch_id: string; requested_by: string };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime.
    const admin = createClient(url, serviceKey);

    // (b) requester, or owner/architect — same rule as atlas.set_reviewers.
    if (request.requested_by !== callerId) {
      const { data: member } = await admin.from('members').select('role').eq('org_id', request.org_id).eq('user_id', callerId).maybeSingle();
      const role = (member as { role: string } | null)?.role;
      if (role !== 'owner' && role !== 'architect') return json({ status: 'error', message: 'Only the requester or an owner/architect can send review emails.' }, 403);
    }

    const { data: pending } = await admin.from('notifications').select('id, user_id').eq('merge_request_id', mergeRequestId).eq('kind', 'review_assigned').is('emailed_at', null);
    const notifications = (pending ?? []) as { id: string; user_id: string }[];
    if (notifications.length === 0) return json({ status: 'sent', sent: 0 }, 200);

    const [{ data: org }, { data: model }, { data: branch }, { data: requester }] = await Promise.all([
      admin.from('organisations').select('slug').eq('id', request.org_id).maybeSingle(),
      admin.from('models').select('slug').eq('id', request.model_id).maybeSingle(),
      admin.from('branches').select('title, name').eq('id', request.branch_id).maybeSingle(),
      admin.schema('atlas').from('profiles').select('display_name').eq('user_id', request.requested_by).maybeSingle(),
    ]);
    if (!org || !model) return json({ status: 'error', message: 'Could not resolve the review link.' }, 500);
    const link = `${appUrl.replace(/\/+$/, '')}/o/${(org as { slug: string }).slug}/m/${(model as { slug: string }).slug}/review/${mergeRequestId}`;
    const branchRow = branch as { title: string | null; name: string } | null;
    const changeTitle = branchRow?.title ?? branchRow?.name ?? 'a change';
    const requesterName = (requester as { display_name: string | null } | null)?.display_name ?? 'A colleague';

    let sent = 0;
    const failures: string[] = [];
    for (const n of notifications) {
      const { data: prefs } = await admin.from('user_preferences').select('email_on_review_assigned').eq('user_id', n.user_id).maybeSingle();
      const wantsEmail = (prefs as { email_on_review_assigned: boolean } | null)?.email_on_review_assigned ?? true;
      if (!wantsEmail) continue;

      const { data: authUser } = await admin.auth.admin.getUserById(n.user_id);
      const to = authUser.user?.email;
      if (!to) continue;

      const subject = `${requesterName} asked you to review "${changeTitle}"`;
      const html = `<p>${esc(requesterName)} asked you to review <strong>${esc(changeTitle)}</strong> on Atlas.</p><p><a href="${esc(link)}">Open the review</a></p><p>You can turn these emails off on your Profile page.</p>`;
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: resendFrom, to, subject, html }),
      });
      if (!res.ok) {
        failures.push(`Resend refused one send (${String(res.status)}).`);
        continue;
      }
      sent += 1;
      await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).eq('id', n.id);
    }

    if (failures.length > 0) return json({ status: 'error', message: failures[0] ?? 'Some emails failed to send.', sent }, 502);
    return json({ status: 'sent', sent }, 200);
  } catch (e) {
    return json({ status: 'error', message: e instanceof Error ? e.message : 'Unknown error sending review emails.' }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
