-- D1 stage 3: create a change branch only when someone works on an option.
--
-- Stage 2 made the decision page read `decision_options`, but adding an option
-- still created a change branch immediately. This function is the one path
-- that attaches a branch to an existing candidate:
--   * the option must belong to a proposed decision;
--   * the caller must be able to contribute a change;
--   * the branch forks from main's current head, in the decision's project,
--     with the option's wording;
--   * the option gets that branch, and the branch gets the normal
--     `decision_links` row so the comparison and change views keep working.
--
-- Calling it twice is harmless: a second call returns the branch already
-- attached to the option. No option is deleted or rewritten beyond its
-- branch pointer.
create function atlas.work_on_decision_option(p_option_id uuid)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_option decision_options;
  v_decision decisions;
  v_main branches;
  v_branch branches;
  v_branch_id uuid := gen_random_uuid();
begin
  select * into v_option from decision_options where id = p_option_id for update;
  if v_option.id is null then
    raise exception 'work_on_decision_option: option % not found', p_option_id using errcode = '22023';
  end if;

  select * into v_decision from decisions where id = v_option.decision_id for update;
  if v_decision.id is null then
    raise exception 'work_on_decision_option: decision % not found', v_option.decision_id using errcode = '22023';
  end if;
  if v_decision.status <> 'proposed' then
    raise exception 'work_on_decision_option: decision % is % (must be proposed)', v_decision.id, v_decision.status using errcode = '42501';
  end if;
  if atlas.has_role(v_decision.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'work_on_decision_option: only owners, architects and contributors may work on an option' using errcode = '42501';
  end if;

  -- A branch that is already attached still needs its link if an earlier
  -- interrupted client write left one behind. The link insert is idempotent.
  if v_option.branch_id is not null then
    select * into v_branch from branches where id = v_option.branch_id;
    if v_branch.id is null then
      raise exception 'work_on_decision_option: option % points at missing branch %', p_option_id, v_option.branch_id using errcode = '22023';
    end if;
    insert into decision_links (decision_id, linked_type, linked_id, created_by)
      values (v_decision.id, 'branch', v_branch.id, auth.uid())
      on conflict do nothing;
    return v_branch;
  end if;

  select * into v_main from branches
    where model_id = v_decision.model_id and kind = 'main'
    limit 1;
  if v_main.id is null or v_main.head_commit_id is null then
    raise exception 'work_on_decision_option: this model has no main commit to base an option on' using errcode = '22023';
  end if;

  insert into branches
    (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id,
     title, description, created_by, intent, project_id)
  values
    (v_branch_id, v_decision.org_id, v_decision.model_id,
     'option-' || left(replace(v_branch_id::text, '-', ''), 8),
     'change', 'draft', v_main.head_commit_id, v_main.head_commit_id,
     v_option.title, nullif(v_option.summary, ''), auth.uid(), 'explore',
     v_decision.project_id)
  returning * into v_branch;

  update decision_options
    set branch_id = v_branch.id, updated_by = auth.uid(), updated_at = now()
    where id = v_option.id;

  -- The existing decision_links trigger sees the option already carrying this
  -- branch and does nothing, so no duplicate candidate row is created.
  insert into decision_links (decision_id, linked_type, linked_id, created_by)
    values (v_decision.id, 'branch', v_branch.id, auth.uid())
    on conflict do nothing;

  return v_branch;
end;
$$;

revoke all on function atlas.work_on_decision_option(uuid) from public, anon;
grant execute on function atlas.work_on_decision_option(uuid) to authenticated;
