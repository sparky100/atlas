-- ADR-034 (docs/ADR-034-principles.md): architecture principles linked to
-- decisions. A principle is a short rule a team agrees to follow; a decision
-- can say which principles it follows and which it departs from, and a
-- departure carries a one-line reason. Workflow records on the same tier as
-- `decisions` and `projects`: never a delta, never folded into a head, never
-- in a version. Principles are retired, never deleted.
--
-- Advisor discipline (CLAUDE.md rule 9): both tables enable RLS with policies
-- in this migration; `auth.uid()` is wrapped in a select; no SECURITY DEFINER
-- function is added; the two trigger functions are not callable through the
-- API; and no foreign key is added without a covering index (the audit
-- columns and `org_id` carry no foreign key, like `projects.project_manager_id`,
-- and `decision_principles.principle_id` is checked by trigger rather than
-- by a foreign key, so no unindexed-foreign-key or unused-index finding is
-- introduced).

create table principles (
  id uuid primary key,
  org_id uuid not null,
  model_id uuid not null references models (id),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 120),
  -- The rule, in one or two plain sentences.
  statement text not null check (length(btrim(statement)) > 0 and length(statement) <= 500),
  -- Why a team would accept it.
  why text not null default '' check (length(why) <= 1000),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  retired_by uuid,
  retired_at timestamptz,
  constraint principles_retired_consistent check ((status = 'retired') = (retired_at is not null and retired_by is not null))
);

comment on table principles is 'ADR-034: an architecture principle — a short rule decisions are checked against. A workflow record, never a landscape fact: not in deltas, heads or versions. Retired, never deleted. Edits stop while retired.';

-- Covers the model_id foreign key and the list query.
create index principles_model_status_idx on principles (model_id, status);

create table decision_principles (
  decision_id uuid not null references decisions (id),
  -- No foreign key on purpose (it would need its own index): a principle is
  -- never deleted, atlas.check_decision_principle proves it exists in the
  -- decision's model at insert, and atlas.delete_model clears this table first.
  principle_id uuid not null,
  stance text not null check (stance in ('follows', 'departs')),
  -- A departure always says why; for "follows" it is optional.
  reason text not null default '' check (length(reason) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (decision_id, principle_id),
  constraint decision_principles_departure_has_reason check (stance = 'follows' or length(btrim(reason)) > 0)
);

comment on table decision_principles is 'ADR-034: which principles a decision follows or departs from. A departure carries a reason. Read-only once the decision is no longer proposed (same mechanism as decision_links).';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Stamps who retired a principle and when, clears that when it is made active
-- again, and keeps the wording of a retired principle fixed (decisions cite it).
create or replace function atlas.guard_principle_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'retired' and new.status = 'retired'
     and (new.title is distinct from old.title or new.statement is distinct from old.statement or new.why is distinct from old.why) then
    raise exception 'guard_principle_update: a retired principle cannot be edited; make it active again first' using errcode = '42501';
  end if;
  if new.status = 'retired' and old.status = 'active' then
    new.retired_by := auth.uid();
    new.retired_at := now();
  elsif new.status = 'active' then
    new.retired_by := null;
    new.retired_at := null;
  end if;
  return new;
end;
$$;

create trigger principles_guard_update
  before update on principles
  for each row execute function atlas.guard_principle_update();

revoke all on function atlas.guard_principle_update() from public, anon, authenticated;

-- A decision can only cite an active principle from its own model.
create or replace function atlas.check_decision_principle()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_decision_model uuid;
  v_principle_model uuid;
  v_status text;
begin
  select model_id into v_decision_model from decisions where id = new.decision_id;
  select model_id, status into v_principle_model, v_status from principles where id = new.principle_id;
  if v_principle_model is null or v_principle_model is distinct from v_decision_model then
    raise exception 'check_decision_principle: no principle % in this decision''s model', new.principle_id using errcode = '23503';
  end if;
  if v_status <> 'active' then
    raise exception 'check_decision_principle: a retired principle cannot be linked to a decision' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger decision_principles_check
  before insert on decision_principles
  for each row execute function atlas.check_decision_principle();

revoke all on function atlas.check_decision_principle() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: principles
-- ---------------------------------------------------------------------------

alter table principles enable row level security;
alter table principles force row level security;

create policy principles_select on principles
  for select to authenticated
  using (atlas.is_member(org_id));

-- Owners and architects write the rules; everyone in the organisation reads them.
create policy principles_insert on principles
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect')
    and created_by = (select auth.uid())
    and status = 'active'
    and retired_by is null
    and retired_at is null
    and exists (select 1 from models m where m.id = principles.model_id and m.org_id = principles.org_id)
  );

create policy principles_update on principles
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'))
  with check (atlas.has_role(org_id, 'owner', 'architect'));

revoke update on principles from authenticated;
grant select, insert on principles to authenticated;
-- Only the wording and the status are client-writable; retired_by/at are
-- stamped by the trigger above. No delete policy: retire, never delete.
grant update (title, statement, why, status) on principles to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: decision_principles
-- ---------------------------------------------------------------------------

alter table decision_principles enable row level security;
alter table decision_principles force row level security;

create policy decision_principles_select on decision_principles
  for select to authenticated
  using (exists (select 1 from decisions d where d.id = decision_principles.decision_id and atlas.is_member(d.org_id)));

-- Same tier as decision_links: whoever may contribute to an open decision.
create policy decision_principles_insert on decision_principles
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from decisions d
      where d.id = decision_principles.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  );

-- A mistaken link can be taken back while the decision is still open.
create policy decision_principles_delete on decision_principles
  for delete to authenticated
  using (
    exists (
      select 1 from decisions d
      where d.id = decision_principles.decision_id
        and d.status = 'proposed'
        and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor')
    )
  );

grant select, insert, delete on decision_principles to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.delete_model: same body as 20261106010000_saved_reports.sql, with
-- decision_principles and principles cleared too.
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
  delete from decision_principles where decision_id in (select id from decisions where model_id = p_model_id); -- references decisions
  delete from principles where model_id = p_model_id; -- nothing references it once decision_principles is gone
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
