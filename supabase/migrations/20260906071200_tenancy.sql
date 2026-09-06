-- Sprint F1 step 2: foundations schema, part 3 of 8.
--
-- organisations and members (SPEC-data-model.md §3.2, ADR-009), the
-- atlas.member_role / is_member / has_role helpers every later RLS policy in
-- this repo builds on (§9), and the two triggers that make "an organisation
-- always has an owner" true by construction rather than by convention.

create table organisations (
  id uuid primary key,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,63}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table organisations is 'One tenant. Every other row hangs off one of these (ADR-009).';

-- No org_id: this table is the org (SPEC §2).

create table members (
  org_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null,
  invited_by uuid references auth.users (id),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

comment on table members is 'Who belongs to an organisation and with what role (ADR-009).';

create index members_user_id_idx on members (user_id);

-- ---------------------------------------------------------------------------
-- RLS helpers (SPEC §9). security definer + a fixed search_path so they can
-- be called from any table's policy without that table needing its own
-- grant on `members`, and without a hostile search_path substituting a
-- different `members` relation.
-- ---------------------------------------------------------------------------

create or replace function atlas.member_role(p_org uuid)
returns member_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role from members m
  where m.org_id = p_org and m.user_id = auth.uid();
$$;

create or replace function atlas.is_member(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from members m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create or replace function atlas.has_role(p_org uuid, variadic p_roles member_role[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select atlas.member_role(p_org) = any (p_roles);
$$;

-- ---------------------------------------------------------------------------
-- Triggers: the creator of an organisation becomes its owner, and an
-- organisation can never be left without one (ADR-009's "one or two
-- architects" reality still needs at least one owner to exist).
-- ---------------------------------------------------------------------------

create or replace function atlas.on_organisation_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into members (org_id, user_id, role, invited_by, joined_at)
  values (new.id, new.created_by, 'owner', new.created_by, now());
  return new;
end;
$$;

create trigger organisations_create_owner
  after insert on organisations
  for each row execute function atlas.on_organisation_created();

create or replace function atlas.guard_last_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  remaining_owners int;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
  end if;

  select count(*) into remaining_owners
  from members
  where org_id = old.org_id and role = 'owner' and user_id <> old.user_id;

  if remaining_owners = 0 then
    raise exception 'an organisation must always have at least one owner' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger members_guard_last_owner
  before update or delete on members
  for each row execute function atlas.guard_last_owner();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table organisations enable row level security;
alter table organisations force row level security;

create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id));

-- Anyone signed in may create an org; the trigger above makes them its owner.
create policy organisations_insert on organisations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy organisations_update on organisations
  for update to authenticated
  using (atlas.has_role(id, 'owner'))
  with check (atlas.has_role(id, 'owner'));

create policy organisations_delete on organisations
  for delete to authenticated
  using (atlas.has_role(id, 'owner'));

grant select, insert, update, delete on organisations to authenticated;

alter table members enable row level security;
alter table members force row level security;

create policy members_select on members
  for select to authenticated
  using (atlas.is_member(org_id));

create policy members_insert on members
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner') and invited_by = auth.uid());

create policy members_update on members
  for update to authenticated
  using (atlas.has_role(org_id, 'owner'))
  with check (atlas.has_role(org_id, 'owner'));

-- Owners remove anyone; anyone may leave. atlas.guard_last_owner stops an
-- org losing its last owner either way.
create policy members_delete on members
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner') or user_id = auth.uid());

grant select, insert, update, delete on members to authenticated;
