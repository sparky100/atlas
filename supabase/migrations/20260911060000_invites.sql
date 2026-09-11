-- Sprint 7j item 4 (PR3): invite by email. No email-sending mechanism
-- exists anywhere in this product (confirmed at plan time, ADR-009's
-- atlas.profiles amendment is explicit profiles carry no email column at
-- all) — an invite is an in-app pending row an owner creates, consumed
-- automatically the moment the invited email establishes a session. This
-- is the first trigger in this schema that fires on `auth.users` itself
-- (every earlier trigger, `atlas.profiles`' own included, fires on a
-- `public`/`atlas` table — `atlas.ensure_profile` fires `after insert on
-- members`, not on `auth.users`) — flagged here as a real schema addition,
-- not a shortcut.

create table invites (
  id uuid primary key,
  org_id uuid not null references organisations (id) on delete cascade,
  -- Always stored lowercased (src/db/invites.ts's createInvite normalises
  -- before writing) — this constraint is the defense-in-depth backstop, the
  -- same "never trust the caller to have normalised" reasoning the rest of
  -- this schema already applies elsewhere, so a lookup at consumption time
  -- is a plain equality check, not a case-insensitive comparison repeated
  -- at every reader.
  email text not null check (email = lower(email)),
  role member_role not null,
  invited_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Both null until consumed; set together, only by
  -- atlas.consume_invites_for_user below — never by a client write (no
  -- update grant to authenticated on this table at all).
  consumed_at timestamptz,
  consumed_by uuid references auth.users (id)
);

comment on table invites is 'Sprint 7j item 4: a pending invitation to join an organisation by email — consumed automatically (atlas.consume_invites_for_user) the moment the invited email signs up or next signs in. Owner-only to create/view/revoke (RLS); never updated by a client write.';

-- A given email can have at most one *unconsumed* invite per org (a second
-- invite while one is already pending is a resend, not a new row — src/db/
-- invites.ts's createInvite checks this and surfaces it as a structured
-- result rather than a raw unique-violation) — partial, so a consumed
-- invite never blocks a later re-invite of the same person.
create unique index invites_org_email_unconsumed_idx on invites (org_id, email) where consumed_at is null;
-- The consuming functions below look up "every unconsumed invite for this
-- email," across every org that email might have been invited to.
create index invites_email_unconsumed_idx on invites (email) where consumed_at is null;
create index invites_org_id_idx on invites (org_id);

-- ---------------------------------------------------------------------------
-- Consumption. Split into a shared worker (`atlas.consume_invites_for_user`)
-- and two callers, because the plan's own trigger-on-signup design only
-- covers half the real scenario: `auth.users` insert fires exactly once,
-- at signup, so an invite sent to an email that *already has an account*
-- (a second-org invite, most obviously) would otherwise sit unconsumed
-- forever with no path to ever catch up. `atlas.consume_my_invites` closes
-- that gap — a thin RPC the client calls once per session establish
-- (`AuthProvider.tsx`), re-running the identical logic against the
-- now-authenticated `auth.uid()` rather than trusting a client-supplied
-- email.
-- ---------------------------------------------------------------------------

create or replace function atlas.consume_invites_for_user(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite record;
begin
  if p_email is null then
    return;
  end if;

  for v_invite in
    select id, org_id, role, invited_by
    from invites
    where email = lower(p_email) and consumed_at is null
    order by created_at
  loop
    -- on conflict do nothing: the invited user may already be a member of
    -- that org through some other path (e.g. an owner both invited them
    -- and separately added them directly) — the invite still gets marked
    -- consumed either way, rather than left stranded as a pending row for
    -- someone who's already in.
    insert into members (org_id, user_id, role, invited_by, joined_at)
    values (v_invite.org_id, p_user_id, v_invite.role, v_invite.invited_by, now())
    on conflict (org_id, user_id) do nothing;

    update invites set consumed_at = now(), consumed_by = p_user_id where id = v_invite.id;
  end loop;
end;
$$;

create or replace function atlas.consume_invites_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform atlas.consume_invites_for_user(new.id, new.email);
  return new;
end;
$$;

create trigger auth_users_consume_invites
  after insert on auth.users
  for each row execute function atlas.consume_invites_for_new_user();

create or replace function atlas.consume_my_invites()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  perform atlas.consume_invites_for_user(auth.uid(), v_email);
end;
$$;

revoke all on function atlas.consume_my_invites from public;
grant execute on function atlas.consume_my_invites to authenticated;

-- ---------------------------------------------------------------------------
-- RLS (SPEC §9 pattern) — mirrors members_insert/members_select/
-- members_delete's own owner-only shape exactly. No update policy and no
-- update grant: consumed_at/consumed_by are written only by the security
-- definer functions above, never by a client write.
-- ---------------------------------------------------------------------------

alter table invites enable row level security;
alter table invites force row level security;

create policy invites_select on invites
  for select to authenticated
  using (atlas.has_role(org_id, 'owner'));

create policy invites_insert on invites
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner') and invited_by = auth.uid());

create policy invites_delete on invites
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner'));

grant select, insert, delete on invites to authenticated;
