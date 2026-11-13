-- Live connectors (docs/ADR-032-connectors.md): an organisation's saved
-- connection to another tool, starting with MuleSoft Anypoint.
--
--   org_connectors  one row per organisation and kind: the non-secret settings
--                   (jsonb) and a pointer to the secret. The secret itself (a
--                   client secret) lives only in Supabase Vault, encrypted at
--                   rest, and is never returned by any client-facing function.
--
-- A connector only *fetches* a file in the format its import source already
-- reads; the result goes through the ordinary capture pipeline (matching,
-- review queue, apply to a change). Nothing here writes model data.
--
-- Who can do what:
--   * owners and architects read connector rows (settings, last-fetch status);
--   * owners save and remove connectors through the two functions below;
--   * the connector-fetch edge function (service role) reads the secret with
--     atlas.connector_secret and records the outcome with
--     atlas.record_connector_fetch.

create extension if not exists supabase_vault with schema vault cascade;

create table org_connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  kind text not null check (kind in ('mulesoft')),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  secret_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_fetch_at timestamptz,
  last_fetch_status text check (last_fetch_status in ('ok', 'error')),
  last_fetch_message text,
  unique (org_id, kind)
);

comment on table org_connectors is 'An organisation''s saved connection to another tool (ADR-032). Settings only: the secret is in Supabase Vault (secret_id), never in this table.';
comment on column org_connectors.secret_id is 'The vault.secrets id holding the client secret. Not selectable by any client role.';

alter table org_connectors enable row level security;
alter table org_connectors force row level security;

create policy org_connectors_select on org_connectors
  for select to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'));

revoke all on org_connectors from anon, authenticated;
grant select (id, org_id, kind, config, created_by, created_at, updated_at, last_fetch_at, last_fetch_status, last_fetch_message) on org_connectors to authenticated;

-- Save a connector (create, or change its settings). p_secret is stored in
-- Vault; when it is empty on an existing connector the stored secret is kept,
-- so settings can be edited without re-entering it.
create or replace function atlas.save_connector(p_org_id uuid, p_kind text, p_config jsonb, p_secret text)
returns org_connectors
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
#variable_conflict use_column
declare
  v_existing org_connectors;
  v_secret_id uuid;
  v_row org_connectors;
  v_name text := 'connector:' || p_org_id::text || ':' || coalesce(p_kind, '');
begin
  if not atlas.has_role(p_org_id, 'owner') then
    raise exception 'Only an owner can set up a connector.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('mulesoft') then
    raise exception 'Unknown connector.' using errcode = '22023';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'The connector settings must be an object.' using errcode = '22023';
  end if;
  if pg_column_size(p_config) > 8192 then
    raise exception 'The connector settings are too large.' using errcode = '22023';
  end if;

  select * into v_existing from org_connectors c where c.org_id = p_org_id and c.kind = p_kind;

  if not found then
    if p_secret is null or btrim(p_secret) = '' then
      raise exception 'Enter the client secret.' using errcode = '22023';
    end if;
    v_secret_id := vault.create_secret(btrim(p_secret), v_name, 'Connector secret (ADR-032)');
    insert into org_connectors (org_id, kind, config, secret_id, created_by)
    values (p_org_id, p_kind, p_config, v_secret_id, auth.uid())
    returning * into v_row;
  else
    if p_secret is not null and btrim(p_secret) <> '' then
      perform vault.update_secret(v_existing.secret_id, btrim(p_secret));
    end if;
    update org_connectors
       set config = p_config, updated_at = now(), last_fetch_status = null, last_fetch_message = null
     where id = v_existing.id
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function atlas.save_connector(uuid, text, jsonb, text) from public, anon;
grant execute on function atlas.save_connector(uuid, text, jsonb, text) to authenticated;

-- Remove a connector and its stored secret.
create or replace function atlas.remove_connector(p_org_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
#variable_conflict use_column
declare
  v_secret_id uuid;
begin
  if not atlas.has_role(p_org_id, 'owner') then
    raise exception 'Only an owner can remove a connector.' using errcode = '42501';
  end if;
  select c.secret_id into v_secret_id from org_connectors c where c.org_id = p_org_id and c.kind = p_kind;
  if v_secret_id is null then
    return;
  end if;
  delete from org_connectors where org_id = p_org_id and kind = p_kind;
  delete from vault.secrets where id = v_secret_id;
end;
$$;

revoke all on function atlas.remove_connector(uuid, text) from public, anon;
grant execute on function atlas.remove_connector(uuid, text) to authenticated;

-- Service role only: the decrypted secret, for the connector-fetch function.
create or replace function atlas.connector_secret(p_connector_id uuid)
returns text
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select s.decrypted_secret
    from org_connectors c
    join vault.decrypted_secrets s on s.id = c.secret_id
   where c.id = p_connector_id;
$$;

revoke all on function atlas.connector_secret(uuid) from public, anon, authenticated;
grant execute on function atlas.connector_secret(uuid) to service_role;

-- Service role only: remember how the last fetch went (shown in settings).
create or replace function atlas.record_connector_fetch(p_connector_id uuid, p_status text, p_message text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('ok', 'error') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update org_connectors
     set last_fetch_at = now(), last_fetch_status = p_status, last_fetch_message = left(p_message, 500)
   where id = p_connector_id;
end;
$$;

revoke all on function atlas.record_connector_fetch(uuid, text, text) from public, anon, authenticated;
grant execute on function atlas.record_connector_fetch(uuid, text, text) to service_role;
