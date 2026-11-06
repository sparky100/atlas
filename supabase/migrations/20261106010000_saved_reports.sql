-- ADR-027 (docs/ADR-027-saved-reports.md), F14 step 3: saved reports, saved
-- copies and dashboards. Workflow records on the same tier as `projects` and
-- `decisions` (never a delta, never folded into a head, never in a version):
--
--   * saved_reports    — a named, stored *question* (a `ReportSpec`). Mutable.
--   * report_snapshots — a frozen *result* of one, kept as a record. Insert-
--                        only: no update grant, and a trigger refuses any
--                        update except the FK action that nulls report_id
--                        when its report is deleted.
--   * dashboards / dashboard_tiles — an ordered list of references to reports.
--
-- Two visibility levels (ADR-027 §5): 'private' (the creator) and
-- 'organisation' (every member). Only an org owner/architect may make
-- something organisation-visible.
--
-- Also rewrites `atlas.delete_model` (same body as
-- 20261002020000_projects.sql) to clear the four new tables first.

-- ---------------------------------------------------------------------------
-- saved_reports
-- ---------------------------------------------------------------------------

create table saved_reports (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  -- A ReportSpec (src/contracts/reportSpec.ts). Validated by the client's
  -- parseReportSpec; the database only guarantees it is an object whose
  -- specVersion matches spec_version.
  spec jsonb not null,
  spec_version int not null check (spec_version >= 1),
  visibility text not null default 'private' check (visibility in ('private', 'organisation')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_reports_spec_is_object check (jsonb_typeof(spec) = 'object' and spec ? 'specVersion' and spec -> 'specVersion' = to_jsonb(spec_version))
);

comment on table saved_reports is 'ADR-027: a saved report — a stored question (ReportSpec), never data about the architecture. A workflow record on the same tier as projects/decisions: not in deltas, heads or versions. Deleting every saved report loses no model information.';

create index saved_reports_model_visibility_idx on saved_reports (model_id, visibility);

-- ---------------------------------------------------------------------------
-- report_snapshots
-- ---------------------------------------------------------------------------

create table report_snapshots (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  -- Set null when the report is deleted: the copy carries its own name and
  -- definition, so it still makes sense without it.
  report_id uuid references saved_reports (id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  -- Copy of the definition as it was when the copy was taken.
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  spec_version int not null check (spec_version >= 1),
  -- ADR-027 §3: main only in this version, so a copy never writes draft
  -- content into a permanent record.
  branch_id uuid not null references branches (id),
  commit_id uuid not null references commits (id),
  -- The frozen ReportResult.
  columns jsonb not null check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) > 0),
  rows jsonb not null check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 5000),
  groups jsonb not null default '[]'::jsonb check (jsonb_typeof(groups) = 'array'),
  unknown_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(unknown_fields) = 'array'),
  row_count int not null check (row_count >= 0),
  truncated boolean not null default false,
  visibility text not null default 'private' check (visibility in ('private', 'organisation')),
  generated_by uuid not null references auth.users (id),
  generated_at timestamptz not null default now(),
  constraint report_snapshots_count_covers_rows check (row_count >= jsonb_array_length(rows))
);

comment on table report_snapshots is 'ADR-027 §3: a frozen result of a saved report, kept as a record. Insert-only — no update grant; a trigger refuses any update except report_id being nulled by the FK when its report is deleted. Reads only stored data, never the live model.';

create index report_snapshots_report_idx on report_snapshots (report_id, generated_at desc) where report_id is not null;
create index report_snapshots_model_idx on report_snapshots (model_id, generated_at desc);

-- ---------------------------------------------------------------------------
-- dashboards, dashboard_tiles
-- ---------------------------------------------------------------------------

