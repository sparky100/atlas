-- Read-only API (docs/ADR-031-read-only-api.md): per-organisation API keys.
--
--   api_keys       one row per key. Only a SHA-256 hash of the key is stored,
--                  plus a short visible prefix so an owner can recognise it.
--                  The full key exists exactly once: in the return value of
--                  atlas.create_api_key, shown to the owner one time.
--   api_key_usage  per-key, per-minute request counts: the rate limit is a
--                  fixed window counted here, nothing else to keep in step.
--
-- Revoking sets revoked_at (a retirement, never a delete). Nothing here is a
-- fact about the architecture: keys and counters are access bookkeeping.
--
-- Who can do what:
--   * owners read key rows (never key_hash: column grant) and create / revoke
--     keys through the two security-definer functions below;
--   * the `api` edge function (service role) calls atlas.api_key_authorize,
--     which checks the hash, counts the request and returns the key's org.

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table api_keys is 'Read-only API keys (ADR-031): hash only, never the key itself. Created and revoked through atlas.create_api_key / atlas.revoke_api_key (owner); checked by the api edge function through atlas.api_key_authorize (service role).';
comment on column api_keys.key_hash is 'Hex SHA-256 of the full key. Not selectable by any client role.';

create index api_keys_org_id_idx on api_keys (org_id, created_at desc);

alter table api_keys enable row level security;
alter table api_keys force row level security;

create policy api_keys_select on api_keys
  for select to authenticated
  using (atlas.has_role(org_id, 'owner'));

revoke all on api_keys from anon, authenticated;
grant select (id, org_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at) on api_keys to authenticated;

create table api_key_usage (
  key_id uuid not null references api_keys (id) on delete cascade,
  window_start timestamptz not null,
  request_count int not null default 0,
  primary key (key_id, window_start)
);

comment on table api_key_usage is 'Per-minute request counts for the read-only API rate limit. Written only by atlas.api_key_authorize.';

alter table api_key_usage enable row level security;
alter table api_key_usage force row level security;
revoke all on api_key_usage from anon, authenticated;

-- Create a key. Returns the full key once; it cannot be read back.
create or replace function atlas.create_api_key(p_org_id uuid, p_name text)
returns table (id uuid, name text, key_prefix text, created_at timestamptz, token text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_token text;
  v_row api_keys;
begin
  if not atlas.has_role(p_org_id, 'owner') then
    raise exception 'Only an owner can create an API key.' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Give the key a name of 1 to 80 characters.' using errcode = '22023';
  end if;
  if (select count(*) from api_keys k where k.org_id = p_org_id and k.revoked_at is null) >= 20 then
    raise exception 'An organisation can have at most 20 active API keys. Revoke one first.' using errcode = '22023';
  end if;
  -- Two random UUIDs (gen_random_uuid draws from the database's secure random
  -- source): 244 random bits, hex-encoded, behind a recognisable prefix.
  v_token := 'atl_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into api_keys (org_id, name, key_prefix, key_hash, created_by)
  values (p_org_id, v_name, left(v_token, 12), encode(sha256(convert_to(v_token, 'utf8')), 'hex'), auth.uid())
  returning * into v_row;
  return query select v_row.id, v_row.name, v_row.key_prefix, v_row.created_at, v_token;
end;
$$;

revoke all on function atlas.create_api_key(uuid, text) from public, anon;
grant execute on function atlas.create_api_key(uuid, text) to authenticated;

-- Revoke a key: it stops working at once. The row stays, so the list shows
-- what existed and when it was last used.
create or replace function atlas.revoke_api_key(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select k.org_id into v_org from api_keys k where k.id = p_key_id;
  if v_org is null or not atlas.has_role(v_org, 'owner') then
    raise exception 'Only an owner can revoke an API key.' using errcode = '42501';
  end if;
  update api_keys set revoked_at = now() where id = p_key_id and revoked_at is null;
end;
$$;

revoke all on function atlas.revoke_api_key(uuid) from public, anon;
grant execute on function atlas.revoke_api_key(uuid) to authenticated;

-- Called by the api edge function with the service role. Returns no row for an
-- unknown or revoked key. Otherwise counts this request in the current
-- one-minute window and says whether it is within p_limit.
create or replace function atlas.api_key_authorize(p_key_hash text, p_limit int)
returns table (key_id uuid, org_id uuid, allowed boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_key api_keys;
  v_window timestamptz := date_trunc('minute', now());
  v_count int;
begin
  select * into v_key from api_keys k where k.key_hash = p_key_hash and k.revoked_at is null;
  if not found then
    return;
  end if;
  insert into api_key_usage as u (key_id, window_start, request_count)
  values (v_key.id, v_window, 1)
  on conflict on constraint api_key_usage_pkey do update set request_count = u.request_count + 1
  returning u.request_count into v_count;
  if v_count = 1 then
    update api_keys set last_used_at = now() where id = v_key.id;
    delete from api_key_usage where api_key_usage.key_id = v_key.id and window_start < v_window - interval '1 hour';
  end if;
  return query select v_key.id, v_key.org_id, v_count <= p_limit, greatest(1, ceil(extract(epoch from (v_window + interval '1 minute' - now())))::int);
end;
$$;

revoke all on function atlas.api_key_authorize(text, int) from public, anon, authenticated;
grant execute on function atlas.api_key_authorize(text, int) to service_role;
