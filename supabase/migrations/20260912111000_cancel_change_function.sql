-- S1 item 4: "Cancel a change: proposer or owner/architect, Draft or
-- Proposed; status -> cancelled; ... listed under a collapsed 'Cancelled'
-- section with a reason." `branches` has no existing free-text "reason"
-- column the way `merge_requests.review_notes` does for reject/request-
-- changes (`atlas.reject_merge_request`, 20260906161000_merge_review_queue.sql)
-- — a cancel can happen straight from `draft`, with no `merge_requests`
-- row ever created to attach a reason to, so the reason lives on
-- `branches` itself.
alter table branches
  add column cancel_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users (id);

comment on column branches.cancel_reason is 'Change branches only, set by atlas.cancel_change (S1 item 4) — the proposer or owner/architect''s own stated reason.';
comment on column branches.cancelled_at is 'Change branches only, set by atlas.cancel_change.';
comment on column branches.cancelled_by is 'Change branches only, set by atlas.cancel_change — the acting user, not necessarily the branch''s own created_by.';

-- Mirrors atlas.reject_merge_request's own role/status-check shape
-- (20260906161000_merge_review_queue.sql), with two differences: the role
-- check is "proposer OR owner/architect" (SPEC's own wording, not
-- owner/architect alone), and a branch that was already submitted for
-- review (Proposed) has an open merge_requests row that must close
-- alongside it — reusing the existing terminal 'rejected' value there
-- (not a new merge_request_status value: the branch's own 'cancelled'
-- status is the true signal for the UI; the request only needs to stop
-- being "open" so it drops out of the review queue, the same closure
-- reject already models for "this request is no longer actionable").
create or replace function atlas.cancel_change(p_branch_id uuid, p_reason text)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'cancel_change: a reason is required' using errcode = '22023';
  end if;

  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'cancel_change: branch % not found', p_branch_id using errcode = '22023';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'cancel_change: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;
  if v_branch.status not in ('draft', 'proposed') then
    raise exception 'cancel_change: branch % is % (must be draft or proposed)', p_branch_id, v_branch.status using errcode = '42501';
  end if;
  if not (v_branch.created_by = auth.uid() or atlas.has_role(v_branch.org_id, 'owner', 'architect') is true) then
    raise exception 'cancel_change: only the proposer or an owner/architect may cancel' using errcode = '42501';
  end if;

  update branches
    set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now(), cancelled_by = auth.uid()
    where id = p_branch_id;

  update merge_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where branch_id = p_branch_id and status in ('pending', 'changes_requested', 'approved');

  select * into v_branch from branches where id = p_branch_id;
  return v_branch;
end;
$$;

revoke all on function atlas.cancel_change(uuid, text) from public;
grant execute on function atlas.cancel_change(uuid, text) to authenticated;
