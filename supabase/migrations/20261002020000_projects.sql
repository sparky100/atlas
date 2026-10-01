-- ADR-024 (docs/ADR-024-projects.md), F10 step 1: projects — the container
-- for a piece of architecture work. A workflow record on the same tier as
-- `decisions` (never a delta, never folded into a head, never in a
-- version): `projects`, `project_links`, `decisions.project_id`,
-- `branches.project_id`, `decision_links.linked_type = 'project'`, the
-- P1–P4 consistency rules, and two RPCs (`atlas.set_decision_project`,
-- `atlas.set_project_status`).
--
-- Also fixes `atlas.delete_model`, which never deleted
-- `decision_option_ratings` (20260929010000 added that table after
-- 20260927010000 last rewrote the function), so deleting any archived
-- model with a rated option failed on a foreign key.

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------

create table projects (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  title text not null check (length(btrim(title)) > 0),
  -- The problem or opportunity, in plain words — the role
  -- `decisions.statement` plays for a decision.
  purpose text not null default '',
  -- Accountable for delivering it; distinct from any decision's own owner.
  owner_id uuid not null references auth.users (id),
  status text not null default 'active' check (status in ('active', 'on_hold', 'closed', 'cancelled')),
  start_date date,
  -- When the project as a whole is meant to be done — distinct from each
  -- change's own branches.target_date.
  target_date date,
  -- Which health-finding check "Start a project" traced back to — a stable
  -- string key, same stance as decisions.source_finding_key (ADR-022).
  source_finding_key text,
  closed_by uuid references auth.users (id),
  closed_at timestamptz,
  close_reason text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- Set together by atlas.set_project_status only (§4), and only on the
  -- way to a terminal status; a cancelled project always says why.
  constraint projects_closed_consistent check ((status in ('closed', 'cancelled')) = (closed_by is not null and closed_at is not null)),
  constraint projects_cancel_has_reason check (status <> 'cancelled' or length(btrim(coalesce(close_reason, ''))) > 0)
);

comment on table projects is 'ADR-024: a piece of architecture work — the container for its decisions (decisions.project_id) and its changes (branches.project_id). A workflow record, never a landscape fact: not in deltas, heads or versions. Status moves through atlas.set_project_status only; never deleted.';

create index projects_model_status_idx on projects (model_id, status);

create table project_links (
  project_id uuid not null references projects (id),
  -- 'element': the project's declared scope (what it is about, recorded at
  -- the start). 'evidence': a business case, vendor document or link
  -- attached to the project rather than to one decision.
  linked_type text not null check (linked_type in ('element', 'evidence')),
  linked_id uuid not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (project_id, linked_type, linked_id)
);

comment on table project_links is 'ADR-024: polymorphic links from a project — element (declared scope) or evidence. Mirrors decision_links.';

create index project_links_linked_idx on project_links (linked_type, linked_id);

alter table decisions add column project_id uuid references projects (id);
comment on column decisions.project_id is 'ADR-024: the project this decision is part of (its decision log). Null is a portfolio-level decision. Written at creation or through atlas.set_decision_project only, so option changes follow (P1).';
create index decisions_project_id_idx on decisions (project_id) where project_id is not null;

alter table branches add column project_id uuid references projects (id);
alter table branches add constraint branches_project_only_for_change check (project_id is null or kind = 'change');
comment on column branches.project_id is 'ADR-024: the project this change belongs to (at most one). Branch metadata like title/intent — never read by fold, merge classification or the head hash. Changeable only while the change is open (P2).';
create index branches_project_id_idx on branches (project_id) where project_id is not null;

alter table decision_links drop constraint decision_links_linked_type_check;
alter table decision_links add constraint decision_links_linked_type_check
  check (linked_type in ('element', 'relationship', 'branch', 'assumption', 'evidence', 'project'));
comment on table decision_links is 'ADR-013/ADR-022/ADR-024: polymorphic links from a decision — element/relationship (what it concerns), branch (an option), assumption/evidence, project (a project this decision constrains but is not part of; being part of one is decisions.project_id).';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- §4: edit rights on a project's own fields — its creator or owner, or an
-- org owner/architect.
create or replace function atlas.can_edit_project(p_project projects)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select atlas.is_member(p_project.org_id)
    and (p_project.created_by = auth.uid() or p_project.owner_id = auth.uid() or atlas.has_role(p_project.org_id, 'owner', 'architect'));