create table dashboards (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  name text not null check (length(btrim(name)) > 0),
  visibility text not null default 'private' check (visibility in ('private', 'organisation')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dashboards is 'ADR-027 §4: an ordered list of tiles, each pointing at a saved report. Live: tiles re-run their report when opened. Tile order is a display hint (rule 3).';

create index dashboards_model_idx on dashboards (model_id);

create table dashboard_tiles (
  id uuid primary key,
  dashboard_id uuid not null references dashboards (id) on delete cascade,
  report_id uuid not null references saved_reports (id) on delete cascade,
  position int not null check (position >= 0),
  kind text not null check (kind in ('count', 'barByField', 'table', 'findingCount')),
  -- Columns wide: a small fixed set, never a coordinate.
  size text not null default 'one' check (size in ('one', 'two')),
  -- Top N rows for a table tile.
  row_limit int check (row_limit is null or row_limit between 1 and 50),
  constraint dashboard_tiles_position_unique unique (dashboard_id, position) deferrable initially deferred
);

comment on table dashboard_tiles is 'ADR-027 §4: one tile of a dashboard. position/size are display hints, not data (rule 3). Deleting a report removes its tiles.';

create index dashboard_tiles_report_idx on dashboard_tiles (report_id);

-- ---------------------------------------------------------------------------
-- Guards (triggers)
-- ---------------------------------------------------------------------------

create or replace function atlas.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Saved reports: only an org owner/architect may publish (make a report
-- organisation-visible); a report cannot go back to private while a tile
-- of an organisation-visible dashboard still shows it; model/org are
-- fixed at creation.
create or replace function atlas.guard_saved_report()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.model_id <> old.model_id or new.created_by <> old.created_by) then
    raise exception 'saved_reports: org, model and creator cannot change' using errcode = '42501';
  end if;
  if new.visibility = 'organisation' and (tg_op = 'INSERT' or old.visibility <> 'organisation')
     and atlas.has_role(new.org_id, 'owner', 'architect') is not true then
    raise exception 'saved_reports: only an organisation owner or architect can share a report with the organisation' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.visibility = 'organisation' and new.visibility = 'private' and exists (
    select 1 from dashboard_tiles t join dashboards d on d.id = t.dashboard_id
    where t.report_id = new.id and d.visibility = 'organisation'
  ) then
    raise exception 'saved_reports: this report is on a dashboard shared with the organisation; remove it from there first' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger saved_reports_guard
  before insert or update on saved_reports
  for each row execute function atlas.guard_saved_report();
create trigger saved_reports_touch
  before update on saved_reports
  for each row execute function atlas.touch_updated_at();

create or replace function atlas.guard_dashboard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.model_id <> old.model_id or new.created_by <> old.created_by) then
    raise exception 'dashboards: org, model and creator cannot change' using errcode = '42501';
  end if;
  if new.visibility = 'organisation' and (tg_op = 'INSERT' or old.visibility <> 'organisation') then
    if atlas.has_role(new.org_id, 'owner', 'architect') is not true then
      raise exception 'dashboards: only an organisation owner or architect can share a dashboard with the organisation' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and exists (
      select 1 from dashboard_tiles t join saved_reports r on r.id = t.report_id
      where t.dashboard_id = new.id and r.visibility <> 'organisation'
    ) then
      raise exception 'dashboards: a tile shows a private report; share that report first' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger dashboards_guard
  before insert or update on dashboards
  for each row execute function atlas.guard_dashboard();
create trigger dashboards_touch
  before update on dashboards
  for each row execute function atlas.touch_updated_at();

-- A tile's report must be in the dashboard's model, and visible to
-- everyone who can see the dashboard.
create or replace function atlas.guard_dashboard_tile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dashboard dashboards;
  v_report saved_reports;
begin
  select * into v_dashboard from dashboards where id = new.dashboard_id;
  select * into v_report from saved_reports where id = new.report_id;
  if v_report.id is null or v_dashboard.id is null or v_report.model_id <> v_dashboard.model_id then
    raise exception 'dashboard_tiles: the report must be in the same model as the dashboard' using errcode = '23503';
  end if;
  -- Whoever adds a tile must be able to see the report themselves.
  if v_report.visibility = 'private' and v_report.created_by <> auth.uid() then
    raise exception 'dashboard_tiles: no such report' using errcode = '23503';
  end if;
  if v_dashboard.visibility = 'organisation' and v_report.visibility <> 'organisation' then
    raise exception 'dashboard_tiles: a dashboard shared with the organisation can only show reports shared with the organisation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger dashboard_tiles_guard
  before insert or update on dashboard_tiles
  for each row execute function atlas.guard_dashboard_tile();

-- Saved copies: main only (ADR-027 §3), the commit must be on that branch
-- and in this model, and a copy is never more widely visible than the
-- report it came from unless a owner/architect takes it.
create or replace function atlas.guard_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_report saved_reports;
begin
  select * into v_branch from branches where id = new.branch_id;
  if v_branch.id is null or v_branch.model_id <> new.model_id or v_branch.org_id <> new.org_id or v_branch.kind <> 'main' then
    raise exception 'report_snapshots: a saved copy can only be taken from the main model' using errcode = '23514';
  end if;
  if not exists (select 1 from commits c where c.id = new.commit_id and c.branch_id = new.branch_id and c.model_id = new.model_id) then
    raise exception 'report_snapshots: commit % is not on this branch of this model', new.commit_id using errcode = '23503';
  end if;
  if new.report_id is not null then
    select * into v_report from saved_reports where id = new.report_id;
    if v_report.id is null or v_report.model_id <> new.model_id then
      raise exception 'report_snapshots: no such report in this model' using errcode = '23503';
    end if;
    if v_report.visibility = 'private' and v_report.created_by <> auth.uid() then
      raise exception 'report_snapshots: no such report' using errcode = '23503';
    end if;
  end if;
  if new.visibility = 'organisation'
     and atlas.has_role(new.org_id, 'owner', 'architect') is not true
     and not (v_report.id is not null and v_report.visibility = 'organisation') then
    raise exception 'report_snapshots: a copy can be shared with the organisation only if its report is, or by an owner or architect' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger report_snapshots_guard
  before insert on report_snapshots
  for each row execute function atlas.guard_report_snapshot();

