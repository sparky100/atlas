-- Sprint F7 item 1: invite emails. `invites` already exists (Sprint 7j
-- item 4) as an in-app pending row with no email ever sent — this adds the
-- one new piece of state an actual send needs: when the invite email was
-- last sent, so "resend" has something real to show ("last sent 2 min
-- ago" / never sent) rather than being indistinguishable from a fresh
-- invite. The send itself happens in a new edge function
-- (supabase/functions/send-invite-email), not here — this migration only
-- adds the column and the narrow column-grant that lets the owner who
-- triggered a send record it happened, same "revoke update; grant update
-- (one column)" shape 20260911060000_invites.sql's own consumed_at/
-- consumed_by columns are documented as needing but, unlike those, this
-- one IS meant to be written by a client (the inviting owner's own
-- session, immediately after the edge function's Resend call succeeds) —
-- never by anyone else's, and never any other column on this row.

alter table invites add column last_sent_at timestamptz;

comment on column invites.last_sent_at is 'Sprint F7 item 1: when the invite email (Resend, via the send-invite-email edge function) was last successfully sent to this address. Null until the first successful send. Written by the inviting owner''s own session after the edge function confirms delivery to Resend — never by anyone else, and this is the only column on this table any client write ever reaches.';

-- Owner-only, and only this one column: mirrors invites_select/
-- invites_insert/invites_delete's own atlas.has_role(org_id, 'owner')
-- check exactly, so only the invite's own org owner can ever mark it sent
-- — the edge function itself authenticates as that owner (forwards their
-- own Authorization header, never a service-role client, see that
-- function's own module comment) and this policy is what actually
-- enforces the boundary, not the edge function's own logic alone.
create policy invites_update_last_sent_at on invites
  for update to authenticated
  using (atlas.has_role(org_id, 'owner'))
  with check (atlas.has_role(org_id, 'owner'));

grant update (last_sent_at) on invites to authenticated;
