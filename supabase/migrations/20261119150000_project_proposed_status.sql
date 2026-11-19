-- Phase B2 (Simon approved 2026-11-19): a project can start as a proposal.
-- `proposed` is a fifth project status: not yet work in flight, but decisions,
-- drafted changes and scope can be added to it while it is designed. An org
-- owner or architect accepts it (it becomes `active`) or declines it with a
-- reason (it becomes `cancelled`). A project can only be `proposed` at the
-- moment it is created; nothing goes back to proposed.
--
-- Advisor discipline (CLAUDE.md rule 9): no new table or function. Existing
-- SECURITY DEFINER functions are replaced with their caller checks intact
-- (still fail-closed) and execute still revoked from public and anon, so the
-- count of signed-in-executable definer functions does not change.

alter table projects drop constraint projects_status_check;
alter table projects add constraint projects_status_check check (status in ('proposed', 'active', 'on_hold', 'closed', 'cancelled'));

-- Decisions and changes may be added while a project is proposed (its design).
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
  if v_project.status not in ('proposed', 'active', 'on_hold') then
    raise exception '%: this project is %, so nothing new can be added to it', p_what, v_project.status using errcode = '42501';
  end if;
end;
$$;

-- A project may be created active (the default) or as a proposal.
drop policy projects_insert on projects;
create policy projects_insert on projects
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = auth.uid()
    and status in ('active', 'proposed')
    and closed_by is null
    and closed_at is null
    and close_reason is null
    and exists (select 1 from models m where m.id = projects.model_id and m.org_id = projects.org_id)
  );

-- Fields and scope stay editable while the project is proposed.
drop policy projects_update on projects;
create policy projects_update on projects
  for update to authenticated
  using (status in ('proposed', 'active', 'on_hold') and atlas.can_edit_project(projects))
  with check (status in ('proposed', 'active', 'on_hold') and atlas.can_edit_project(projects));

drop policy project_links_insert on project_links;
create policy project_links_insert on project_links
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from projects p where p.id = project_links.project_id and p.status in ('proposed', 'active', 'on_hold') and atlas.can_edit_project(p))
  );

drop policy project_links_delete on project_links;
create policy project_links_delete on project_links
  for delete to authenticated
  using (exists (select 1 from projects p where p.id = project_links.project_id and p.status in ('proposed', 'active', 'on_hold') and atlas.can_edit_project(p)));

-- Same rules as before for active, on_hold, closed and cancelled, plus:
--   proposed -> active   only an org owner or architect (never the proposer alone)
--   proposed -> cancelled  declining, with a reason; still refused while anything is open (P4)
--   proposed -> on_hold or closed   refused: accept or decline first
--   anything -> proposed   refused: a project is only proposed when created
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

  if v_project.status = 'proposed' then
    if p_status in ('on_hold', 'closed') then
      raise exception 'set_project_status: this project is only proposed — accept or decline it first' using errcode = '42501';
    end if;
    if p_status = 'active' then
      if atlas.has_role(v_project.org_id, 'owner', 'architect') is not true then
        raise exception 'set_project_status: only an owner or architect may accept a proposed project' using errcode = '42501';
      end if;
      update projects set status = 'active' where id = p_project_id returning * into v_project;
      return v_project;
    end if;
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

revoke all on function atlas.set_project_status(uuid, text, text) from public, anon;
grant execute on function atlas.set_project_status(uuid, text, text) to authenticated;
