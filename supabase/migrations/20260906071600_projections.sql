-- Sprint F1 step 2: foundations schema, part 7 of 8.
--
-- elements_head and relationships_head (SPEC-data-model.md §3.5): the
-- materialised, per-commit folded state. Composite primary keys, no
-- synthetic id or created_at column — per SPEC §2's clarified convention,
-- org_id still applies (used directly below), but a row here is a
-- disposable projection of `deltas`, not an entity with its own identity or
-- history.
--
-- Both tables are commit-scoped and service-role-write-only (§9.5): nothing
-- here grants authenticated users insert/update/delete, because populating
-- them correctly means running the fold algorithm (SPEC §6), which belongs
-- to src/engine, not to this migration or to a client's own judgement.

create table elements_head (
  commit_id uuid not null references commits (id) on delete cascade,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  element_id uuid not null,
  element_type element_type not null,
  name text not null,
  -- Must reference an element_id present in the same commit_id; enforced by
  -- the engine's validation (V2), not a FK — a self-referencing FK across
  -- the composite key isn't expressible, and the real constraint (correct
  -- type, no cycle) is richer than a FK could say anyway.
  parent_id uuid,
  attributes jsonb not null default '{}'::jsonb,
  exists_delta_id uuid not null references deltas (id),
  primary key (commit_id, element_id)
);

comment on table elements_head is 'The folded element set at a commit (SPEC §3.5, §6).';

create index elements_head_commit_id_element_type_idx on elements_head (commit_id, element_type);
create index elements_head_commit_id_parent_id_idx on elements_head (commit_id, parent_id) where parent_id is not null;
create index elements_head_model_id_element_id_idx on elements_head (model_id, element_id);
create index elements_head_attributes_gin_idx on elements_head using gin (attributes);
create index elements_head_name_trgm_idx on elements_head using gin (lower(name) gin_trgm_ops);

create table relationships_head (
  commit_id uuid not null references commits (id) on delete cascade,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  relationship_id uuid not null,
  relationship_type relationship_type not null,
  from_element_id uuid not null,
  to_element_id uuid not null,
  attributes jsonb not null default '{}'::jsonb,
  exists_delta_id uuid not null references deltas (id),
  primary key (commit_id, relationship_id),
  unique (commit_id, relationship_type, from_element_id, to_element_id)
);

comment on table relationships_head is 'The folded relationship set at a commit (SPEC §3.5, §6, S-6).';

create index relationships_head_commit_id_from_idx on relationships_head (commit_id, from_element_id);
create index relationships_head_commit_id_to_idx on relationships_head (commit_id, to_element_id);

-- ---------------------------------------------------------------------------
-- RLS: commit-scoped (SPEC §9.5) — visible iff the referenced commit is,
-- exactly like deltas. No insert/update/delete policy for authenticated at
-- all: those operations are denied outright under RLS regardless of table
-- grants, which is the point (service role only).
-- ---------------------------------------------------------------------------

alter table elements_head enable row level security;
alter table elements_head force row level security;

create policy elements_head_select on elements_head
  for select to authenticated
  using (exists (select 1 from commits c where c.id = elements_head.commit_id));

grant select on elements_head to authenticated;

alter table relationships_head enable row level security;
alter table relationships_head force row level security;

create policy relationships_head_select on relationships_head
  for select to authenticated
  using (exists (select 1 from commits c where c.id = relationships_head.commit_id));

grant select on relationships_head to authenticated;
