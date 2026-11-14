-- Platform admin overview: read-only lists of every organisation and every
-- person on the deployment, with usage, when they joined, and last use.
--
-- Fail closed: both functions raise unless atlas.is_platform_admin() is
-- exactly true (`is not true`, never `not`, so a NULL cannot slip through the
-- way atlas.has_role's NULL did, 20261113070000). They never consult org
-- roles: an Owner of every organisation still gets an error. Only a row in
-- platform_admins, written by service-role SQL, opens them.
--
-- Counts and dates only: no element names, descriptions or other model
-- content leave these functions. Emails come from auth.users and are
-- returned only to a platform admin.
--
-- Last use has two measures, shown separately: last_sign_in_at (auth) and
-- last_change_at (the newest commit the person authored, or for an
-- organisation the newest commit in it). Read-only access never makes a
-- commit, so last sign-in is the only signal for people who just read.

create or replace function atlas.platform_admin_organisations()
returns table (
  org_id uuid,
  name text,
  created_at timestamptz,
  member_count bigint,
  element_count bigint,
  changes_30d bigint,
  active_people_30d bigint,
  last_change_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if atlas.is_platform_admin() is not true then
    raise exception 'platform_admin_organisations: platform admin only' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.name,
    o.created_at,
    (select count(*) from members m where m.org_id = o.id),
    coalesce((
      select count(*)
      from branches b
      join elements_head eh on eh.commit_id = b.head_commit_id
      where b.org_id = o.id and b.kind = 'main'
    ), 0),
    (select count(*) from commits c where c.org_id = o.id and c.created_at >= now() - interval '30 days'),
    (select count(*) from members m join auth.users u on u.id = m.user_id
       where m.org_id = o.id and u.last_sign_in_at >= now() - interval '30 days'),
    (select max(c.created_at) from commits c where c.org_id = o.id),
    (select max(u.last_sign_in_at) from members m join auth.users u on u.id = m.user_id where m.org_id = o.id)
  from organisations o
  order by o.name;
end;
$$;

create or replace function atlas.platform_admin_people()
returns table (
  user_id uuid,
  email text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  last_change_at timestamptz,
  memberships jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if atlas.is_platform_admin() is not true then
    raise exception 'platform_admin_people: platform admin only' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    (select max(c.created_at) from commits c where c.author_id = u.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'orgId', m.org_id,
        'orgName', o.name,
        'role', m.role,
        'joinedAt', m.joined_at
      ) order by m.joined_at)
      from members m join organisations o on o.id = m.org_id
      where m.user_id = u.id
    ), '[]'::jsonb)
  from auth.users u
  order by u.created_at desc;
end;
$$;

revoke all on function atlas.platform_admin_organisations() from public;
revoke all on function atlas.platform_admin_people() from public;
grant execute on function atlas.platform_admin_organisations() to authenticated;
grant execute on function atlas.platform_admin_people() to authenticated;
