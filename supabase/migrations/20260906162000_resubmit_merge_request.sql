-- Sprint C1 step 7: the review queue needs one more transition step 2's
-- five functions didn't cover — moving an already-open request (currently
-- `changes_requested`, its branch back to `draft`) back to `pending` once
-- the requester has refreshed the branch and/or resolved its conflicts,
-- with an updated cached classification.
--
-- atlas.submit_merge_request only ever *inserts* a new merge_requests row
-- (SPEC §7.4's classification is "cached at request and at each refresh" —
-- the "at each refresh" half needs an update path on the *same* row, not
-- a second one: the partial unique index on (branch_id) where status in
-- ('pending','changes_requested','approved') means a second insert while
-- the existing row is still `changes_requested` would violate it anyway).

create or replace function atlas.resubmit_merge_request(p_merge_request_id uuid, p_classification jsonb default '{}'::jsonb)
returns merge_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_branch branches;
  v_main branches;
  v_row merge_requests;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'resubmit_merge_request: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;

  select * into v_branch from branches where id = v_req.branch_id;
  if atlas.has_role(v_req.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'resubmit_merge_request: insufficient role in this organisation' using errcode = '42501';
  end if;
  if v_req.status <> 'changes_requested' then
    raise exception 'resubmit_merge_request: merge request % is not changes_requested (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;
  if v_branch.status <> 'draft' then
    raise exception 'resubmit_merge_request: branch % is not draft (status %)', v_req.branch_id, v_branch.status using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_req.model_id and kind = 'main';

  update merge_requests
    set status = 'pending', requested_head_commit_id = v_branch.head_commit_id, main_head_commit_id = v_main.head_commit_id, classification = coalesce(p_classification, '{}'::jsonb)
    where id = p_merge_request_id
    returning * into v_row;

  update branches set status = 'proposed' where id = v_req.branch_id;

  return v_row;
end;
$$;

revoke all on function atlas.resubmit_merge_request from public;
grant execute on function atlas.resubmit_merge_request to authenticated;