-- Insert-only, belt and braces over the missing update grant (a service-role
-- client skips RLS and grants, never triggers). The one permitted change is
-- the FK's own `on delete set null` clearing report_id.
create or replace function atlas.report_snapshot_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - 'report_id') is distinct from (to_jsonb(old) - 'report_id')
     or (new.report_id is not null and new.report_id is distinct from old.report_id) then
    raise exception 'report_snapshots: a saved copy cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger report_snapshots_immutable
  before update on report_snapshots
  for each row execute function atlas.report_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table saved_reports enable row level security;
alter table saved_reports force row level security;

create policy saved_reports_select on saved_reports
  for select to authenticated
  using (atlas.is_member(org_id) and (visibility = 'organisation' or created_by = auth.uid()));

create policy saved_reports_insert on saved_reports
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
    and exists (select 1 from models m where m.id = saved_reports.model_id and m.org_id = saved_reports.org_id)
  );

-- A private report is its creator's alone. An organisation report is
-- editable by its creator or an org owner/architect. (Publishing is
-- guarded by atlas.guard_saved_report.)
create policy saved_reports_update on saved_reports
  for update to authenticated
  using (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))))
  with check (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))));

create policy saved_reports_delete on saved_reports
  for delete to authenticated
  using (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))));

revoke update on saved_reports from authenticated;
grant select, insert, delete on saved_reports to authenticated;
grant update (name, description, spec, spec_version, visibility) on saved_reports to authenticated;

alter table report_snapshots enable row level security;
alter table report_snapshots force row level security;

create policy report_snapshots_select on report_snapshots
  for select to authenticated
  using (atlas.is_member(org_id) and (visibility = 'organisation' or generated_by = auth.uid()));

create policy report_snapshots_insert on report_snapshots
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and generated_by = auth.uid()
    and exists (select 1 from models m where m.id = report_snapshots.model_id and m.org_id = report_snapshots.org_id)
  );

-- ADR-027 §3 (the open point, built as proposed): the creator, or an org
-- owner/architect for an organisation-visible copy. The UI confirms first.
create policy report_snapshots_delete on report_snapshots
  for delete to authenticated
  using (atlas.is_member(org_id) and (generated_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))));

-- No update grant at all.
revoke update on report_snapshots from authenticated;
grant select, insert, delete on report_snapshots to authenticated;

alter table dashboards enable row level security;
alter table dashboards force row level security;

create policy dashboards_select on dashboards
  for select to authenticated
  using (atlas.is_member(org_id) and (visibility = 'organisation' or created_by = auth.uid()));

create policy dashboards_insert on dashboards
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
    and exists (select 1 from models m where m.id = dashboards.model_id and m.org_id = dashboards.org_id)
  );

create policy dashboards_update on dashboards
  for update to authenticated
  using (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))))
  with check (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))));

create policy dashboards_delete on dashboards
  for delete to authenticated
  using (atlas.is_member(org_id) and (created_by = auth.uid() or (visibility = 'organisation' and atlas.has_role(org_id, 'owner', 'architect'))));

revoke update on dashboards from authenticated;
grant select, insert, delete on dashboards to authenticated;
grant update (name, visibility) on dashboards to authenticated;

alter table dashboard_tiles enable row level security;
alter table dashboard_tiles force row level security;

