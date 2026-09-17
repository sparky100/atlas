-- Platform administrator role (resolved with the human directly): the
-- first cross-org authorization concept this schema has ever had.
-- `platform_config` (20260917020000_platform_config.sql) was locked to
-- service-role-only access precisely because no such role existed yet —
-- this migration closes that gap, narrowly: a platform admin can view and
-- change the `llm-proxy` edge function's own application-level settings
-- (docs/PLATFORM-ADMIN.md), nothing else.
--
-- A dedicated table, not a boolean column on `atlas.profiles`: `profiles`
-- is readable by any fellow org member (its own `profiles_select` policy),
-- so a flag placed there would leak "who is a platform admin" to every
-- org-mate of every admin. `platform_admins` matches this schema's own
-- existing idiom instead — presence in a table is the fact, the same
-- shape `members` already uses for org membership — with its own
-- self-row-only select policy, so the only thing a client can ever learn
-- from this table is its own status, never anyone else's.
--
-- No insert/update/delete grant to `authenticated` at all: granting or
-- revoking platform-admin status is service-role/SQL only, the same
-- deliberate "no self-serve path" convention `platform_config` itself
-- already established (docs/EDGE-FUNCTIONS.md). There is no "manage
-- other admins" UI in this migration or the PR it ships with — a real,
-- named gap (CLAUDE.md rule 7), not silently implied to exist.

create table platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now()
);

comment on table platform_admins is 'Atlas''s first cross-org role. Presence in this table is platform-admin status, granted only by a service-role/SQL insert (docs/PLATFORM-ADMIN.md) — no client insert/update/delete path exists. Self-row select only.';

alter table platform_admins enable row level security;
alter table platform_admins force row level security;

create policy platform_admins_select_self on platform_admins
  for select to authenticated
  using (user_id = auth.uid());

grant select on platform_admins to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.is_platform_admin(): mirrors atlas.is_member(org_id)'s own shape
-- (20260906071200_tenancy.sql), minus the org parameter — this check has
-- no org to scope to. Used only inside the two security-definer RPCs
-- below, never called directly from the client (the client instead reads
-- its own row from platform_admins, the same "plain table read" pattern
-- src/db/organisations.ts's getMyMembership already uses for org roles).
-- ---------------------------------------------------------------------------

create or replace function atlas.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

revoke all on function atlas.is_platform_admin() from public;

-- ---------------------------------------------------------------------------
-- atlas.get_platform_llm_config() / atlas.set_platform_llm_config(): the
-- only client-reachable path into platform_config's own 'llm' row — that
-- table itself gets no new RLS policy at all here, staying exactly as
-- locked down as 20260917020000_platform_config.sql already left it.
-- Both functions re-derive atlas.is_platform_admin() themselves (never
-- trust a client claim, this schema's universal pattern) and raise on
-- failure rather than silently returning nothing.
--
-- get_platform_llm_config never returns the raw API key — only
-- has_api_key — so the UI never needs to display or round-trip a live
-- secret. set_platform_llm_config leaves an existing key untouched
-- unless a new one is supplied or p_clear_api_key is explicitly true,
-- the same "leave blank to keep current" convention a masked secret
-- field implies without this schema needing an actual masked-field type.
-- ---------------------------------------------------------------------------

create or replace function atlas.get_platform_llm_config()
returns table (model text, rate_limit_per_hour integer, has_api_key boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  if not atlas.is_platform_admin() then
    raise exception 'get_platform_llm_config: platform admin only' using errcode = '42501';
  end if;

  select pc.value into v_value from platform_config pc where pc.key = 'llm';

  return query select
    v_value ->> 'model',
    nullif(v_value ->> 'rateLimitPerHour', '')::integer,
    coalesce(v_value ->> 'apiKey', '') <> '';
end;
$$;

create or replace function atlas.set_platform_llm_config(
  p_model text,
  p_rate_limit_per_hour integer,
  p_api_key text default null,
  p_clear_api_key boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing jsonb;
  v_next jsonb;
begin
  if not atlas.is_platform_admin() then
    raise exception 'set_platform_llm_config: platform admin only' using errcode = '42501';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'set_platform_llm_config: model is required' using errcode = '22023';
  end if;
  if p_rate_limit_per_hour is null or p_rate_limit_per_hour <= 0 then
    raise exception 'set_platform_llm_config: rateLimitPerHour must be a positive integer' using errcode = '22023';
  end if;

  select pc.value into v_existing from platform_config pc where pc.key = 'llm';
  v_next := jsonb_build_object('model', p_model, 'rateLimitPerHour', p_rate_limit_per_hour);

  if p_clear_api_key then
    null; -- omit apiKey entirely -- llm-proxy's own loadConfig falls back to ANTHROPIC_API_KEY
  elsif p_api_key is not null and btrim(p_api_key) <> '' then
    v_next := v_next || jsonb_build_object('apiKey', p_api_key);
  elsif v_existing ? 'apiKey' then
    v_next := v_next || jsonb_build_object('apiKey', v_existing ->> 'apiKey'); -- untouched, kept as-is
  end if;

  insert into platform_config (key, value, updated_at)
  values ('llm', v_next, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;

revoke all on function atlas.get_platform_llm_config() from public;
revoke all on function atlas.set_platform_llm_config(text, integer, text, boolean) from public;
grant execute on function atlas.get_platform_llm_config() to authenticated;
grant execute on function atlas.set_platform_llm_config(text, integer, text, boolean) to authenticated;