$$;

-- Statuses in which a change is still open (P2, P4).
create or replace function atlas.branch_status_is_open(p_status branch_status)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_status in ('draft', 'proposed', 'in_review', 'approved');
$$;

-- A project can take on new members (a decision or a change) only while
-- it is open: otherwise P4's "a closed project has nothing open" would
-- stop being true the moment something was attached afterwards.
create or replace function atlas.assert_project_accepts_members(p_project_id uuid, p_model_id uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_project projects;
begin
  select * into v_project from projects where id = p_project_id;
  if v_project.id is null or v_project.model_id <> p_model_id then
    raise exception '%: project % is not in this model', p_what, p_project_id using errcode = '23503';
  end if;
  if v_project.status not in ('active', 'on_hold') then
    raise exception '%: this project is %, so nothing new can be added to it', p_what, v_project.status using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: projects
-- ---------------------------------------------------------------------------

alter table projects enable row level security;
alter table projects force row level security;

create policy projects_select on projects
  for select to authenticated
  using (atlas.is_member(org_id));

-- §4: owner/architect/contributor, mirroring decisions_insert; always
-- created active.
create policy projects_insert on projects
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
    and status = 'active'
    and closed_by is null
    and closed_at is null
    and close_reason is null
    and exists (select 1 from models m where m.id = projects.model_id and m.org_id = projects.org_id)
  );

create policy projects_update on projects
  for update to authenticated
  using (status in ('active', 'on_hold') and atlas.can_edit_project(projects))
  with check (status in ('active', 'on_hold') and atlas.can_edit_project(projects));

revoke update on projects from authenticated;
grant select, insert on projects to authenticated;
-- status/closed_*/source_finding_key/created_* are never client-writable
-- after insert; status moves through atlas.set_project_status only.
grant update (title, purpose, owner_id, start_date, target_date) on projects to authenticated;
-- No delete policy: a project is never deleted (ADR-024 P4).

-- ---------------------------------------------------------------------------
-- RLS: project_links
-- ---------------------------------------------------------------------------

alter table project_links enable row level security;
alter table project_links force row level security;

create policy project_links_select on project_links
  for select to authenticated
  using (exists (select 1 from projects p where p.id = project_links.project_id and atlas.is_member(p.org_id)));

-- Scope and evidence are part of the project's own record, so the same
-- people who may edit its fields may add or remove them, while it is open.
create policy project_links_insert on project_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from projects p where p.id = project_links.project_id and p.status in ('active', 'on_hold') and atlas.can_edit_project(p))
  );

create policy project_links_delete on project_links
  for delete to authenticated
  using (exists (select 1 from projects p where p.id = project_links.project_id and p.status in ('active', 'on_hold') and atlas.can_edit_project(p)));

grant select, insert, delete on project_links to authenticated;

-- A linked element must exist in the project's own model (checked against
-- permanent history, like comment anchors — a later retraction doesn't
-- invalidate the link); linked evidence must belong to the same model.
create or replace function atlas.check_project_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model_id uuid;
begin
  select model_id into v_model_id from projects where id = new.project_id;
  if new.linked_type = 'element' then
    if not exists (select 1 from deltas where kind = 'element_create' and subject_id = new.linked_id and model_id = v_model_id) then
      raise exception 'check_project_link: no element % in this project''s model', new.linked_id using errcode = '23503';
    end if;
  elsif new.linked_type = 'evidence' then
    if not exists (select 1 from evidence where id = new.linked_id and model_id = v_model_id) then
      raise exception 'check_project_link: no evidence % in this project''s model', new.linked_id using errcode = '23503';
    end if;
  end if;
  return new;
end;
$$;

create trigger project_links_check
  before insert on project_links
  for each row execute function atlas.check_project_link();

-- ---------------------------------------------------------------------------
-- decisions.project_id
-- ---------------------------------------------------------------------------

