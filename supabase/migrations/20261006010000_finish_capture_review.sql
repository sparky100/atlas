-- SPEC-capture.md §3.2/§8.2 (amended): atlas.finish_capture_review — the
-- `parsed -> reviewed` transition for a capture job whose remaining
-- decisions promote nothing.
--
-- Before this, the only way out of `parsed` other than discarding the run
-- was atlas.apply_capture_decisions, which requires a draft `change`
-- branch as its target even when every remaining decision is `rejected`
-- (§8.2's own table: `rejected` promotes nothing). A reviewer who rejected
-- every candidate had to create an empty change purely to close the
-- review — and the job sat in the review queue until they did.
--
-- This function closes the review without a target and without a commit:
-- it is legal only when no candidate is undecided and every candidate not
-- yet promoted (promoted_commit_id is null) is `rejected` — i.e. exactly
-- the state in which apply_capture_decisions would write no deltas. Any
-- accepted/edited/merged/split candidate still waiting to be promoted
-- makes it refuse; that case still needs a real apply into a change.
-- Rejections stay recorded on the candidate rows (§8.2: "recorded, not
-- deleted"); the draft branch is archived exactly as apply's own step 5
-- archives it.
--
-- Same row-lock / status / role shape as atlas.apply_capture_decisions
-- (contributor+ on the org — the same people who may stage and apply).
create or replace function atlas.finish_capture_review(p_job_id uuid)
returns capture_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job capture_jobs;
  v_undecided_count int;
  v_unpromoted_count int;
begin
  select * into v_job from capture_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'finish_capture_review: capture job % not found', p_job_id using errcode = '22023';
  end if;
  if v_job.status <> 'parsed' then
    raise exception 'finish_capture_review: capture job % is % (must be parsed)', p_job_id, v_job.status using errcode = '42501';
  end if;
  if atlas.has_role(v_job.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'finish_capture_review: insufficient role in this organisation' using errcode = '42501';
  end if;

  select count(*) into v_undecided_count from capture_candidates where job_id = p_job_id and decision is null;
  if v_undecided_count > 0 then
    raise exception 'finish_capture_review: % candidate(s) still undecided — CANDIDATES_UNDECIDED', v_undecided_count using errcode = '42501';
  end if;

  select count(*) into v_unpromoted_count from capture_candidates where job_id = p_job_id and decision <> 'rejected' and promoted_commit_id is null;
  if v_unpromoted_count > 0 then
    raise exception 'finish_capture_review: % accepted candidate(s) not yet applied to a change — CANDIDATES_UNAPPLIED', v_unpromoted_count using errcode = '42501';
  end if;

  update capture_jobs set status = 'reviewed' where id = p_job_id;

  if v_job.resulting_branch_id is not null then
    update branches set status = 'archived' where id = v_job.resulting_branch_id;
  end if;

  select * into v_job from capture_jobs where id = p_job_id;
  return v_job;
end;
$$;

revoke all on function atlas.finish_capture_review(uuid) from public;
grant execute on function atlas.finish_capture_review(uuid) to authenticated;
