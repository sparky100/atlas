-- Sprint F1 step 2: foundations schema, part 6 of 8.
--
-- sources and aliases (SPEC-data-model.md §3.6, ADR-007, ADR-008), plus the
-- deferred foreign key from deltas.source_id now that sources exists.

create table sources (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  kind source_kind not null,
  name text not null,
  uri text,
  captured_at date,
  -- capture_jobs and capability_maps don't exist yet; the FK is added by
  -- their own migrations (Sprint F1 later steps / capture pipeline work).
  capture_job_id uuid,
  capability_map_id uuid,
  user_id uuid references auth.users (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),

  check ((kind = 'capture_job') = (capture_job_id is not null)),
  check ((kind = 'template') = (capability_map_id is not null)),
  check ((kind = 'manual') = (user_id is not null))
);

comment on table sources is 'Where a fact came from (S-7, ADR-007).';

create unique index sources_model_id_user_id_manual_idx on sources (model_id, user_id) where kind = 'manual';
create index sources_model_id_kind_idx on sources (model_id, kind);
create index sources_org_id_idx on sources (org_id);

alter table deltas add constraint deltas_source_id_fkey foreign key (source_id) references sources (id);

create table aliases (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  element_id uuid not null,
  alias_value text not null,
  alias_type alias_type not null,
  source_id uuid not null references sources (id),
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

comment on table aliases is 'Alternative identifiers for an element (ADR-008, ADR-012).';

-- An alias string resolves to exactly one element within a model (SPEC
-- §3.6). A plain UNIQUE constraint can't express the lower(alias_value)
-- normalisation, so this is a unique index instead.
create unique index aliases_model_id_alias_type_value_idx on aliases (model_id, alias_type, lower(alias_value));
create index aliases_model_id_element_id_idx on aliases (model_id, element_id);
create index aliases_org_id_idx on aliases (org_id);

-- ---------------------------------------------------------------------------
-- RLS: sources. Member-scoped (SPEC §9.5). A person may record any source
-- kind except the two that are exclusively system-produced (capture_job,
-- template) — those arrive with the capture pipeline and capability-map
-- seeding respectively, both service-role paths that bypass RLS. No update
-- or delete: a source is a reference record, not something this sprint has
-- a design for editing.
-- ---------------------------------------------------------------------------

alter table sources enable row level security;
alter table sources force row level security;

create policy sources_select on sources
  for select to authenticated
  using (atlas.is_member(org_id));

create policy sources_insert on sources
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and kind in ('document', 'spreadsheet', 'interview', 'manual')
    and created_by = auth.uid()
    and (kind <> 'manual' or user_id = auth.uid())
  );

grant select, insert on sources to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: aliases. Member-scoped. A person may record the identifying kinds of
-- alias by hand (name/code/external_ref/source_system_key); template_code
-- aliases come from capability-map seeding and merged_id aliases only ever
-- come from the future atlas.merge_elements procedure (ADR-008) — both
-- system paths, not a direct authenticated insert. No update or delete: an
-- alias, once recorded, is not edited — a wrong one is superseded by adding
-- a correct one, not by mutating history.
-- ---------------------------------------------------------------------------

alter table aliases enable row level security;
alter table aliases force row level security;

create policy aliases_select on aliases
  for select to authenticated
  using (atlas.is_member(org_id));

create policy aliases_insert on aliases
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and alias_type in ('name', 'code', 'external_ref', 'source_system_key')
    and created_by = auth.uid()
  );

grant select, insert on aliases to authenticated;
