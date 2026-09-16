-- Sprint F7 item 5: membership audit. Nothing before this migration logs a
-- membership-lifecycle change of any kind — once an invite is revoked or a
-- member removed, no record they ever existed survives. `member_events` is
-- genuinely new schema, not a screen on top of an existing table (the F7
-- plan's own decision 9): append-only, owner-only select, no client
-- insert/update/delete grant at all — every row is written by exactly one
-- of the five triggers below.

create table member_events (
  id uuid primary key,
  org_id uuid not null references organisations (id) on delete cascade,
  event_type text not null check (event_type in ('invited', 'invite_revoked', 'joined', 'role_changed', 'removed', 'left')),
  target_user_id uuid references auth.users (id),
  target_email text,
  actor_id uuid references auth.users (id),
  role member_role,
  previous_role member_role,
  created_at timestamptz not null default now()
);

comment on table member_events is 'F7 item 5: an append-only audit trail of every membership-lifecycle change on an organisation (invited/invite_revoked/joined/role_changed/removed/left). Written only by the five triggers below — never a client insert/update/delete. Owner-only select.';

create index member_events_org_id_created_at_idx on member_events (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers. All security definer (the same "narrow the grant, trigger does
-- the rest" shape atlas.ensure_profile/atlas.process_comment_mentions
-- already use), all firing AFTER the write they narrate — a write that gets
-- refused (atlas.guard_last_owner's own before-trigger, most obviously)
-- never leaves a stray event behind, since the whole transaction rolls back
-- before any AFTER trigger runs.
--
-- Two of the five (record_invite_revoked, record_member_removed) guard on
-- "does this organisation still exist" before inserting: atlas.delete_organisation
-- cascades straight through invites and members (both `on delete cascade`
-- from organisations), and a plain insert here would otherwise race that
-- same cascade — by the time an AFTER DELETE trigger on invites/members
-- fires as a consequence of the organisations row itself being deleted in
-- the same transaction, that organisations row is already gone, so an
-- unguarded insert referencing it would fail the FK outright. An audit row
-- for an organisation that no longer exists has no possible reader anyway
-- (member_events' own RLS requires being an owner of it), so skipping it is
-- the correct behaviour, not a workaround for a bug. The other three
-- (record_invite_created, record_member_joined, record_member_role_changed)
-- fire on INSERT/UPDATE, which a DELETE cascade never triggers — no guard
-- needed there.
-- ---------------------------------------------------------------------------

create or replace function atlas.record_invite_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into member_events (id, org_id, event_type, target_email, actor_id, role)
  values (gen_random_uuid(), new.org_id, 'invited', new.email, new.invited_by, new.role);
  return new;
end;
$$;

create trigger invites_record_created
  after insert on invites
  for each row execute function atlas.record_invite_created();

-- A consumed invite row is never deleted (`atlas.consume_invites_for_user`
-- only ever updates `consumed_at`/`consumed_by`) — so a delete of an
-- unconsumed row always means a real revoke (`revokeInvite`), never
-- incidental cleanup.
create or replace function atlas.record_invite_revoked()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from organisations where id = old.org_id) then
    insert into member_events (id, org_id, event_type, target_email, actor_id, role)
    values (gen_random_uuid(), old.org_id, 'invite_revoked', old.email, auth.uid(), old.role);
  end if;
  return old;
end;
$$;

create trigger invites_record_revoked
  after delete on invites
  for each row when (old.consumed_at is null)
  execute function atlas.record_invite_revoked();

-- Fires for every path that inserts a members row: a fresh organisation's
-- own owner (atlas.on_organisation_created — invited_by is the creator
-- themself), invite consumption (atlas.consume_invites_for_user —
-- invited_by is the original inviter), and an owner adding someone
-- directly (members_insert's own RLS already requires invited_by =
-- auth.uid()).
create or replace function atlas.record_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into member_events (id, org_id, event_type, target_user_id, actor_id, role)
  values (gen_random_uuid(), new.org_id, 'joined', new.user_id, new.invited_by, new.role);
  return new;
end;
$$;

create trigger members_record_joined
  after insert on members
  for each row execute function atlas.record_member_joined();

create or replace function atlas.record_member_role_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into member_events (id, org_id, event_type, target_user_id, actor_id, role, previous_role)
  values (gen_random_uuid(), new.org_id, 'role_changed', new.user_id, auth.uid(), new.role, old.role);
  return new;
end;
$$;

create trigger members_record_role_changed
  after update on members
  for each row when (old.role is distinct from new.role)
  execute function atlas.record_member_role_changed();

-- 'removed' (someone else's doing) vs 'left' (their own) — members_delete's
-- own RLS already draws exactly this line (owner removes anyone; anyone may
-- remove themself), so auth.uid() = old.user_id is the same test repeated
-- here for the sentence, not a new rule.
create or replace function atlas.record_member_removed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from organisations where id = old.org_id) then
    insert into member_events (id, org_id, event_type, target_user_id, actor_id, role)
    values (gen_random_uuid(), old.org_id, case when auth.uid() = old.user_id then 'left' else 'removed' end, old.user_id, auth.uid(), old.role);
  end if;
  return old;
end;
$$;

create trigger members_record_removed
  after delete on members
  for each row execute function atlas.record_member_removed();

-- ---------------------------------------------------------------------------
-- RLS — owner-only select, the same shape invites_select already uses. No
-- insert/update/delete grant to authenticated at all: every row is
-- trigger-populated only.
-- ---------------------------------------------------------------------------

alter table member_events enable row level security;
alter table member_events force row level security;

create policy member_events_select on member_events
  for select to authenticated
  using (atlas.has_role(org_id, 'owner'));

grant select on member_events to authenticated;
