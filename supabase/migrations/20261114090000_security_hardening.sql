-- Security hardening, from the 14 Nov 2026 assessment
-- (project files: security/SECURITY-ASSESSMENT-2026-11-14.md). Atlas objects only.
--
--   1. atlas.consume_invites_for_user(user, email) was callable by anyone, signed
--      in or not, with no check on the caller: it adds the given user to every
--      organisation with a pending invite for the given email, at the invited
--      role. It is only meant to run from the sign-up trigger and from
--      atlas.consume_my_invites. Nobody can call it through the API any more.
--   2. No SECURITY DEFINER function in the atlas schema is callable by the
--      signed-out role (anon) any more, and trigger-only helpers are not
--      callable by anyone through the API. Functions created from now on are
--      not callable by anon by default.
--   3. Guards written `if not atlas.has_role(...)` are rewritten fail-closed,
--      `atlas.has_role(...) is not true`, so a NULL can never let a caller
--      through even if has_role changes again.
--   4. The platform AI provider key moves out of plain JSON in platform_config
--      into Supabase Vault (as connector secrets already are). The row keeps
--      provider, model and rate limit only. llm-proxy reads the key through a
--      service-role-only function.
--   5. atlas.squash_name gets a pinned search_path.
--
-- DEPLOY ORDER: deploy the llm-proxy edge function first
-- (`supabase functions deploy llm-proxy`), then push this migration. The new
-- llm-proxy still reads a legacy key from platform_config, so it works before
-- and after; the old llm-proxy would lose the key once this migration runs.

-- 1 and 2: who can call what ------------------------------------------------

do $$
declare
  r record;
  v_auth oid[];
  v_service oid[];
begin
  -- Many of these functions were created without an explicit revoke, so their
  -- callers got access through the default "everyone" (PUBLIC) grant. Revoking
  -- PUBLIC would also take that away from signed-in users and from the edge
  -- functions' service role, so record who can call what first and grant it back
  -- explicitly afterwards. Only signed-out (anon) access is meant to go.
  select array_agg(p.oid) into v_auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas' and p.prokind = 'f' and p.prosecdef
    and p.prorettype <> 'trigger'::regtype
    and p.proname not in ('consume_invites_for_user', 'branch_reaches_commit')
    and has_function_privilege('authenticated', p.oid, 'execute');
  select array_agg(p.oid) into v_service
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas' and p.prokind = 'f' and p.prosecdef
    and has_function_privilege('service_role', p.oid, 'execute');

  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas' and p.prokind = 'f' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;

  -- Trigger functions are fired by the database, never called through the API.
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas' and p.prokind = 'f' and p.prosecdef and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;

  for r in select unnest(coalesce(v_auth, '{}'::oid[]))::regprocedure as sig loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in select unnest(coalesce(v_service, '{}'::oid[]))::regprocedure as sig loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- Internal helpers: only other owner-run functions call these.
revoke execute on function atlas.consume_invites_for_user(uuid, text) from public, anon, authenticated;
revoke execute on function atlas.branch_reaches_commit(uuid, uuid) from public, anon, authenticated;

-- Future atlas functions are not callable signed-out unless a migration grants it on purpose.
alter default privileges for role postgres in schema atlas revoke execute on functions from public, anon;

-- 3: fail-closed guards -------------------------------------------------------

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_left int;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~* '\mnot\s+(atlas\.)?has_role\s*\('
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(v_def, '\mnot\s+((?:atlas\.)?has_role)\s*\(([^()]*)\)', '\1(\2) is not true', 'gi');
    if v_new = v_def then
      raise exception 'security_hardening: could not rewrite the guard in atlas.%', r.proname;
    end if;
    execute v_new;
  end loop;

  select count(*) into v_left
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'atlas' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) ~* '\mnot\s+(atlas\.)?has_role\s*\(';
  if v_left <> 0 then
    raise exception 'security_hardening: % function(s) still guard with "not has_role"', v_left;
  end if;
end;
$$;

