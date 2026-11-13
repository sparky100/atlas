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
 * The same function also sends the stale-data nudge (`staleNudge: true` with a
 * `modelId`; see `sendStaleNudges` below) so there is one place that holds the
 * service-role key and talks to Resend.
 *
 * Secrets: RESEND_API_KEY, RESEND_FROM_ADDRESS (shared with
 * send-invite-email) and ATLAS_APP_URL (the app's public base URL, used to
 * build the link). See docs/EDGE-FUNCTIONS.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';
import { corsHeaders } from '../_shared/cors.ts';

interface Body {
  mergeRequestId?: unknown;
  /** true (with `modelId`) = email each owner the elements of theirs that have gone stale, instead of anything about a review. */
  staleNudge?: unknown;
  modelId?: unknown;
  /** true = send the one overdue reminder to reviewers who have not responded, instead of the assignment email. */
  reminder?: unknown;
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
    const isStaleNudge = body.staleNudge === true;
    if (isStaleNudge) {
      if (typeof body.modelId !== 'string' || body.modelId.length === 0) return json({ status: 'error', message: 'modelId is required.' }, 400);
    } else if (typeof body.mergeRequestId !== 'string' || body.mergeRequestId.length === 0) {
      return json({ status: 'error', message: 'mergeRequestId is required.' }, 400);
    }
    const mergeRequestId = typeof body.mergeRequestId === 'string' ? body.mergeRequestId : '';

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime, no shared type-checking with src/.
    const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await asCaller.auth.getUser();
    if (userError || !userData.user) return json({ status: 'error', message: 'Not signed in.' }, 401);
    const callerId = userData.user.id;

    if (isStaleNudge) return await sendStaleNudges(asCaller, url, serviceKey, callerId, body.modelId as string, { resendApiKey, resendFrom, appUrl });

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

