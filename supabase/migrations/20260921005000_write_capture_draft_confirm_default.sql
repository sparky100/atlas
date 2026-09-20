-- F2 (full K1) PR8 follow-up on PR7: SPEC-capture.md §4.4's own "Default
-- staged decision" column — `confirm` is the *only* class pre-staged
-- `accepted` at write time ("bulk; reviewer can exclude" via `x`+`r`);
-- every other class starts undecided. `atlas.write_capture_draft`
-- (20260920030000_write_capture_draft.sql) inserted every candidate with
-- `decision` at its column default (null), missing this one case — found
-- while building `atlas.apply_capture_decisions` (this same PR), whose
-- own "every candidate has a decision" completion check
-- (job.status -> 'reviewed') would otherwise wait forever on a job's own
-- `confirm` candidates, since nothing else in this sprint's sequence ever
-- calls `atlas.stage_capture_decisions` on a caller's behalf: that RPC is
-- `authenticated`-only (a real reviewer's own JWT drives `decided_by`),
-- where `write_capture_draft` runs entirely under the service role
-- (SPEC §3.5) — so a system default has nowhere else to come from but
-- this insert itself. `decided_by`/`decided_at` stay null: nobody
-- decided this, the default did, and the review queue's own `x` + `r`
-- can still un-accept it (`atlas.stage_capture_decisions`'s `u`/reject
-- path, same as any other candidate).
--
-- create or replace function, not a table migration — this changes what
-- one existing function does, not the schema it writes to; identical
-- body to the original except the one line replacing the plain `insert
-- into capture_candidates (...)` column list with `decision` added.
create or replace function atlas.write_capture_draft(
  p_job_id uuid,
  p_branch_id uuid,
  p_commit_id uuid,
  p_commit_body text,
  p_deltas jsonb,
  p_candidates jsonb,
  p_stats jsonb
)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job capture_jobs;
  v_main_head_commit_id uuid;
  v_parent_depth int;
  v_branch_title text;
  v_commit_title text;
  v_branch branches;
begin
  select * into v_job from capture_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'write_capture_draft: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_job.status <> 'pending' then
    raise exception 'write_capture_draft: capture job % is % (must be pending)', p_job_id, v_job.status using errcode = '42501';
  end if;

  -- ADR-018: main always has a real head (its own genesis commit, at
  -- minimum), so this is never null — the same guarantee CommitEnvelope's
  -- own `parentCommitId: UUID | null` doc comment already relies on for an
  -- ordinary client-built envelope.
  select head_commit_id into v_main_head_commit_id from branches where model_id = v_job.model_id and kind = 'main';
  select depth into v_parent_depth from commits where id = v_main_head_commit_id;

  -- SPEC §8.1 step 1: name/title are a fixed, deterministic shape, never a
  -- caller-supplied string — computed here, not accepted as a parameter,
  -- so `capture/{job_id}` (and the `unique (model_id, name)` constraint it
  -- leans on to keep one draft branch per job) can never drift by caller.
  v_branch_title := v_job.input_name || ' — ' || coalesce(v_job.document_date::text, current_date::text);
  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, title, created_by)
  values (p_branch_id, v_job.org_id, v_job.model_id, 'capture/' || p_job_id, 'capture_draft', 'draft', v_main_head_commit_id, v_main_head_commit_id, v_branch_title, v_job.created_by)
  returning * into v_branch;

  v_commit_title := 'Capture from ' || v_job.input_name;
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, kind, title, body, author_id, depth)
  values (p_commit_id, v_job.org_id, v_job.model_id, p_branch_id, v_main_head_commit_id, 'capture', v_commit_title, p_commit_body, v_job.created_by, coalesce(v_parent_depth, 0) + 1);

  if jsonb_array_length(p_deltas) > 0 then
    insert into deltas (
      id, org_id, model_id, commit_id, seq, kind, subject_id, attribute, element_type, relationship_type, name, parent_id, from_element_id, to_element_id,
      value, previous_delta_id, source_id, source_ref, effective_date, confidence, created_by
    )
    select
      (d ->> 'id')::uuid, v_job.org_id, v_job.model_id, p_commit_id, (ord - 1)::int, (d ->> 'kind')::delta_kind, (d ->> 'subject_id')::uuid, d ->> 'attribute',
      nullif(d ->> 'element_type', '')::element_type, nullif(d ->> 'relationship_type', '')::relationship_type, d ->> 'name', (d ->> 'parent_id')::uuid,
      (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, nullif(d -> 'value', 'null'::jsonb), (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
      d ->> 'source_ref', nullif(d ->> 'effective_date', '')::date, (d ->> 'confidence')::numeric, v_job.created_by
    from jsonb_array_elements(p_deltas) with ordinality as t (d, ord);
  end if;

  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  if jsonb_array_length(p_candidates) > 0 then
    insert into capture_candidates (
      id, org_id, job_id, model_id, seq, kind, class, element_type, relationship_type, draft_subject_id,
      proposal, evidence, match, confidence, row_key, reimport_status, draft_delta_ids, decision
    )
    select
      (c ->> 'id')::uuid, v_job.org_id, p_job_id, v_job.model_id, (c ->> 'seq')::int, (c ->> 'kind')::subject_type, c ->> 'class',
      nullif(c ->> 'element_type', '')::element_type, nullif(c ->> 'relationship_type', '')::relationship_type, (c ->> 'draft_subject_id')::uuid,
      c -> 'proposal', c -> 'evidence', c -> 'match', (c ->> 'confidence')::numeric, c ->> 'row_key', nullif(c ->> 'reimport_status', ''),
      coalesce((select array_agg((e)::uuid) from jsonb_array_elements_text(c -> 'draft_delta_ids') as e), '{}'),
      case when c ->> 'class' = 'confirm' then 'accepted' else null end
    from jsonb_array_elements(p_candidates) as c;
  end if;

  update capture_jobs
  set resulting_branch_id = p_branch_id, stats = p_stats, status = 'parsed', finished_at = now(), progress = null
  where id = p_job_id;

  return v_branch;
end;
$$;

revoke all on function atlas.write_capture_draft(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) from public;
grant execute on function atlas.write_capture_draft(uuid, uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;