-- A tile is visible exactly when its dashboard is (the subquery runs under
-- dashboards' own select policy) and editable by whoever may edit that
-- dashboard.
create policy dashboard_tiles_select on dashboard_tiles
  for select to authenticated
  using (exists (select 1 from dashboards d where d.id = dashboard_tiles.dashboard_id));

create policy dashboard_tiles_insert on dashboard_tiles
  for insert to authenticated
  with check (exists (
    select 1 from dashboards d
    where d.id = dashboard_tiles.dashboard_id
      and atlas.is_member(d.org_id)
      and (d.created_by = auth.uid() or (d.visibility = 'organisation' and atlas.has_role(d.org_id, 'owner', 'architect')))
  ));

create policy dashboard_tiles_update on dashboard_tiles
  for update to authenticated
  using (exists (
    select 1 from dashboards d
    where d.id = dashboard_tiles.dashboard_id
      and atlas.is_member(d.org_id)
      and (d.created_by = auth.uid() or (d.visibility = 'organisation' and atlas.has_role(d.org_id, 'owner', 'architect')))
  ))
  with check (exists (
    select 1 from dashboards d
    where d.id = dashboard_tiles.dashboard_id
      and atlas.is_member(d.org_id)
      and (d.created_by = auth.uid() or (d.visibility = 'organisation' and atlas.has_role(d.org_id, 'owner', 'architect')))
  ));

create policy dashboard_tiles_delete on dashboard_tiles
  for delete to authenticated
  using (exists (
    select 1 from dashboards d
    where d.id = dashboard_tiles.dashboard_id
      and atlas.is_member(d.org_id)
      and (d.created_by = auth.uid() or (d.visibility = 'organisation' and atlas.has_role(d.org_id, 'owner', 'architect')))
  ));

revoke update on dashboard_tiles from authenticated;
grant select, insert, delete on dashboard_tiles to authenticated;
-- The dashboard and report a tile points at never change after insert.
grant update (position, kind, size, row_limit) on dashboard_tiles to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.delete_model: same body as 20261002020000_projects.sql, with the four
-- new tables cleared first (copies, tiles, dashboards, reports — in that
-- order, since each references the next).
-- ---------------------------------------------------------------------------

create or replace function atlas.delete_model(p_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_archived_at timestamptz;
begin
  select org_id, archived_at into v_org_id, v_archived_at from models where id = p_model_id for update;
  if v_org_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;
  if atlas.has_role(v_org_id, 'owner') is not true then
    raise exception 'delete_model: only an owner may delete a model' using errcode = '42501';
  end if;
  if v_archived_at is null then
    return jsonb_build_object('status', 'not_archived');
  end if;

  set constraints
    deltas_previous_delta_id_fkey,
    commits_parent_commit_id_fkey,
    commits_merged_branch_head_commit_id_fkey,
    branches_base_commit_id_fkey,
    branches_head_commit_id_fkey,
    commits_branch_id_fkey
    deferred;

  update comments set parent_comment_id = null where model_id = p_model_id;
  update decisions set superseded_decision_id = null where model_id = p_model_id;
  update capture_jobs set reimport_of_job_id = null where model_id = p_model_id;

  delete from report_snapshots where model_id = p_model_id; -- references saved_reports, branches, commits
  delete from dashboard_tiles where dashboard_id in (select id from dashboards where model_id = p_model_id); -- references dashboards, saved_reports
  delete from dashboards where model_id = p_model_id;
  delete from saved_reports where model_id = p_model_id;
  delete from notifications where merge_request_id in (select id from merge_requests where model_id = p_model_id);
  delete from comments where model_id = p_model_id; -- cascades comment_mentions, and any notifications by comment_id
  delete from review_verdicts where model_id = p_model_id; -- references merge_requests
  delete from decision_arguments where decision_id in (select id from decisions where model_id = p_model_id);
  delete from decision_links where decision_id in (select id from decisions where model_id = p_model_id);
  delete from decision_option_ratings where decision_id in (select id from decisions where model_id = p_model_id); -- references decisions, branches
  delete from project_links where project_id in (select id from projects where model_id = p_model_id); -- references projects
  delete from duplicate_candidates where model_id = p_model_id; -- references duplicate_check_runs
  delete from duplicate_check_runs where model_id = p_model_id;
  delete from duplicate_dismissals where model_id = p_model_id;
  delete from assumptions where model_id = p_model_id;
  delete from decisions where model_id = p_model_id; -- references branches, projects; self-ref already nulled
  delete from element_merges where model_id = p_model_id; -- references evidence, commits
  delete from evidence where model_id = p_model_id; -- references sources
  delete from resolved_conflicts where model_id = p_model_id; -- references deltas
  delete from merge_requests where model_id = p_model_id; -- references commits, branches
  delete from views where model_id = p_model_id; -- cascades view_layouts, view_annotations
  delete from facts where model_id = p_model_id; -- references deltas, sources
  delete from tags where model_id = p_model_id; -- references commits
  delete from elements_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from relationships_head where model_id = p_model_id; -- references deltas via exists_delta_id
  delete from aliases where model_id = p_model_id; -- references sources
  delete from deltas where model_id = p_model_id; -- self-ref deferred; commit_id/source_id -> commits/sources still required below
  delete from sources where model_id = p_model_id; -- deltas/aliases/evidence/facts referencing it already gone; still referenced by capture_jobs below
  delete from capture_jobs where model_id = p_model_id; -- cascades capture_candidates; self-ref already nulled; references branches
  delete from commits where model_id = p_model_id; -- self-ref and branches' ref both deferred
  delete from branches where model_id = p_model_id; -- references projects; ref to commits deferred
  delete from projects where model_id = p_model_id; -- decisions/branches/project_links referencing it already gone
  delete from models where id = p_model_id;

  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function atlas.delete_model from public;
grant execute on function atlas.delete_model to authenticated;