-- Settable at insert (a decision started from a project page); never by a
-- plain update — atlas.set_decision_project moves it, with its options
-- (P1). It is deliberately absent from decisions' update grant list.
create or replace function atlas.guard_decision_project()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    perform atlas.assert_project_accepts_members(new.project_id, new.model_id, 'guard_decision_project');
  end if;
  return new;
end;
$$;

create trigger decisions_guard_project
  before insert or update of project_id on decisions
  for each row execute function atlas.guard_decision_project();

-- ---------------------------------------------------------------------------
-- branches.project_id (P1, P2)
-- ---------------------------------------------------------------------------

create or replace function atlas.guard_branch_project()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.project_id is null then
    return new;
  end if;

  -- P2: a change's project moves only while the change is open.
  if tg_op = 'UPDATE' and not atlas.branch_status_is_open(old.status) then
    raise exception 'guard_branch_project: this change is %, so its project can no longer change', old.status using errcode = '42501';
  end if;

  if new.project_id is not null then
    perform atlas.assert_project_accepts_members(new.project_id, new.model_id, 'guard_branch_project');
  end if;

  -- P1: an option follows its decision. atlas.set_decision_project moves
  -- the decision first, so its own option updates pass this check.
  if tg_op = 'UPDATE' and exists (
    select 1 from decision_links dl join decisions d on d.id = dl.decision_id
    where dl.linked_type = 'branch' and dl.linked_id = new.id and d.project_id is distinct from new.project_id
  ) then
    raise exception 'guard_branch_project: this change is an option of a decision in a different project — move the decision instead, and its options follow' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger branches_guard_project
  before insert or update of project_id on branches
  for each row execute function atlas.guard_branch_project();

-- Same roles branches_update already allows for title/intent/target_date.
grant update (project_id) on branches to authenticated;

-- ---------------------------------------------------------------------------
-- decision_links: P1 on option links, and 'project' links
-- ---------------------------------------------------------------------------

create or replace function atlas.check_decision_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
  v_branch_project uuid;
  v_branch_model uuid;
begin
  select * into v_decision from decisions where id = new.decision_id;

  if new.linked_type = 'branch' then
    select project_id, model_id into v_branch_project, v_branch_model from branches where id = new.linked_id;
    if v_branch_model is null then
      raise exception 'check_decision_link: no change %', new.linked_id using errcode = '23503';
    end if;
    -- P1: an option belongs to the same project as its decision.
    if v_branch_project is distinct from v_decision.project_id then
      raise exception 'check_decision_link: an option must be in the same project as its decision' using errcode = '23514';
    end if;
  elsif new.linked_type = 'project' then
    if not exists (select 1 from projects where id = new.linked_id and model_id = v_decision.model_id) then
      raise exception 'check_decision_link: no project % in this decision''s model', new.linked_id using errcode = '23503';
    end if;
    -- Being part of a project is decisions.project_id; a link says the
    -- decision constrains a project it is not part of. Never both.
    if new.linked_id = v_decision.project_id then
      raise exception 'check_decision_link: this decision is already part of that project' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger decision_links_check
  before insert on decision_links
  for each row execute function atlas.check_decision_link();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- P1: move a decision into (or out of, with null) a project, together with
-- every one of its option changes still in draft. Refused if an option
-- already past draft is in a different project, rather than leaving the
-- two disagreeing.
create or replace function atlas.set_decision_project(p_decision_id uuid, p_project_id uuid)
returns decisions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
begin
  select * into v_decision from decisions where id = p_decision_id for update;
  if v_decision.id is null then
    raise exception 'set_decision_project: decision % not found', p_decision_id using errcode = '22023';
  end if;
  if not (atlas.is_member(v_decision.org_id) and (v_decision.created_by = auth.uid() or atlas.has_role(v_decision.org_id, 'owner', 'architect'))) then
    raise exception 'set_decision_project: only the decision''s creator or an owner/architect may move it' using errcode = '42501';
  end if;
  if v_decision.status <> 'proposed' then
    raise exception 'set_decision_project: only a proposed decision can move between projects' using errcode = '42501';
  end if;
  if v_decision.project_id is not distinct from p_project_id then
    return v_decision;
  end if;

  if exists (
    select 1 from decision_links dl join branches b on b.id = dl.linked_id
    where dl.decision_id = p_decision_id and dl.linked_type = 'branch'
      and b.status <> 'draft' and b.project_id is distinct from p_project_id
  ) then
    raise exception 'set_decision_project: an option of this decision is already submitted or merged in its current project, so the decision cannot move' using errcode = '42501';
  end if;

  update decisions set project_id = p_project_id where id = p_decision_id returning * into v_decision;

  update branches b set project_id = p_project_id
  from decision_links dl
  where dl.decision_id = p_decision_id and dl.linked_type = 'branch' and dl.linked_id = b.id
    and b.status = 'draft' and b.project_id is distinct from p_project_id;

  return v_decision;
