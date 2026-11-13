-- Microsoft Entra sign-in: an organisation records its company's Microsoft
-- tenant ID once; anyone who signs in with a work Microsoft account from that
-- tenant joins the organisation as a Viewer.
--
--   org_entra_tenants — one row per organisation (org_id unique) naming its
--     Microsoft tenant. The tenant is unique across ALL organisations
--     (tenant_id unique): a tenant maps to exactly one organisation, so a
--     sign-in can never be ambiguous, and one organisation cannot claim
--     another's company. Owner-only select; written only through
--     atlas.set_entra_tenant / atlas.clear_entra_tenant (owner only).
--   atlas.entra_tenant_of_identity — pulls the tenant ID out of the identity
--     Supabase stored for a Microsoft sign-in (written by Supabase Auth from
--     the verified Microsoft token; a client cannot edit auth.identities).
--   atlas.join_my_entra_org — called once per sign-in. Never trusts a
--     client-supplied tenant: reads the caller's own Microsoft identity.
--
-- Joining goes through the members table, so member_events records the
-- 'joined' event like any other new member. Nothing is removed automatically:
-- a leaver's Microsoft account being disabled stops them signing in, and an
-- owner removes the membership.

create table org_entra_tenants (
  org_id uuid primary key references organisations (id) on delete cascade,
  tenant_id uuid not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table org_entra_tenants is 'The Microsoft Entra tenant an organisation''s people sign in from. One per organisation; a tenant belongs to at most one organisation. Written only through atlas.set_entra_tenant / clear_entra_tenant (owner).';

alter table org_entra_tenants enable row level security;
alter table org_entra_tenants force row level security;

create policy org_entra_tenants_select on org_entra_tenants
  for select to authenticated
  using (atlas.has_role(org_id, 'owner'));

grant select on org_entra_tenants to authenticated;

create or replace function atlas.set_entra_tenant(p_org_id uuid, p_tenant_id uuid)
returns org_entra_tenants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row org_entra_tenants;
begin
  if not atlas.has_role(p_org_id, 'owner') then
    raise exception 'Only an owner can change Microsoft sign-in.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_tenant_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Enter your company''s Microsoft tenant ID.' using errcode = '22023';
  end if;
  begin
    insert into org_entra_tenants (org_id, tenant_id, created_by)
    values (p_org_id, p_tenant_id, auth.uid())
    on conflict (org_id) do update set tenant_id = excluded.tenant_id, created_by = excluded.created_by, created_at = now()
    returning * into v_row;
  exception when unique_violation then
    raise exception 'That Microsoft tenant is already connected to another organisation.' using errcode = '23505';
  end;
  return v_row;
end;
$$;

create or replace function atlas.clear_entra_tenant(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not atlas.has_role(p_org_id, 'owner') then
    raise exception 'Only an owner can change Microsoft sign-in.' using errcode = '42501';
  end if;
  delete from org_entra_tenants where org_id = p_org_id;
end;
$$;

-- The Microsoft tenant a stored identity came from: the `tid` claim when
-- Supabase kept it, otherwise the tenant segment of the token issuer
-- (https://login.microsoftonline.com/<tenant>/v2.0). Null if neither parses.
create or replace function atlas.entra_tenant_of_identity(p_identity_data jsonb)
returns uuid
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_text text;
begin
  v_text := coalesce(
    substring(p_identity_data #>> '{custom_claims,tid}' from '^[0-9a-fA-F-]{36}$'),
    substring(p_identity_data ->> 'tid' from '^[0-9a-fA-F-]{36}$'),
    substring(p_identity_data ->> 'iss' from 'login\.microsoftonline\.com/([0-9a-fA-F-]{36})/')
  );
  return v_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- The join itself, given a verified user and tenant. Split from the caller-
-- facing function so it can be exercised directly (service role only): the
-- caller-facing one reads the tenant from auth.identities, which no test
-- client can write.
--
-- Result is one of: 'joined' (new Viewer membership), 'already_member'
-- (membership untouched, whatever its role), 'unknown_tenant' (no
-- organisation has recorded this tenant).
create or replace function atlas.join_entra_org(p_user_id uuid, p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_inserted int;
begin
  select t.org_id into v_org from org_entra_tenants t where t.tenant_id = p_tenant_id;
  if v_org is null then
    return 'unknown_tenant';
  end if;
  insert into members (org_id, user_id, role, invited_by, joined_at)
  values (v_org, p_user_id, 'viewer', null, now())
  on conflict (org_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;
  return case when v_inserted = 1 then 'joined' else 'already_member' end;
end;
$$;

-- Caller-facing, once per sign-in. Never trusts a client-supplied tenant: it
-- reads the caller's own Microsoft identity. Adds 'not_microsoft' (no
-- Microsoft identity, or no readable tenant on it).
create or replace function atlas.join_my_entra_org()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    return 'not_microsoft';
  end if;
  select atlas.entra_tenant_of_identity(i.identity_data) into v_tenant
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'azure'
  order by i.created_at
  limit 1;
  if v_tenant is null then
    return 'not_microsoft';
  end if;
  return atlas.join_entra_org(auth.uid(), v_tenant);
end;
$$;

revoke all on function atlas.set_entra_tenant(uuid, uuid) from public;
revoke all on function atlas.clear_entra_tenant(uuid) from public;
revoke all on function atlas.entra_tenant_of_identity(jsonb) from public;
revoke all on function atlas.join_entra_org(uuid, uuid) from public;
revoke all on function atlas.join_my_entra_org() from public;
grant execute on function atlas.set_entra_tenant(uuid, uuid) to authenticated;
grant execute on function atlas.clear_entra_tenant(uuid) to authenticated;
grant execute on function atlas.join_my_entra_org() to authenticated;
grant execute on function atlas.join_entra_org(uuid, uuid) to service_role;
grant execute on function atlas.entra_tenant_of_identity(jsonb) to service_role;
