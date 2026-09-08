-- Sprint M1a step 1: atlas.profiles (SPEC §3.2 amendment, ADR-009 amendment).
--
-- A user's public identity, decoupled from auth.users.email. Nothing in
-- this product has ever needed to show one member to another before now —
-- there is no member directory, no invite UI (SPEC §11 lists both as
-- deferred to U4) — so this is the first table that exposes anything about
-- a fellow org member at all. It deliberately carries no email column: a
-- handle *derived* from the email's local part at creation is not the same
-- thing as exposing the email itself, and nothing here or anywhere else
-- reads auth.users.email back out for another member to see.
--
-- Lives in the `atlas` schema (already exposed to PostgREST,
-- 20260906165000_expose_atlas_schema.sql) rather than `public` — it is
-- infrastructure identity, not model content, the same distinction that
-- already separates every atlas.* RPC from the tables in `public` those
-- RPCs write. Client reads/writes go through `.schema('atlas')`, same as
-- every atlas.* RPC call already does (src/db/commits.ts's own comment).

create table atlas.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  handle text not null,
  avatar_url text,
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format check (handle ~ '^[a-z0-9_-]+$'),
  constraint profiles_handle_unique unique (handle)
);

comment on table atlas.profiles is 'A user''s public identity (SPEC §3.2 amendment, ADR-009 amendment) — display_name, a global lowercase handle, avatar_url. No email column: email is never exposed to fellow members. Created by atlas.ensure_profile on first membership; editable by the user only; readable by fellow org members.';

create trigger profiles_touch_updated_at
  before update on atlas.profiles
  for each row execute function atlas.touch_updated_at();

-- ---------------------------------------------------------------------------
-- atlas.ensure_profile: creates a profile the first time a user joins any
-- organisation (fires on every `members` insert, but is a no-op after the
-- first — a person's profile is global, not per-org). The default handle is
-- the email's local part, lowercased and sanitised to the same charset the
-- unique constraint requires; a collision appends -2, -3, ... until one is
-- free, so two people who both happen to be "alex@" never fight over one
-- handle silently overwriting the other's row.
-- ---------------------------------------------------------------------------

create or replace function atlas.ensure_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_local text;
  v_handle text;
  v_suffix int := 1;
begin
  if exists (select 1 from atlas.profiles where user_id = new.user_id) then
    return new;
  end if;

  select email into v_email from auth.users where id = new.user_id;
  v_local := lower(coalesce(split_part(v_email, '@', 1), ''));
  v_local := regexp_replace(v_local, '[^a-z0-9_-]', '-', 'g');
  if v_local = '' then
    v_local := 'user';
  end if;
  v_handle := v_local;

  loop
    begin
      insert into atlas.profiles (user_id, handle) values (new.user_id, v_handle);
      exit;
    exception when unique_violation then
      v_suffix := v_suffix + 1;
      v_handle := v_local || '-' || v_suffix::text;
    end;
  end loop;

  return new;
end;
$$;

create trigger members_ensure_profile
  after insert on members
  for each row execute function atlas.ensure_profile();

-- ---------------------------------------------------------------------------
-- RLS (SPEC §9 pattern): readable by fellow org members (any shared org, any
-- role — a handle/display name is not sensitive the way an email is), the
-- user's own row always readable even before it shares an org with anyone
-- else. Editable by the user only. No insert/delete policy for
-- `authenticated`: rows are created only by atlas.ensure_profile and never
-- deleted (the FK's `on delete cascade` is the only way one goes away, when
-- the underlying auth.users row does).
-- ---------------------------------------------------------------------------

alter table atlas.profiles enable row level security;
alter table atlas.profiles force row level security;

create policy profiles_select on atlas.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from members m1
      join members m2 on m2.org_id = m1.org_id
      where m1.user_id = auth.uid() and m2.user_id = atlas.profiles.user_id
    )
  );

create policy profiles_update on atlas.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on atlas.profiles to authenticated;
grant update (display_name, handle, avatar_url, updated_at) on atlas.profiles to authenticated;