end;
$$;

revoke all on function atlas.set_decision_project(uuid, uuid) from public;
grant execute on function atlas.set_decision_project(uuid, uuid) to authenticated;

-- §4 and P4: active <-> on_hold freely; to closed or cancelled only with
-- nothing open in the project; cancelled needs a reason; closed and
-- cancelled are terminal. Never cancels anything itself.
create or replace function atlas.set_project_status(p_project_id uuid, p_status text, p_reason text default null)
returns projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project projects;
  v_open_changes integer;
  v_open_decisions integer;
begin
  select * into v_project from projects where id = p_project_id for update;
  if v_project.id is null then
    raise exception 'set_project_status: project % not found', p_project_id using errcode = '22023';
  end if;
  if not atlas.can_edit_project(v_project) then
    raise exception 'set_project_status: only the project''s creator or owner, or an org owner/architect, may change its status' using errcode = '42501';
  end if;
  if p_status not in ('active', 'on_hold', 'closed', 'cancelled') then
    raise exception 'set_project_status: unknown status %', p_status using errcode = '22023';
  end if;
  if v_project.status in ('closed', 'cancelled') then
    raise exception 'set_project_status: this project is % — start a new project instead of reopening it', v_project.status using errcode = '42501';
  end if;
  if v_project.status = p_status then
    return v_project;
  end if;

  if p_status in ('active', 'on_hold') then
    update projects set status = p_status where id = p_project_id returning * into v_project;
    return v_project;
  end if;

  if p_status = 'cancelled' and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'set_project_status: say why the project is being cancelled' using errcode = '22023';
  end if;

  -- P4: closing loses nothing.
  select count(*) into v_open_changes from branches where project_id = p_project_id and atlas.branch_status_is_open(status);
  select count(*) into v_open_decisions from decisions where project_id = p_project_id and status = 'proposed';
  if v_open_changes > 0 or v_open_decisions > 0 then
    raise exception 'set_project_status: OPEN_ITEMS — % open change(s) and % open decision(s) still in this project', v_open_changes, v_open_decisions using errcode = '55000';
  end if;

  update projects
  set status = p_status, closed_by = auth.uid(), closed_at = now(), close_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_project_id
  returning * into v_project;
  return v_project;
end;
$$;

revoke all on function atlas.set_project_status(uuid, text, text) from public;
grant execute on function atlas.set_project_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- P3: split keeps the project. Same body as 20260913100000_change_intent.sql's
-- atlas.split_branch, with project_id copied alongside target_date/intent.
-- ---------------------------------------------------------------------------

