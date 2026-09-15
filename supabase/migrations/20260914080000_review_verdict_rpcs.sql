-- F3a: the review-verdict write paths, after the `review_assigned` enum
-- value (20260914070000) and the schema (20260914060000) exist.
--
-- Three functions, all security definer for the same reason the existing
-- review-queue functions are (they write `branches.status` and/or
-- `merge_requests.status` together with `review_verdicts` atomically, which
-- plain RLS was never written to allow as separate client writes):
--
-- - `submit_merge_request` gains a `p_reviewers` parameter: for a
--   `propose`/`explore` change it validates the set against the org's
--   `review_min_required_architects`, writes the pending `review_verdicts`
--   rows, and notifies each assigned reviewer. For `record`/`correct` the
--   single-approver path is unchanged (`p_reviewers` is null/empty and no
--   verdicts are written).
-- - `set_review_verdict` casts (or updates) the caller's own verdict and
--   recomputes the gate transactionally: any `request_changes` returns the
--   request to `changes_requested` (branch `draft`); all required reviewers
--   `approve` promotes it to `approved`.
-- - `set_reviewers` lets the proposer (or an owner/architect) replace the
--   reviewer set while the request is still `pending`, re-validating the
--   architect floor and notifying newly-added reviewers.
--
-- The old 3-arg `submit_merge_request(uuid, uuid, jsonb)` is dropped first:
-- `create or replace` on a changed parameter list would silently create a
-- second, coexisting overload instead (the same 42P13 pitfall
-- 20260906161000's own commit_deltas note documents).

drop function if exists atlas.submit_merge_request(uuid, uuid, jsonb);

create or replace function atlas.submit_merge_request(
  p_id uuid,
  p_branch_id uuid,
  p_classification jsonb default '{}'::jsonb,
  p_reviewers jsonb default null
)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_main branches;
  v_row merge_requests;
  v_multi boolean;
  v_reviewer jsonb;
  v_user_id uuid;
  v_required boolean;
  v_architect_count int;
  v_min_architects int;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'submit_merge_request: branch % not found', p_branch_id using errcode = '22023';
  end if;

  if atlas.has_role(v_branch.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'submit_merge_request: insufficient role in this organisation' using errcode = '42501';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'submit_merge_request: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;
  if v_branch.status <> 'draft' then
    raise exception 'submit_merge_request: branch % is not draft (status %)', p_branch_id, v_branch.status using errcode = '42501';
  end if;

  -- F0's review weight: propose/explore carry a reviewer set; record/correct
  -- stay on the single-approver path (no verdicts).
  v_multi := v_branch.intent in ('propose', 'explore');

  if v_multi and (p_reviewers is null or jsonb_array_length(p_reviewers) = 0) then
    raise exception 'submit_merge_request: this change needs a reviewer set' using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_branch.model_id and kind = 'main';

  insert into merge_requests (id, org_id, model_id, branch_id, requested_head_commit_id, main_head_commit_id, status, requested_by, classification)
  values (p_id, v_branch.org_id, v_branch.model_id, p_branch_id, v_branch.head_commit_id, v_main.head_commit_id, 'pending', auth.uid(), coalesce(p_classification, '{}'::jsonb))
  returning * into v_row;

  update branches set status = 'proposed' where id = p_branch_id;

  if v_multi then
    select review_min_required_architects into v_min_architects from organisations where id = v_branch.org_id;
    v_architect_count := 0;
    for v_reviewer in select * from jsonb_array_elements(p_reviewers) loop
      v_user_id := (v_reviewer ->> 'user_id')::uuid;
      if v_user_id is null then
        raise exception 'submit_merge_request: a reviewer is missing a user_id' using errcode = '22023';
      end if;
      if not exists (select 1 from members where org_id = v_branch.org_id and user_id = v_user_id) then
        raise exception 'submit_merge_request: reviewer % is not a member of this organisation', v_user_id using errcode = '42501';
      end if;
      if exists (select 1 from members where org_id = v_branch.org_id and user_id = v_user_id and role = 'architect') then
        v_architect_count := v_architect_count + 1;
      end if;
    end loop;

    if v_architect_count < v_min_architects then
      raise exception 'submit_merge_request: the required reviewer set needs at least % architect(s)', v_min_architects using errcode = '42501';
    end if;

    for v_reviewer in select * from jsonb_array_elements(p_reviewers) loop
      v_user_id := (v_reviewer ->> 'user_id')::uuid;
      v_required := coalesce((v_reviewer ->> 'required')::boolean, false);
      insert into review_verdicts (id, org_id, model_id, merge_request_id, user_id, required, verdict)
      values (gen_random_uuid(), v_branch.org_id, v_branch.model_id, p_id, v_user_id, v_required, 'pending');
      if v_user_id <> auth.uid() then
        insert into notifications (id, org_id, user_id, kind, merge_request_id)
        values (gen_random_uuid(), v_branch.org_id, v_user_id, 'review_assigned', p_id);
      end if;
    end loop;
  end if;

  return v_row;
end;
$$;

revoke all on function atlas.submit_merge_request(uuid, uuid, jsonb, jsonb) from public;
grant execute on function atlas.submit_merge_request(uuid, uuid, jsonb, jsonb) to authenticated;

-- A reviewer casts (or changes) their own verdict. Recomputed in the same
-- transaction: request_changes wins over everything (back to draft); all
-- required reviewers approved promotes the request to approved.
create or replace function atlas.set_review_verdict(p_merge_request_id uuid, p_verdict review_verdict, p_comment text default null)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_verdict review_verdicts;
  v_any_request_changes boolean;
  v_required_count int;
  v_all_required_approved boolean;
  v_row merge_requests;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'set_review_verdict: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'set_review_verdict: merge request % is not pending (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  select * into v_verdict from review_verdicts where merge_request_id = p_merge_request_id and user_id = auth.uid() for update;
  if v_verdict.id is null then
    raise exception 'set_review_verdict: you are not a reviewer on this request' using errcode = '42501';
  end if;

  update review_verdicts
    set verdict = p_verdict, comment = coalesce(p_comment, comment), updated_at = now()
    where id = v_verdict.id;

  select exists (select 1 from review_verdicts where merge_request_id = p_merge_request_id and verdict = 'request_changes') into v_any_request_changes;
  if v_any_request_changes then
    update merge_requests set status = 'changes_requested', reviewed_by = auth.uid(), reviewed_at = now() where id = p_merge_request_id returning * into v_row;
    update branches set status = 'draft' where id = v_req.branch_id;
    return v_row;
  end if;

  select count(*) into v_required_count from review_verdicts where merge_request_id = p_merge_request_id and required;
  select (v_required_count > 0 and not exists (
    select 1 from review_verdicts where merge_request_id = p_merge_request_id and required and verdict <> 'approve'
  )) into v_all_required_approved;

  if v_all_required_approved then
    update merge_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = p_merge_request_id returning * into v_row;
    update branches set status = 'approved' where id = v_req.branch_id;
    return v_row;
  end if;

  return v_req;
end;
$$;

revoke all on function atlas.set_review_verdict(uuid, review_verdict, text) from public;
grant execute on function atlas.set_review_verdict(uuid, review_verdict, text) to authenticated;

-- The proposer (or an owner/architect) replaces the reviewer set while the
-- request is still pending — re-validates the architect floor, then notifies
-- only newly-added reviewers (never re-notifies the unchanged ones).
create or replace function atlas.set_reviewers(p_merge_request_id uuid, p_reviewers jsonb)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_reviewer jsonb;
  v_user_id uuid;
  v_required boolean;
  v_architect_count int;
  v_min_architects int;
  v_existing_user_ids uuid[];
  v_row merge_requests;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'set_reviewers: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'set_reviewers: merge request % is not pending (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;
  if v_req.requested_by <> auth.uid() and atlas.has_role(v_req.org_id, 'owner', 'architect') is not true then
    raise exception 'set_reviewers: only the proposer or an owner/architect may change reviewers' using errcode = '42501';
  end if;

  select review_min_required_architects into v_min_architects from organisations where id = v_req.org_id;
  v_architect_count := 0;
  for v_reviewer in select * from jsonb_array_elements(p_reviewers) loop
    v_user_id := (v_reviewer ->> 'user_id')::uuid;
    if v_user_id is null then
      raise exception 'set_reviewers: a reviewer is missing a user_id' using errcode = '22023';
    end if;
    if not exists (select 1 from members where org_id = v_req.org_id and user_id = v_user_id) then
      raise exception 'set_reviewers: reviewer % is not a member of this organisation', v_user_id using errcode = '42501';
    end if;
    if exists (select 1 from members where org_id = v_req.org_id and user_id = v_user_id and role = 'architect') then
      v_architect_count := v_architect_count + 1;
    end if;
  end loop;

  if v_architect_count < v_min_architects then
    raise exception 'set_reviewers: the required reviewer set needs at least % architect(s)', v_min_architects using errcode = '42501';
  end if;

  select array_agg(user_id) into v_existing_user_ids from review_verdicts where merge_request_id = p_merge_request_id;
  if v_existing_user_ids is null then
    v_existing_user_ids := '{}';
  end if;

  delete from review_verdicts where merge_request_id = p_merge_request_id;
  for v_reviewer in select * from jsonb_array_elements(p_reviewers) loop
    v_user_id := (v_reviewer ->> 'user_id')::uuid;
    v_required := coalesce((v_reviewer ->> 'required')::boolean, false);
    insert into review_verdicts (id, org_id, model_id, merge_request_id, user_id, required, verdict)
    values (gen_random_uuid(), v_req.org_id, v_req.model_id, p_merge_request_id, v_user_id, v_required, 'pending');
    if not (v_existing_user_ids @> array[v_user_id]) and v_user_id <> auth.uid() then
      insert into notifications (id, org_id, user_id, kind, merge_request_id)
      values (gen_random_uuid(), v_req.org_id, v_user_id, 'review_assigned', p_merge_request_id);
    end if;
  end loop;

  select * into v_row from merge_requests where id = p_merge_request_id;
  return v_row;
end;
$$;

revoke all on function atlas.set_reviewers(uuid, jsonb) from public;
grant execute on function atlas.set_reviewers(uuid, jsonb) to authenticated;
