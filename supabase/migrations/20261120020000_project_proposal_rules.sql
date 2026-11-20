-- Simon, 2026-11-20: a project is work in flight, so only an owner or architect
-- may start one outright. Anyone else who can create a project (a contributor)
-- may only propose one, and nobody accepts their own proposal: another owner or
-- architect does. If the proposer is the only owner or architect in the
-- organisation they may accept it, and the record says so (accepted_by equals
-- created_by).
--
-- Changes:
--   1. projects.accepted_by / accepted_at: who accepted a proposal, and when.
--      Written only by atlas.set_project_status. No foreign key and no index on
--      purpose, so this adds no advisor finding (CLAUDE.md rule 9). The cost is
--      that the database does not verify the id is a real user, as with
--      project_manager_id.
--   2. projects_insert: a contributor may insert only status 'proposed'; an
--      owner or architect may insert 'proposed' or 'active'. A new project is
--      never inserted already accepted.
--   3. atlas.set_project_status: accepting a proposal refuses the proposer
--      while another owner or architect exists, and records who accepted it.
--      Replaces the existing function with its caller checks intact (still
--      fail-closed; execute still revoked from public and anon), so the count
--      of signed-in-executable SECURITY DEFINER functions does not change.
--
-- Projects already active or proposed are untouched. No new table, view,
-- function or trigger.

alter table projects add column accepted_by uuid;
alter table projects add column accepted_at timestamptz;
alter table projects add constraint projects_accepted_together check ((accepted_by is null) = (accepted_at is null));

comment on column projects.accepted_by is 'Who accepted this project when it was proposed. Null for a project started active, or still proposed. Equal to created_by when the proposer was the only owner or architect. Written by atlas.set_project_status only.';

drop policy projects_insert on projects;
create policy projects_insert on projects
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (status = 'proposed' and atlas.has_role(org_id, 'owner', 'architect', 'contributor'))
      or (status = 'active' and atlas.has_role(org_id, 'owner', 'architect'))
    )
    and closed_by is null
    and closed_at is null
    and close_reason is null
    and accepted_by is null
    and accepted_at is null
    and exists (select 1 from models m where m.id = projects.model_id and m.org_id = projects.org_id)
  );

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
  v_other_approvers integer;
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
      -- Nobody accepts their own proposal, unless nobody else could.
      if v_project.created_by = (select auth.uid()) then
        select count(*) into v_other_approvers
        from members m
        where m.org_id = v_project.org_id and m.role in ('owner', 'architect') and m.user_id <> (select auth.uid());
        if v_other_approvers > 0 then
          raise exception 'set_project_status: you proposed this project, so another owner or architect has to accept it' using errcode = '42501';
        end if;
      end if;
      update projects set status = 'active', accepted_by = (select auth.uid()), accepted_at = now() where id = p_project_id returning * into v_project;
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