create or replace function atlas.split_branch(
  p_new_branch_id uuid,
  p_branch_id uuid,
  p_new_branch_name text,
  p_new_branch_title text,
  p_commit_id uuid,
  p_commit_title text,
  p_deltas jsonb,
  p_merge_request_id uuid,
  p_classification jsonb default '{}'::jsonb
)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_main branches;
  v_new_branch branches;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'split_branch: branch % not found', p_branch_id using errcode = '22023';
  end if;
  if atlas.has_role(v_branch.org_id, 'owner', 'architect') is not true then
    raise exception 'split_branch: only owners and architects may split a branch' using errcode = '42501';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'split_branch: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_branch.model_id and kind = 'main';
  if v_main.id is null then
    raise exception 'split_branch: model % has no main branch', v_branch.model_id using errcode = '22023';
  end if;
  if not atlas.branch_reaches_commit(p_branch_id, v_main.head_commit_id) then
    raise exception 'split_branch: REFRESH_REQUIRED — branch has not incorporated main''s current head' using errcode = '55000';
  end if;

  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, split_from, target_date, title, created_by, intent, project_id)
  values (p_new_branch_id, v_branch.org_id, v_branch.model_id, p_new_branch_name, 'change', 'draft', v_main.head_commit_id, v_main.head_commit_id, p_branch_id, v_branch.target_date, p_new_branch_title, auth.uid(), v_branch.intent, v_branch.project_id)
  returning * into v_new_branch;

  perform atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_branch.model_id,
    p_branch_id => p_new_branch_id,
    p_base_commit_id => v_main.head_commit_id,
    p_kind => 'manual',
    p_title => p_commit_title,
    p_deltas => p_deltas
  );

  update branches set status = 'approved' where id = p_new_branch_id;

  insert into merge_requests (id, org_id, model_id, branch_id, requested_head_commit_id, main_head_commit_id, status, requested_by, reviewed_by, reviewed_at, classification)
  values (p_merge_request_id, v_branch.org_id, v_branch.model_id, p_new_branch_id, p_commit_id, v_main.head_commit_id, 'approved', auth.uid(), auth.uid(), now(), coalesce(p_classification, '{}'::jsonb));

  select * into v_new_branch from branches where id = p_new_branch_id;
  return v_new_branch;
end;
$$;

revoke all on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) from public;
grant execute on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Comment anchors: 'project' (ADR-010). Same bodies as
-- 20260913110000_decisions.sql, plus the 'project' case — org-shared like a
-- decision, so bare existence is the visibility check.
-- ---------------------------------------------------------------------------

create or replace function atlas.anchor_visible_to_viewer(p_type anchor_type, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_type
    when 'project'  then exists (select 1 from projects where id = p_id)
    when 'decision' then exists (select 1 from decisions where id = p_id)
    when 'change'   then atlas.branch_visible_to_viewer(p_id)
    when 'version'  then exists (select 1 from tags where id = p_id)
    when 'element'  then exists (
                      select 1 from elements_head eh join branches b on b.head_commit_id = eh.commit_id
                      where eh.element_id = p_id and (b.kind = 'main' or b.shared_for_review))
    when 'relationship' then exists (
                      select 1 from relationships_head rh join branches b on b.head_commit_id = rh.commit_id
                      where rh.relationship_id = p_id and (b.kind = 'main' or b.shared_for_review))
  end;
$$;

create or replace function atlas.check_anchor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent comments;
begin
  case new.anchor_type
    when 'element' then
      if not exists (select 1 from deltas where kind = 'element_create' and subject_id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no element % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'relationship' then
      if not exists (select 1 from deltas where kind = 'relationship_create' and subject_id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no relationship % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'change' then
      if not exists (select 1 from branches where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no branch % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'version' then
      if not exists (select 1 from tags where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no tag % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'decision' then
      if not exists (select 1 from decisions where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no decision % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
    when 'project' then
      if not exists (select 1 from projects where id = new.anchor_id and model_id = new.model_id) then
        raise exception 'check_anchor: no project % in model %', new.anchor_id, new.model_id using errcode = '23503';
      end if;
  end case;

  if new.parent_comment_id is not null then
    select * into v_parent from comments where id = new.parent_comment_id;
    if v_parent.id is null then
      raise exception 'check_anchor: parent comment % not found', new.parent_comment_id using errcode = '23503';
    end if;
    if v_parent.parent_comment_id is not null then
      raise exception 'check_anchor: replies are flat — cannot reply to a reply (ADR-010)' using errcode = '23514';
    end if;
    if v_parent.anchor_type <> new.anchor_type or v_parent.anchor_id <> new.anchor_id then
      raise exception 'check_anchor: a reply must share its root comment''s anchor' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- atlas.delete_model: same body as 20260927010000_delete_model_missing_tables.sql,
-- plus projects/project_links and the decision_option_ratings it was missing.
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
