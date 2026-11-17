-- ADR-034 PR 2 (docs/ADR-034-principles.md, "Starter sets"): published,
-- versioned sets of principles an organisation can choose from. Product
-- content like `sample_models` (ADR-033) and `capability_maps` (ADR-012): no
-- org_id, written only by a platform admin, a published version is never
-- changed or removed (rule 5). A set is never added to a model automatically;
-- "Start from a set" copies the principles a person ticks into their own
-- model as ordinary principles of their own, with where they came from.
--
-- Advisor discipline (CLAUDE.md rule 9): RLS enabled with policies in this
-- migration; `auth.uid()` wrapped in a select; no function at all (so no
-- SECURITY DEFINER finding); no foreign key and no extra index (published_by
-- carries no foreign key, like principles.created_by, so there is no
-- unindexed-foreign-key or unused-index finding; the unique constraint's index
-- is the only one and is not reported as unused).

create table principle_sets (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  version int not null check (version >= 1),
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  description text check (description is null or length(description) <= 500),
  -- { principles: [{ title, statement, why }] } — see src/contracts/principleSet.ts
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload -> 'principles') = 'array'
    and jsonb_array_length(payload -> 'principles') between 1 and 50
  ),
  published_by uuid not null,
  created_at timestamptz not null default now(),

  unique (slug, version)
);

comment on table principle_sets is 'ADR-034: a published, versioned set of principles an organisation can copy from. Product content: no org_id; written only by a platform admin; never updated or deleted.';

alter table principle_sets enable row level security;
alter table principle_sets force row level security;

create policy principle_sets_select on principle_sets
  for select to authenticated
  using (true);

create policy principle_sets_insert on principle_sets
  for insert to authenticated
  with check (
    published_by = (select auth.uid())
    -- platform_admins' own select policy lets a caller see only their own row, so this is "I am a platform admin".
    and exists (select 1 from platform_admins pa where pa.user_id = (select auth.uid()))
  );

revoke all on table principle_sets from public, anon;
revoke update, delete, truncate on table principle_sets from authenticated;
grant select, insert on table principle_sets to authenticated;

-- Where a copied principle came from. Set only when it was added from a set;
-- fixed once written (the update grant on principles names its columns, and
-- these are not among them).
alter table principles
  add column from_set_slug text,
  add column from_set_name text,
  add column from_set_version int,
  add constraint principles_from_set_consistent check (
    (from_set_slug is null and from_set_name is null and from_set_version is null)
    or (from_set_slug is not null and from_set_name is not null and from_set_version is not null and from_set_version >= 1)
  );

comment on column principles.from_set_slug is 'ADR-034: the published set this principle was copied from, if any. The copy is the organisation''s own; this only records where it began.';