    if (body.reminder === true) return await sendReminder(admin, request, mergeRequestId, { resendApiKey, resendFrom, appUrl });

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

interface Mail {
  resendApiKey: string;
  resendFrom: string;
  appUrl: string;
}

const DAY_MS = 86_400_000;

/**
 * The one reminder for an overdue review: emails every reviewer whose verdict
 * is still `pending`, once. Overdue is re-checked here (the button is only a
 * request): the review must still be `pending` and older than the
 * organisation's `review_period_days`. `merge_requests.reminded_at` is
 * claimed with a conditional update before any send, so two presses (or two
 * callers) can never email twice; the claim is released if nothing went out.
 * Reviewers who switched off `email_on_review_assigned` are skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deno runtime, no shared type-checking with src/.
async function sendReminder(admin: any, request: { org_id: string; model_id: string; branch_id: string }, mergeRequestId: string, mail: Mail): Promise<Response> {
  const { data: org } = await admin.from('organisations').select('slug, review_period_days').eq('id', request.org_id).maybeSingle();
  const { data: model } = await admin.from('models').select('slug').eq('id', request.model_id).maybeSingle();
  const { data: mr } = await admin.from('merge_requests').select('status, created_at, reminded_at').eq('id', mergeRequestId).maybeSingle();
  if (!org || !model || !mr) return json({ status: 'error', message: 'Could not resolve the review.' }, 500);
  const state = mr as { status: string; created_at: string; reminded_at: string | null };
  const periodDays = (org as { review_period_days: number }).review_period_days;
  if (state.status !== 'pending') return json({ status: 'not_due', reason: 'not_waiting_for_reviewers', sent: 0 }, 200);
  if (Date.now() < new Date(state.created_at).getTime() + periodDays * DAY_MS) return json({ status: 'not_due', reason: 'not_overdue', sent: 0 }, 200);
  if (state.reminded_at !== null) return json({ status: 'not_due', reason: 'already_reminded', sent: 0 }, 200);

  const { data: claimed } = await admin.from('merge_requests').update({ reminded_at: new Date().toISOString() }).eq('id', mergeRequestId).is('reminded_at', null).select('id');
  if (((claimed ?? []) as unknown[]).length === 0) return json({ status: 'not_due', reason: 'already_reminded', sent: 0 }, 200);

  const [{ data: branch }, { data: waiting }] = await Promise.all([
    admin.from('branches').select('title, name').eq('id', request.branch_id).maybeSingle(),
    admin.from('review_verdicts').select('user_id').eq('merge_request_id', mergeRequestId).eq('verdict', 'pending'),
  ]);
  const branchRow = branch as { title: string | null; name: string } | null;
  const changeTitle = branchRow?.title ?? branchRow?.name ?? 'a change';
  const link = `${mail.appUrl.replace(/\/+$/, '')}/o/${(org as { slug: string }).slug}/m/${(model as { slug: string }).slug}/review/${mergeRequestId}`;

  let sent = 0;
  let failed = 0;
  for (const w of (waiting ?? []) as { user_id: string }[]) {
    const { data: prefs } = await admin.from('user_preferences').select('email_on_review_assigned').eq('user_id', w.user_id).maybeSingle();
    if (((prefs as { email_on_review_assigned: boolean } | null)?.email_on_review_assigned ?? true) === false) continue;
    const { data: authUser } = await admin.auth.admin.getUserById(w.user_id);
    const to = authUser.user?.email;
    if (!to) continue;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: mail.resendFrom,
        to,
        subject: `Reminder: your review of "${changeTitle}" is overdue`,
        html: `<p>Your review of <strong>${esc(changeTitle)}</strong> on Atlas was due ${String(periodDays)} days after it was submitted and is still waiting for you.</p><p><a href="${esc(link)}">Open the review</a></p><p>You can turn these emails off on your Profile page.</p>`,
      }),
    });
    if (res.ok) sent += 1;
    else failed += 1;
  }

  if (sent === 0) {
    // Nothing went out: release the claim so a later press can try again.
    await admin.from('merge_requests').update({ reminded_at: null }).eq('id', mergeRequestId);
    if (failed > 0) return json({ status: 'error', message: 'Resend refused the reminder.', sent: 0 }, 502);
    return json({ status: 'not_due', reason: 'nobody_to_email', sent: 0 }, 200);
  }
  return json({ status: 'sent', sent }, 200);
}

const STALE_NUDGE_INTERVAL_DAYS = 7;
const STALE_NUDGE_MAX_LISTED = 10;

interface StaleRecipientRow {
  user_id: string;
  element_id: string;
  element_name: string;
  element_type: string;
  oldest_fact_date: string;
  as_fallback: boolean;
}

/**
 * The stale-data nudge: one email per person listing the elements that have
 * gone stale, each linking to that element. Asked for by an owner or
 * architect pressing "Send reminders"; nothing here ever marks anything
 * accurate — the links only open the element page, where the person decides.
 *
 * Who gets what is decided in SQL (atlas.stale_nudge_recipients): the member
 * behind a business or technical owner of an element, and — for an element
 * with no owner who is a current member — the organisation's architects (or
 * owners when it has none). Duplicates are prevented three ways: nobody who
 * was emailed in the last STALE_NUDGE_INTERVAL_DAYS days is emailed again,
 * `stale_nudges (model_id, user_id, sent_on)` is claimed before the send so
 * two presses at once cannot both send, and a claim is released if the send
 * failed so a later press can try again. People who switched off
 * `email_on_stale_nudge` are skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Deno runtime, no shared type-checking with src/.
async function sendStaleNudges(asCaller: any, url: string, serviceKey: string, callerId: string, modelId: string, mail: Mail): Promise<Response> {
  // (a) RLS: a caller who cannot see the model gets nothing back.
  const { data: model } = await asCaller.from('models').select('id, org_id, slug').eq('id', modelId).maybeSingle();
  if (!model) return json({ status: 'error', message: 'No such model.' }, 404);
  const target = model as { id: string; org_id: string; slug: string };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Deno runtime.
  const admin = createClient(url, serviceKey);

  // (b) owner or architect only, checked before any service-role read of people.
  const { data: member } = await admin.from('members').select('role').eq('org_id', target.org_id).eq('user_id', callerId).maybeSingle();
  const role = (member as { role: string } | null)?.role;
  if (role !== 'owner' && role !== 'architect') return json({ status: 'error', message: 'Only an owner or architect can send stale-data reminders.' }, 403);

  const [{ data: org }, { data: rows, error: rowsError }] = await Promise.all([
    admin.from('organisations').select('slug, stale_after_months').eq('id', target.org_id).maybeSingle(),
    admin.schema('atlas').rpc('stale_nudge_recipients', { p_model_id: modelId }),
  ]);
  if (!org || rowsError) return json({ status: 'error', message: 'Could not work out what is out of date.' }, 500);
  const months = (org as { stale_after_months: number }).stale_after_months;
  const base = `${mail.appUrl.replace(/\/+$/, '')}/o/${(org as { slug: string }).slug}/m/${target.slug}`;

  const byUser = new Map<string, StaleRecipientRow[]>();
  for (const row of (rows ?? []) as StaleRecipientRow[]) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  if (byUser.size === 0) return json({ status: 'not_due', reason: 'nothing_stale', sent: 0 }, 200);

  const cutoff = new Date(Date.now() - STALE_NUDGE_INTERVAL_DAYS * DAY_MS).toISOString().slice(0, 10);
  let sent = 0;
  let skippedRecently = 0;
  let optedOut = 0;
  let failed = 0;

  for (const [userId, items] of byUser) {
    const { data: recent } = await admin.from('stale_nudges').select('id').eq('model_id', modelId).eq('user_id', userId).gt('sent_on', cutoff).limit(1);
    if (((recent ?? []) as unknown[]).length > 0) {
      skippedRecently += 1;
      continue;
    }
    const { data: prefs } = await admin.from('user_preferences').select('email_on_stale_nudge').eq('user_id', userId).maybeSingle();
    if (((prefs as { email_on_stale_nudge: boolean } | null)?.email_on_stale_nudge ?? true) === false) {
      optedOut += 1;
      continue;
    }
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const to = authUser.user?.email;
    if (!to) continue;

    const { data: claim, error: claimError } = await admin.from('stale_nudges').insert({ org_id: target.org_id, model_id: modelId, user_id: userId, item_count: items.length }).select('id').maybeSingle();
    if (claimError || !claim) {
      skippedRecently += 1; // lost the race to a press made at the same moment
      continue;
    }

    const own = items.filter((i) => !i.as_fallback);
    const unowned = items.filter((i) => i.as_fallback);
    const list = (rowsToList: StaleRecipientRow[]) => {
      const shown = rowsToList.slice(0, STALE_NUDGE_MAX_LISTED).map((i) => `<li><a href="${esc(`${base}/e/${i.element_id}`)}">${esc(i.element_name)}</a></li>`).join('');
      const more = rowsToList.length > STALE_NUDGE_MAX_LISTED ? `<li>and ${String(rowsToList.length - STALE_NUDGE_MAX_LISTED)} more</li>` : '';
      return `<ul>${shown}${more}</ul>`;
    };
    const html =
      `<p>Some things on Atlas haven't been updated or checked for more than ${String(months)} months.</p>` +
      (own.length > 0 ? `<p><strong>You're named as the owner of ${String(own.length)}:</strong></p>${list(own)}` : '') +
      (unowned.length > 0 ? `<p><strong>${String(unowned.length)} ${unowned.length === 1 ? 'has' : 'have'} no owner recorded, so ${unowned.length === 1 ? 'it has' : 'they have'} come to you as an architect:</strong></p>${list(unowned)}` : '') +
      `<p>Open each one and press <strong>Still accurate</strong> if nothing has changed, or edit what has. Opening a link changes nothing.</p>` +
      `<p><a href="${esc(`${base}/elements?filter=stale-attributes`)}">See everything that needs checking</a></p>` +
      `<p>You can turn these emails off on your Profile page.</p>`;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mail.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mail.resendFrom, to, subject: `${String(items.length)} ${items.length === 1 ? 'item needs' : 'items need'} checking on Atlas`, html }),
    });
    if (res.ok) {
      sent += 1;
    } else {
      failed += 1;
      await admin.from('stale_nudges').delete().eq('id', (claim as { id: string }).id);
    }
  }

  if (sent === 0 && failed > 0) return json({ status: 'error', message: 'Resend refused the reminders.', sent: 0 }, 502);
  if (sent === 0) return json({ status: 'not_due', reason: skippedRecently > 0 ? 'already_reminded' : 'nobody_to_email', sent: 0 }, 200);
  return json({ status: 'sent', sent }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
