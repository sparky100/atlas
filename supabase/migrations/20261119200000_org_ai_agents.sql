-- Phase D step 1 (Simon, 2026-11-19): agents run on the organisation's OWN AI
-- key, and only when an owner switches them on. Ask Atlas, capture and help
-- keep using the platform key, unchanged.
--
-- What this adds, and who can see or change what:
--   * organisations.ai_agents_enabled  (default false): owner-only through the
--     existing `organisations_update` policy plus a column grant, exactly like
--     `ai_assistant_enabled` / `ai_share_run_cost`.
--   * organisations.ai_agent_key_set   (default false): whether a key is saved.
--     It is a plain boolean so the UI can show "set / not set"; NO client role
--     may update it (no column grant), only the service-only functions below.
--   * The key itself lives in Supabase Vault under `org:<org id>:llm_api_key`.
--     It is never in a table column, never returned by any function a client
--     can call, and never logged.
--
-- Advisor note (CLAUDE.md rule 9): the three functions are executable by
-- `service_role` ONLY (revoked from public, anon and authenticated), so they
-- add no "signed-in users can execute a SECURITY DEFINER function" finding.
-- An edge function (`org-ai-key`) checks that the caller is an owner of the
-- organisation, then calls them with the service role. Each function also
-- refuses any caller whose role is not service_role, written fail-closed.

alter table organisations add column ai_agents_enabled boolean not null default false;
alter table organisations add column ai_agent_key_set boolean not null default false;

grant update (ai_agents_enabled) on organisations to authenticated;

-- Save or replace the organisation's key. Returns nothing: never echoes it.
create or replace function atlas.set_org_ai_key(p_org uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_name text := 'org:' || p_org::text || ':llm_api_key';
  v_secret_id uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception 'Enter the key.' using errcode = '22023';
  end if;
  if length(btrim(p_key)) > 512 then
    raise exception 'That key is too long.' using errcode = '22023';
  end if;
  if not exists (select 1 from organisations o where o.id = p_org) then
    raise exception 'No such organisation.' using errcode = '22023';
  end if;
  select s.id into v_secret_id from vault.secrets s where s.name = v_name;
  if v_secret_id is null then
    perform vault.create_secret(btrim(p_key), v_name, 'Organisation AI key for agents (Phase D)');
  else
    perform vault.update_secret(v_secret_id, btrim(p_key));
  end if;
  update organisations set ai_agent_key_set = true where id = p_org;
end;
$$;

-- Remove the key. Agents go off with it: no key, no agents.
create or replace function atlas.clear_org_ai_key(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from vault.secrets where name = 'org:' || p_org::text || ':llm_api_key';
  update organisations set ai_agent_key_set = false, ai_agents_enabled = false where id = p_org;
end;
$$;

-- The key, for the agent edge function only (service role).
create or replace function atlas.org_ai_api_key(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_key text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'org:' || p_org::text || ':llm_api_key';
  return v_key;
end;
$$;

revoke all on function atlas.set_org_ai_key(uuid, text) from public, anon, authenticated;
revoke all on function atlas.clear_org_ai_key(uuid) from public, anon, authenticated;
revoke all on function atlas.org_ai_api_key(uuid) from public, anon, authenticated;
grant execute on function atlas.set_org_ai_key(uuid, text) to service_role;
grant execute on function atlas.clear_org_ai_key(uuid) to service_role;
grant execute on function atlas.org_ai_api_key(uuid) to service_role;

-- A deleted organisation must not leave its key behind in Vault.
create or replace function atlas.drop_org_ai_key_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
begin
  delete from vault.secrets where name = 'org:' || old.id::text || ':llm_api_key';
  return old;
end;
$$;

revoke all on function atlas.drop_org_ai_key_on_delete() from public, anon, authenticated;

create trigger organisations_drop_ai_key
  after delete on organisations
  for each row execute function atlas.drop_org_ai_key_on_delete();
