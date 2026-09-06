-- Sprint U2 step 2: capability_maps / capability_map_items /
-- capability_map_sources (SPEC-data-model.md §3.10, ADR-012).
--
-- Naming note: ADR-012's own prose (written before SPEC-data-model.md was
-- finalised) calls these `capability_map_templates`/
-- `capability_map_template_items`/`capability_map_template_sources` and
-- `element_aliases`. SPEC §3.10 — the authoritative table-shape document —
-- settled on `capability_maps`/`capability_map_items`/
-- `capability_map_sources` and the existing `aliases` table instead; this
-- migration follows SPEC, matching `sources.capability_map_id` (already
-- migrated in Sprint F1's 20260906071500_sources_and_aliases.sql, with its
-- FK deliberately deferred to "their own migration" — this one).
--
-- Versioned, product-owned starter content (ADR-012): no org_id, readable
-- by every authenticated user, writable only by the service role — the
-- loader (scripts/loadCapabilityMaps.ts) reads content/capability-maps/
-- and upserts here as service_role, never as an authenticated session.

create type map_status as enum ('draft', 'published', 'deprecated');

create table capability_maps (
  id uuid primary key,
  sector text not null check (sector in ('local_government', 'nhs', 'housing', 'hei', 'generic')),
  version int not null,
  status map_status not null default 'draft',
  source_description text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),

  unique (sector, version),
  check ((status = 'published') = (published_at is not null))
);

comment on table capability_maps is 'A versioned sector starter map (ADR-012). Product content: no org_id.';

create table capability_map_items (
  id uuid primary key,
  map_id uuid not null references capability_maps (id) on delete cascade,
  code text not null,
  parent_code text,
  name text not null,
  description text,
  level int not null check (level between 1 and 3),
  created_at timestamptz not null default now(),

  unique (map_id, code),
  foreign key (map_id, parent_code) references capability_map_items (map_id, code)
);

comment on table capability_map_items is 'One capability in a starter map (SPEC §3.10, ADR-012).';

create index capability_map_items_map_id_idx on capability_map_items (map_id);

-- level = 1 iff parent_code is null; a non-root item's level is always its
-- parent's level + 1 (SPEC §3.10's own trigger note) — enforced here so it
-- holds regardless of which future tool writes these rows, the same
-- reasoning atlas.guard_tag_on_main uses for tags.
create or replace function atlas.guard_capability_map_item_level()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_level int;
begin
  if new.parent_code is null then
    if new.level <> 1 then
      raise exception 'capability_map_items: a root item (parent_code is null) must have level 1' using errcode = '23514';
    end if;
    return new;
  end if;

  select level into v_parent_level from capability_map_items where map_id = new.map_id and code = new.parent_code;
  if v_parent_level is null then
    raise exception 'capability_map_items: parent_code % not found in this map', new.parent_code using errcode = '23514';
  end if;
  if new.level <> v_parent_level + 1 then
    raise exception 'capability_map_items: level must be exactly one more than the parent''s level' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger capability_map_items_guard_level
  before insert or update on capability_map_items
  for each row execute function atlas.guard_capability_map_item_level();

create table capability_map_sources (
  id uuid primary key,
  map_id uuid not null references capability_maps (id) on delete cascade,
  citation text not null,
  url text,
  -- A name, not a user id (SPEC §3.10) — reviewers are often external to
  -- the organisations using this product at all.
  reviewed_by text not null,
  reviewed_at date not null,
  created_at timestamptz not null default now()
);

comment on table capability_map_sources is 'Citation for a starter map (SPEC §3.10, ADR-012): "where did this taxonomy come from" needs a citation, not "the AI produced it."';

create index capability_map_sources_map_id_idx on capability_map_sources (map_id);

-- The FK sources.capability_map_id has been waiting for this table since
-- Sprint F1 (20260906071500_sources_and_aliases.sql's own comment: "the FK
-- is added by their own migrations").
alter table sources add constraint sources_capability_map_id_fkey foreign key (capability_map_id) references capability_maps (id);

-- ---------------------------------------------------------------------------
-- RLS: product content, not tenant content. Readable by every authenticated
-- user (SPEC §3.10: "Readable by all authenticated users; writable by
-- service role"); no insert/update/delete grant to authenticated at all —
-- the loader runs as service_role, which bypasses RLS entirely.
-- ---------------------------------------------------------------------------

alter table capability_maps enable row level security;
alter table capability_maps force row level security;

create policy capability_maps_select on capability_maps
  for select to authenticated
  using (true);

grant select on capability_maps to authenticated;

alter table capability_map_items enable row level security;
alter table capability_map_items force row level security;

create policy capability_map_items_select on capability_map_items
  for select to authenticated
  using (true);

grant select on capability_map_items to authenticated;

alter table capability_map_sources enable row level security;
alter table capability_map_sources force row level security;

create policy capability_map_sources_select on capability_map_sources
  for select to authenticated
  using (true);

grant select on capability_map_sources to authenticated;
