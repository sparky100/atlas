-- Item 2 of the 25 Nov review, part 2 (proposals/PROPOSAL-research-candidate-option.md,
-- scope B chosen by Simon 2026-11-25): saving a Designer suggestion creates a
-- candidate option only. No change branch is made until a person presses
-- "Work on this option" (atlas.work_on_decision_option).
--
-- One invoker function saves the candidate, its "Suggested by the Designer"
-- provenance and its reviewed catalogue citations in one transaction, like
-- public.add_option_with_catalogue_sources does for a branch-backed option.
-- The candidate's id is the suggestion card's own id, so a retry or a double
-- click completes the option instead of duplicating it.
--
-- SECURITY INVOKER: every row still passes the existing decision_options and
-- option_catalogue_sources insert policies as the caller. The only privileged
-- step is the existing atlas_private.lock_catalogue_option_decision, which
-- checks the same contributor gate itself. search_path is fixed, and execute
-- is revoked from public and anon, so this adds no advisor finding.

create function public.add_designer_candidate(p_decision uuid, p_option jsonb, p_sources jsonb)
returns decision_options
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
  v_existing decision_options;
  v_option decision_options;
  v_id uuid;
  v_source jsonb;
  v_requested jsonb;
  v_saved jsonb;
  v_approach text;
begin
  perform atlas_private.lock_catalogue_option_decision(p_decision);
  select * into v_decision from decisions where id = p_decision;
  if (v_decision.status = 'proposed' and atlas.has_role(v_decision.org_id, 'owner', 'architect', 'contributor')) is not true then
    raise exception 'only a contributor or above may add an option to a proposed decision' using errcode = '42501';
  end if;
  if jsonb_typeof(p_option) is distinct from 'object' or jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_array_length(p_sources) > 10 then
    raise exception 'an option and at most 10 catalogue citations required' using errcode = '22023';
  end if;
  v_id := (p_option->>'id')::uuid;
  if v_id is null or (p_option->>'draftedAt') is null then
    raise exception 'option id and drafted time required' using errcode = '22023';
  end if;
  if (p_option->>'editedBy') is not null and (p_option->>'editedBy')::uuid is distinct from auth.uid() then
    raise exception 'edit attribution must name the caller' using errcode = '42501';
  end if;
  if ((p_option->>'editedBy') is null) <> ((p_option->>'editedAt') is null) then
    raise exception 'edit identity and date must be supplied together' using errcode = '22023';
  end if;
  v_approach := nullif(p_option->>'approach', '');
  if v_approach = 'no_change' then
    raise exception 'a Designer suggestion cannot be the baseline' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('sector', x->>'sector', 'version', (x->>'version')::int, 'entryCode', x->>'entryCode')
    order by x->>'sector', (x->>'version')::int, x->>'entryCode'), '[]'::jsonb) into v_requested from jsonb_array_elements(p_sources) x;
  if (select count(distinct x) from jsonb_array_elements(v_requested) x) <> jsonb_array_length(v_requested) then
    raise exception 'duplicate catalogue citation' using errcode = '22023';
  end if;

  select * into v_existing from decision_options where id = v_id;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('sector', catalogue_sector, 'version', catalogue_version, 'entryCode', entry_code)
      order by catalogue_sector, catalogue_version, entry_code), '[]'::jsonb) into v_saved
      from option_catalogue_sources where option_id = v_id;
    if v_existing.decision_id is distinct from p_decision
      or v_existing.source is distinct from 'designer'
      or v_existing.drafted_at is distinct from (p_option->>'draftedAt')::timestamptz
      or v_saved is distinct from v_requested then
      raise exception 'option already saved with different provenance; use a new option' using errcode = '23514';
    end if;
    -- Do not reset a later human edit on a retry.
    return v_existing;
  end if;

  insert into decision_options
    (id, decision_id, branch_id, title, summary, to_weigh, approach, position,
     source, agent, drafted_at, draft_run_id, edited_by, edited_at, created_by, updated_by)
  values
    (v_id, p_decision, null, btrim(p_option->>'title'), coalesce(btrim(p_option->>'summary'), ''),
     coalesce(btrim(p_option->>'toWeigh'), ''), v_approach,
     coalesce((select max(o.position) from decision_options o where o.decision_id = p_decision), 0) + 1,
     'designer', 'designer', (p_option->>'draftedAt')::timestamptz, (p_option->>'draftRunId')::uuid,
     case when (p_option->>'editedBy') is not null then auth.uid() end,
     (p_option->>'editedAt')::timestamptz, auth.uid(), auth.uid())
  returning * into v_option;

  for v_source in select value from jsonb_array_elements(v_requested) loop
    insert into option_catalogue_sources(decision_id, option_id, branch_id, catalogue_sector, catalogue_version, entry_code, cited_by)
      values(p_decision, v_id, null, v_source->>'sector', (v_source->>'version')::int, v_source->>'entryCode', auth.uid());
  end loop;

  return v_option;
end;
$$;

revoke all on function public.add_designer_candidate(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_designer_candidate(uuid, jsonb, jsonb) to authenticated;

comment on function public.add_designer_candidate(uuid, jsonb, jsonb) is
  'Saves one Designer suggestion as a candidate option (no change branch), with its provenance and reviewed catalogue citations, in one transaction. Invoker rights; idempotent on the suggestion id.';
