-- Canonical capability identities across sector map versions. Additive: no
-- existing map, seeded model, importer, catalogue reader or citation changes.
-- Empty on deployment; reviewed links are added separately, never inferred
-- from a name/code collision. See ADR-036.

create table public.reference_capabilities (
  id uuid primary key,
  stable_key text not null unique
    check (stable_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(stable_key) <= 100),
  created_at timestamptz not null default now()
);

create table public.reference_capability_revisions (
  capability_id uuid not null references public.reference_capabilities(id) on delete restrict,
  revision int not null check (revision >= 1),
  name text not null check (length(name) <= 200 and btrim(name) <> ''),
  definition text not null check (length(definition) <= 2000 and btrim(definition) <> ''),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (capability_id, revision),
  check ((status = 'published') = (published_at is not null))
);

create table public.reference_map_item_links (
  map_item_id uuid primary key references public.capability_map_items(id) on delete restrict,
  capability_id uuid not null,
  capability_revision int not null,
  review_basis text not null check (length(review_basis) <= 500 and btrim(review_basis) <> ''),
  mapped_by uuid not null,
  mapped_at timestamptz not null default now(),
  foreign key (capability_id, capability_revision)
    references public.reference_capability_revisions(capability_id, revision) on delete restrict
);

-- The reverse lookup is used by the future product reader and covers the
-- composite foreign key. No extra index is needed on the revision table:
-- its primary key already starts with capability_id.
create index reference_map_item_links_capability_idx
  on public.reference_map_item_links(capability_id, capability_revision);

comment on table public.reference_capabilities is 'Stable platform identity for a business capability shared across map versions and sectors; no organisation model fact is changed.';
comment on table public.reference_capability_revisions is 'Versioned meaning of a reference capability. Published wording is immutable.';
comment on table public.reference_map_item_links is 'Person-reviewed alignment from an existing map item to one published reference capability revision; never inferred from matching names.';

create function atlas.guard_reference_capability_identity()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.reference_capability_revisions r
             where r.capability_id = old.id and r.status = 'published') then
    raise exception 'a published reference capability identity is fixed; create a new identity for a different meaning' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.id <> old.id then
    raise exception 'a reference capability id cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger reference_capability_identity_fixed
  before update or delete on public.reference_capabilities
  for each row execute function atlas.guard_reference_capability_identity();
revoke all on function atlas.guard_reference_capability_identity() from public, anon, authenticated;

create function atlas.guard_reference_capability_revision()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'published' then
    raise exception 'published reference capability revisions are immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.capability_id <> old.capability_id or new.revision <> old.revision then
    raise exception 'reference capability revision identity cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger reference_capability_revision_fixed_after_publish
  before update or delete on public.reference_capability_revisions
  for each row execute function atlas.guard_reference_capability_revision();
revoke all on function atlas.guard_reference_capability_revision() from public, anon, authenticated;

create function atlas.guard_reference_map_item_link()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_map_status map_status;
  v_revision_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select m.status into v_map_status
    from public.capability_map_items i
    join public.capability_maps m on m.id = i.map_id
    where i.id = old.map_item_id;
    if v_map_status is distinct from 'draft' then
      raise exception 'the alignment of a published or deprecated map item is immutable' using errcode = '23514';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if new.map_item_id <> old.map_item_id then
      raise exception 'a map item alignment cannot move to another item' using errcode = '23514';
    end if;
  end if;

  select r.status into v_revision_status
  from public.reference_capability_revisions r
  where r.capability_id = new.capability_id and r.revision = new.capability_revision;
  if v_revision_status is distinct from 'published' then
    raise exception 'map items can only align with published reference capability revisions' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger reference_map_item_link_guard
  before insert or update or delete on public.reference_map_item_links
  for each row execute function atlas.guard_reference_map_item_link();
revoke all on function atlas.guard_reference_map_item_link() from public, anon, authenticated;

-- Only a platform admin may inspect draft identities in this schema slice.
-- There is no authenticated write path yet. The later admin operations must
-- check platform-admin status themselves; the browser never gets service_role.
alter table public.reference_capabilities enable row level security;
alter table public.reference_capabilities force row level security;
alter table public.reference_capability_revisions enable row level security;
alter table public.reference_capability_revisions force row level security;
alter table public.reference_map_item_links enable row level security;
alter table public.reference_map_item_links force row level security;

create policy reference_capabilities_admin_read on public.reference_capabilities
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
  );
create policy reference_capability_revisions_admin_read on public.reference_capability_revisions
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
  );
create policy reference_map_item_links_admin_read on public.reference_map_item_links
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
  );

revoke all on public.reference_capabilities, public.reference_capability_revisions, public.reference_map_item_links from public, anon, authenticated;
grant select on public.reference_capabilities, public.reference_capability_revisions, public.reference_map_item_links to authenticated;
grant select, insert, update, delete on public.reference_capabilities, public.reference_capability_revisions, public.reference_map_item_links to service_role;
