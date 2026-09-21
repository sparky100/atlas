-- F2 (full K1) PR8: SPEC-capture.md §8.2 — atlas.stage_capture_decisions
-- and atlas.apply_capture_decisions, the two RPCs that turn a reviewer's
-- decisions on a capture draft's own candidates into a real commit on a
-- change branch.
--
-- Unlike write_capture_draft (PR7), apply_capture_decisions does NOT
-- reinvent the deltas-insert/branch-head-advance logic: it calls the
-- already-built atlas.commit_deltas for that (§8.2 step 1: "Calls
-- atlas.commit_deltas with p_envelope"). This is possible here in a way
-- it wasn't for write_capture_draft because the target is an ordinary
-- `change` branch commit_deltas already knows how to write — a
-- capture_draft branch's own creation (a brand-new branch, in the same
-- call) is the structurally different case that still needs its own
-- function. What this function adds on top of commit_deltas — aliases,
-- capture_candidates bookkeeping, resolved_conflicts, job/branch status —
-- are all capture-specific tables commit_deltas has no reason to know
-- about, the same "writes tables the other function never touches"
-- reasoning seed_from_map.sql and write_capture_draft.sql already give
-- for themselves.
--
-- Both `atlas.stage_capture_decisions` and `atlas.apply_capture_decisions`
-- are ordinary `authenticated`-callable, contributor+-gated RPCs — a real
-- reviewer's own JWT drives both, unlike write_capture_draft's
-- service-role-only call. `auth.uid()` is what makes `decided_by` and
-- (inside the nested `commit_deltas` call) `author_id`/`created_by`
-- correct: SECURITY DEFINER changes whose *privileges* a function runs
-- with, never whose *identity* `auth.uid()` reports — that's the calling
-- session's JWT throughout, nested calls included.
create or replace function atlas.stage_capture_decisions(
  p_job_id uuid,
  p_decisions jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_status capture_status;
begin
  select org_id, status into v_org_id, v_status from capture_jobs where id = p_job_id;
  if v_org_id is null then
    raise exception 'stage_capture_decisions: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_status <> 'parsed' then
    raise exception 'stage_capture_decisions: capture job % is % (must be parsed)', p_job_id, v_status using errcode = '42501';
  end if;
  if atlas.has_role(v_org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'stage_capture_decisions: insufficient role in this organisation' using errcode = '42501';
  end if;

  -- `u` (undo) is a decision of `null` in p_decisions — clears decided_by/decided_at too, not just decision itself.
  update capture_candidates cc
  set
    decision = nullif(d ->> 'decision', ''),
    decision_detail = d -> 'decision_detail',
    decided_by = case when d ->> 'decision' is null then null else auth.uid() end,
    decided_at = case when d ->> 'decision' is null then null else now() end
  from jsonb_array_elements(p_decisions) as d
  where cc.id = (d ->> 'candidate_id')::uuid and cc.job_id = p_job_id;
end;
$$;

revoke all on function atlas.stage_capture_decisions(uuid, jsonb) from public;
grant execute on function atlas.stage_capture_decisions(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.apply_capture_decisions (§8.2 steps 1-5). The caller has already
-- built p_deltas/p_alias_rows/p_candidate_outcomes/p_resolved_conflicts
-- with src/capture/buildPromotionEnvelope.ts, folding the result with
-- src/engine first — the same "pre-check before the RPC" division of
-- labour write_capture_draft's own header comment describes. This
-- function's own job is purely to persist that already-checked result
-- atomically: a failure at any step leaves the target branch, the
-- aliases, and the candidates exactly as they were (§8.2's own "all in
-- one transaction").
-- ---------------------------------------------------------------------------
create or replace function atlas.apply_capture_decisions(
  p_job_id uuid,
  p_target_branch_id uuid,
  p_commit_id uuid,
  p_commit_title text,
  p_commit_body text,
  p_deltas jsonb,
  p_alias_rows jsonb,
  p_candidate_outcomes jsonb,
  p_resolved_conflicts jsonb,
  p_stats jsonb
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job capture_jobs;
  v_branch branches;
  v_commit commits;
  v_undecided_count int;
begin
  select * into v_job from capture_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'apply_capture_decisions: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_job.status <> 'parsed' then
    raise exception 'apply_capture_decisions: capture job % is % (must be parsed)', p_job_id, v_job.status using errcode = '42501';
  end if;

  select * into v_branch from branches where id = p_target_branch_id for update;
  if v_branch.id is null then
    raise exception 'apply_capture_decisions: target branch % not found', p_target_branch_id using errcode = '22023';
  end if;
  if v_branch.model_id <> v_job.model_id then
    raise exception 'apply_capture_decisions: target branch % is not a branch of job %''s own model', p_target_branch_id, p_job_id using errcode = '22023';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'apply_capture_decisions: target branch % is not a change branch' , p_target_branch_id using errcode = '42501';
  end if;
  if v_branch.status <> 'draft' then
    raise exception 'apply_capture_decisions: target branch % is % (must be draft) — TARGET_BRANCH_NOT_DRAFT', p_target_branch_id, v_branch.status using errcode = '42501';
  end if;

  -- Step 1: atlas.commit_deltas does the role check, the deltas insert,
  -- and the branch head advance (C13's own unique-index race guard) — the
  -- same call src/db/commits.ts's own commitToBranch makes for an
  -- ordinary manual edit, just from inside this function instead of from
  -- the client directly.
  select * into v_commit from atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_job.model_id,
    p_branch_id => p_target_branch_id,
    p_base_commit_id => v_branch.head_commit_id,
    p_kind => 'manual',
    p_title => p_commit_title,
    p_deltas => p_deltas,
    p_body => p_commit_body
  );

  -- Step 2: aliases (§7.6) — "skipping any that already resolve to the
  -- same element" is the ordinary case this on conflict handles; a
  -- collision with a *different* element (ALIAS_COLLISION, §11) is
  -- likewise skipped rather than corrupting that element's own alias —
  -- never overwritten either way, both are conflict targets on
  -- `aliases_model_id_alias_type_value_idx`.
  if jsonb_array_length(p_alias_rows) > 0 then
    insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
    select (a ->> 'id')::uuid, v_job.org_id, v_job.model_id, (a ->> 'element_id')::uuid, a ->> 'alias_value', (a ->> 'alias_type')::alias_type, (a ->> 'source_id')::uuid, (a ->> 'confidence')::numeric, auth.uid()
    from jsonb_array_elements(p_alias_rows) as a
    on conflict (model_id, alias_type, lower(alias_value)) do nothing;
  end if;

  -- Step 3: capture_candidates bookkeeping for every candidate this call actually promoted.
  if jsonb_array_length(p_candidate_outcomes) > 0 then
    update capture_candidates cc
    set promoted_commit_id = p_commit_id, promoted_subject_id = (o ->> 'promoted_subject_id')::uuid
    from jsonb_array_elements(p_candidate_outcomes) as o
    where cc.id = (o ->> 'candidate_id')::uuid and cc.job_id = p_job_id;
  end if;

  -- Step 4: resolved_conflicts for `edited` candidates (winning = the human delta, discarded = the draft delta).
  if jsonb_array_length(p_resolved_conflicts) > 0 then
    insert into resolved_conflicts (id, org_id, model_id, winning_delta_id, discarded_delta_id, resolution_delta_id, resolved_by, rationale)
    select (r ->> 'id')::uuid, v_job.org_id, v_job.model_id, (r ->> 'winning_delta_id')::uuid, (r ->> 'discarded_delta_id')::uuid, nullif(r ->> 'resolution_delta_id', '')::uuid, auth.uid(), r ->> 'rationale'
    from jsonb_array_elements(p_resolved_conflicts) as r;
  end if;

  -- Step 5: job/branch status. `status = 'reviewed'` and the draft archived only once every candidate has a decision.
  select count(*) into v_undecided_count from capture_candidates where job_id = p_job_id and decision is null;
  update capture_jobs
  set target_branch_id = p_target_branch_id, stats = p_stats, status = case when v_undecided_count = 0 then 'reviewed' else status end
  where id = p_job_id;

  if v_undecided_count = 0 and v_job.resulting_branch_id is not null then
    update branches set status = 'archived' where id = v_job.resulting_branch_id;
  end if;

  return v_commit;
end;
$$;

revoke all on function atlas.apply_capture_decisions(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function atlas.apply_capture_decisions(uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
