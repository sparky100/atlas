-- Sprint U1 step 4a: views, view_layouts, view_annotations
-- (SPEC-data-model.md §3.9, ADR-011).
--
-- A view is a saved query, not a saved drawing (ADR-011, CLAUDE.md rule 2).
-- Rendering runs the view's scope+kind query against the chosen branch's
-- materialised state and lays it out; nothing here stores a node/edge list.
--
-- Every table gets the three implicit columns SPEC-data-model.md §3 line 44
-- specifies for every table (`id uuid primary key`, `org_id uuid not null
-- references organisations(id)`, `created_at timestamptz not null default
-- now()`), dropping `id` only where a composite key replaces it (S-20's own
-- carve-out, same as `elements_head`/`relationships_head`/`facts`) — SPEC
-- §3.9's column lists for these three tables show only the columns beyond
-- that implicit set, matching every other table's listing in the file.
--
-- `view_layouts` is the one deliberate deviation: like `branches`
-- (20260906071400_history.sql), its own listed columns already include a
-- mutation-tracking pair (`updated_by`/`updated_at`) — a position is
-- expected to change after creation, repeatedly, as someone drags a node or
-- the auto-layout re-runs, so `updated_at` alone (no separate `created_at`)
-- is the meaningful timestamp, exactly as branches has `updated_at` but no
-- `created_at`.

create type view_kind as enum ('landscape', 'context', 'container', 'component', 'capability_map');
create type annotation_kind as enum ('text', 'highlight', 'arrow');

create table views (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  name text not null,
  kind view_kind not null,
  -- Required for context/container/component (which System/Container this
  -- view is "for"); must be null for landscape/capability_map, which are
  -- whole-model queries with no single scoping element (SPEC §3.9).
  scope_element_id uuid,
  -- Which branch's folded state to render; null means main's head
  -- (ADR-011). Sprint U1's landscape view never sets this to anything but
  -- null — there is no branch UI yet (ADR-015) — but the column is real
  -- schema per SPEC §3.9, not something a later sprint has to migrate in.
  branch_id uuid references branches (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),

  check ((kind in ('context', 'container', 'component')) = (scope_element_id is not null))
);

comment on table views is 'A saved query, not a drawing (ADR-011). capability_map renders the model''s own capability elements — it is not the versioned starter-content maps in capability_maps/capability_map_items (ADR-012, SPEC §3.10).';

create index views_model_id_kind_idx on views (model_id, kind);
create index views_org_id_idx on views (org_id);

create table view_layouts (
  org_id uuid not null references organisations (id),
  view_id uuid not null references views (id) on delete cascade,
  subject_type subject_type not null,
  subject_id uuid not null,
  -- Elements: a point. Relationships: null x/y, routed via bends instead.
  x double precision,
  y double precision,
  -- Relationships only: an ordered array of {x,y} bend points.
  bends jsonb,
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),

  primary key (view_id, subject_id),
  check ((subject_type = 'element') = (x is not null and y is not null)),
  check ((subject_type = 'element') or (x is null and y is null))
);

comment on table view_layouts is 'Per-view position hints (ADR-011). Deleting every row for a view and re-running auto-layout must be lossless — the litmus test for whether something belongs here at all.';

create index view_layouts_org_id_idx on view_layouts (org_id);

create table view_annotations (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  view_id uuid not null references views (id) on delete cascade,
  kind annotation_kind not null,
  geometry jsonb not null,
  text text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),

  check ((kind = 'text') = (text is not null))
);

comment on table view_annotations is 'Free-form presentational markup (ADR-011) — never a fact, never contributes to a model export, always rendered in a visually distinct style.';

create index view_annotations_view_id_idx on view_annotations (view_id);
create index view_annotations_org_id_idx on view_annotations (org_id);

-- ---------------------------------------------------------------------------
-- RLS: views. Member-scoped (SPEC §9.5), branch-visibility-aware like
-- branches itself (a view pointed at a non-shared change branch is exactly
-- as invisible to a viewer-role member as that branch already is).
--
-- Unlike atlas.commit_deltas (ADR-015), creating or reading a *view* is not
-- writing a fact to main — it's a saved-query/rendering-hint convenience
-- available to anyone who can edit the model at all, so the owner/architect
-- vs. contributor split that governs main commits does not apply here.
--
-- No update/delete policy yet: Sprint U1 auto-creates exactly one landscape
-- view per model and never renames or removes it — same "not this sprint's
-- design" stance sources/aliases already take on their own missing verbs.
-- ---------------------------------------------------------------------------

alter table views enable row level security;
alter table views force row level security;

create policy views_select on views
  for select to authenticated
  using (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    or (atlas.has_role(org_id, 'viewer') and (branch_id is null or atlas.branch_visible_to_viewer(branch_id)))
  );

create policy views_insert on views
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
  );

grant select, insert on views to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: view_layouts. Visibility delegates to the owning view's own RLS
-- (same pattern as elements_head/relationships_head/facts delegating to
-- commits) — the `exists` subquery below only succeeds if the current role
-- could already see that `views` row under views_select.
-- ---------------------------------------------------------------------------

alter table view_layouts enable row level security;
alter table view_layouts force row level security;

create policy view_layouts_select on view_layouts
  for select to authenticated
  using (exists (select 1 from views v where v.id = view_layouts.view_id));

create policy view_layouts_insert on view_layouts
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and updated_by = auth.uid()
    and exists (select 1 from views v where v.id = view_layouts.view_id and v.org_id = view_layouts.org_id)
  );

-- A drag, or a "Reset layout" re-run, is an update to an existing row, not
-- always a fresh insert — upsert needs both policies to pass ON CONFLICT.
create policy view_layouts_update on view_layouts
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'))
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and updated_by = auth.uid()
    and exists (select 1 from views v where v.id = view_layouts.view_id and v.org_id = view_layouts.org_id)
  );

-- "Reset layout" (UI-principles §6.4) deletes every row for a view outright.
create policy view_layouts_delete on view_layouts
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

grant select, insert, update, delete on view_layouts to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: view_annotations. Select only for now — no UI writes an annotation
-- yet (deferred past step 4a, same "schema now, writer later" stance as
-- sources' capture_job/template kinds), so there is nothing to grant insert
-- on until that UI exists.
-- ---------------------------------------------------------------------------

alter table view_annotations enable row level security;
alter table view_annotations force row level security;

create policy view_annotations_select on view_annotations
  for select to authenticated
  using (exists (select 1 from views v where v.id = view_annotations.view_id));

grant select on view_annotations to authenticated;