-- 4: the AI provider key lives in Vault ----------------------------------------

do $$
declare
  v_key text;
  v_secret_id uuid;
begin
  select pc.value ->> 'apiKey' into v_key from public.platform_config pc where pc.key = 'llm';
  if v_key is not null and btrim(v_key) <> '' then
    select s.id into v_secret_id from vault.secrets s where s.name = 'platform:llm_api_key';
    if v_secret_id is null then
      perform vault.create_secret(btrim(v_key), 'platform:llm_api_key', 'Platform AI provider key (moved from platform_config)');
    else
      perform vault.update_secret(v_secret_id, btrim(v_key));
    end if;
  end if;
  update public.platform_config set value = value - 'apiKey', updated_at = now() where key = 'llm' and value ? 'apiKey';
end;
$$;

create or replace function atlas.get_platform_llm_config()
returns table(provider text, model text, rate_limit_per_hour integer, has_api_key boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
begin
  if atlas.is_platform_admin() is not true then
    raise exception 'get_platform_llm_config: platform admin only' using errcode = '42501';
  end if;

  select pc.value into v_value from platform_config pc where pc.key = 'llm';

  return query select
    coalesce(v_value ->> 'provider', 'anthropic'),
    v_value ->> 'model',
    nullif(v_value ->> 'rateLimitPerHour', '')::integer,
    exists (select 1 from vault.secrets s where s.name = 'platform:llm_api_key');
end;
$$;

create or replace function atlas.set_platform_llm_config(
  p_model text,
  p_rate_limit_per_hour integer,
  p_provider text default 'anthropic',
  p_api_key text default null,
  p_clear_api_key boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret_id uuid;
begin
  if atlas.is_platform_admin() is not true then
    raise exception 'set_platform_llm_config: platform admin only' using errcode = '42501';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'set_platform_llm_config: model is required' using errcode = '22023';
  end if;
  if p_rate_limit_per_hour is null or p_rate_limit_per_hour <= 0 then
    raise exception 'set_platform_llm_config: rateLimitPerHour must be a positive integer' using errcode = '22023';
  end if;
  if p_provider is distinct from 'anthropic' then
    raise exception 'set_platform_llm_config: unsupported provider % (llm-proxy is Anthropic-only)', p_provider using errcode = '22023';
  end if;

  insert into platform_config (key, value, updated_at)
  values ('llm', jsonb_build_object('provider', p_provider, 'model', p_model, 'rateLimitPerHour', p_rate_limit_per_hour), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  -- The key itself goes to Vault and never into platform_config. Omitting
  -- p_api_key leaves a previously saved key untouched; clearing removes it, and
  -- llm-proxy then falls back to its ANTHROPIC_API_KEY function secret.
  if p_clear_api_key then
    delete from vault.secrets where name = 'platform:llm_api_key';
  elsif p_api_key is not null and btrim(p_api_key) <> '' then
    select s.id into v_secret_id from vault.secrets s where s.name = 'platform:llm_api_key';
    if v_secret_id is null then
      perform vault.create_secret(btrim(p_api_key), 'platform:llm_api_key', 'Platform AI provider key');
    else
      perform vault.update_secret(v_secret_id, btrim(p_api_key));
    end if;
  end if;
end;
$$;

-- Read by the llm-proxy edge function with the service-role key, nobody else.
create or replace function atlas.platform_llm_api_key()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'platform:llm_api_key';
$$;

revoke all on function atlas.platform_llm_api_key() from public, anon, authenticated;
grant execute on function atlas.platform_llm_api_key() to service_role;
revoke all on function atlas.get_platform_llm_config() from public, anon;
revoke all on function atlas.set_platform_llm_config(text, integer, text, text, boolean) from public, anon;
grant execute on function atlas.get_platform_llm_config() to authenticated;
grant execute on function atlas.set_platform_llm_config(text, integer, text, text, boolean) to authenticated;

-- 5: pinned search_path -----------------------------------------------------------

alter function atlas.squash_name(text) set search_path = '';
