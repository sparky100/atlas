-- Sample models (docs/ADR-033-sample-models.md): product-owned, versioned
-- starter models that a new organisation can copy into itself.
--
-- `sample_models` holds one row per published version of a sample. No org_id:
-- product content, like `capability_maps` (ADR-012). Row-level security:
--
--   * select: any signed-in user (the content is made-up demo data a platform
--     admin chose to publish);
--   * insert: platform admins only, as themselves — this IS the publish path;
--   * no update and no delete policy, and those privileges are revoked: a
--     published version is never changed or removed (rule 5). A new publish is
--     a new version row.
--
-- Deliberately NO function: copying a sample into an organisation reuses the
-- ordinary, already-checked paths (create a model, add sources, commit the
-- deltas to main, add aliases), each under the caller's own row-level
-- security, so this migration adds no SECURITY DEFINER function and no
-- advisor finding (CLAUDE.md rule 9).

create table sample_models (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  version int not null check (version >= 1),
  name text not null check (btrim(name) <> ''),
  description text,
  -- { elementsHead, relationshipsHead, facts, sources, aliases } — see src/contracts/sampleModel.ts
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and jsonb_typeof(payload -> 'elementsHead') = 'array'
    and jsonb_typeof(payload -> 'relationshipsHead') = 'array'
    and jsonb_typeof(payload -> 'facts') = 'array'
    and jsonb_typeof(payload -> 'sources') = 'array'
    and jsonb_typeof(payload -> 'aliases') = 'array'
    and jsonb_array_length(payload -> 'elementsHead') > 0
  ),
  published_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),

  unique (slug, version)
);

comment on table sample_models is 'A published, versioned sample model a new organisation can copy (ADR-033). Product content: no org_id; written only by a platform admin.';

-- Covers the foreign key (performance advisor: unindexed_foreign_keys).
create index sample_models_published_by_idx on sample_models (published_by);

alter table sample_models enable row level security;

create policy sample_models_select on sample_models
  for select to authenticated
  using (true);

create policy sample_models_insert on sample_models
  for insert to authenticated
  with check (
    published_by = (select auth.uid())
    -- platform_admins' own select policy lets a caller see only their own row, so this is "I am a platform admin".
    and exists (select 1 from platform_admins pa where pa.user_id = (select auth.uid()))
  );

revoke all on table sample_models from public, anon;
revoke update, delete, truncate on table sample_models from authenticated;
grant select, insert on table sample_models to authenticated;
