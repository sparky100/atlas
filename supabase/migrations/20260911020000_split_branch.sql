-- Sprint C2 (Prompt 7b) step 2, ADR-006 amendment: partial delivery is a
-- split branch, not a partial merge commit. `atlas.split_branch` is the
-- one new function this needs — everything downstream of "the split
-- branch now exists, approved, with one commit" reuses the ordinary
-- all-or-nothing `atlas.merge_branch` from 20260906161000_merge_review_queue.sql
-- unchanged (ADR-006 amendment rule 1's own wording: "which is then
-- merged whole, in the same review action, using the ordinary all-or-
-- nothing merge of ADR-006").
--
-- The split's own fresh deltas (`p_deltas`) are computed client-side by
-- the engine (`src/engine/splitClosure.ts`'s `computeSplitClosure` +
-- `buildSplitDeltas`) — this function only persists them, the same
-- division of labour `atlas.commit_deltas`/`atlas.merge_branch` already
-- draw between "the engine decides what the deltas are" and "the RPC
-- writes them atomically."
--
-- Reuses `atlas.commit_deltas` internally for the split's own commit
-- (rather than a second, parallel insert) by creating the new branch as
-- `draft` first — the same status `atlas.guard_branch_head_advance`'s own
-- S-18 check requires for a head to advance at all — then flipping it to
-- `approved` once that commit exists, exactly mirroring what
-- `atlas.approve_merge_request` already does to an ordinary branch.

create or replace function atlas.split_branch(
  p_new_branch_id uuid,
  p_branch_id uuid,
  p_new_branch_name text,
  p_new_branch_title text,
  p_commit_id uuid,
  p_commit_title text,
  p_deltas jsonb,
  p_merge_request_id uuid,
  p_classification jsonb default '{}'::jsonb
)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch branches;
  v_main branches;
  v_new_branch branches;
begin
  select * into v_branch from branches where id = p_branch_id for update;
  if v_branch.id is null then
    raise exception 'split_branch: branch % not found', p_branch_id using errcode = '22023';
  end if;
  if atlas.has_role(v_branch.org_id, 'owner', 'architect') is not true then
    raise exception 'split_branch: only owners and architects may split a branch' using errcode = '42501';
  end if;
  if v_branch.kind <> 'change' then
    raise exception 'split_branch: branch % is not a change branch', p_branch_id using errcode = '42501';
  end if;

  select * into v_main from branches where model_id = v_branch.model_id and kind = 'main';
  if v_main.id is null then
    raise exception 'split_branch: model % has no main branch', v_branch.model_id using errcode = '22023';
  end if;
  -- The same precondition `atlas.approve_merge_request` already requires
  -- of the *original* branch before a reviewer can act on it at all
  -- (ADR-006 §7.1's "mergeBase(B) == main.head") — the closure's own
  -- fresh deltas were computed against main's current head, client-side;
  -- this re-derives that main hasn't moved since, the same way every
  -- other commit-writing RPC re-checks its own staleness precondition
  -- inside the transaction rather than trusting the client's claim.
  if not atlas.branch_reaches_commit(p_branch_id, v_main.head_commit_id) then
    raise exception 'split_branch: REFRESH_REQUIRED — branch has not incorporated main''s current head' using errcode = '55000';
  end if;

  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, split_from, target_date, title, created_by)
  values (p_new_branch_id, v_branch.org_id, v_branch.model_id, p_new_branch_name, 'change', 'draft', v_main.head_commit_id, v_main.head_commit_id, p_branch_id, v_branch.target_date, p_new_branch_title, auth.uid())
  returning * into v_new_branch;

  perform atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_branch.model_id,
    p_branch_id => p_new_branch_id,
    p_base_commit_id => v_main.head_commit_id,
    p_kind => 'manual',
    p_title => p_commit_title,
    p_deltas => p_deltas
  );

  -- Approved directly, never `draft`/`proposed` (ADR-006 amendment rule
  -- 1: created with `status = 'approved'`) — a split is, by construction,
  -- exactly the subset of an already-reviewed branch the reviewer just
  -- chose to accept; there is nothing left for a second review pass to
  -- decide.
  update branches set status = 'approved' where id = p_new_branch_id;

  insert into merge_requests (id, org_id, model_id, branch_id, requested_head_commit_id, main_head_commit_id, status, requested_by, reviewed_by, reviewed_at, classification)
  values (p_merge_request_id, v_branch.org_id, v_branch.model_id, p_new_branch_id, p_commit_id, v_main.head_commit_id, 'approved', auth.uid(), auth.uid(), now(), coalesce(p_classification, '{}'::jsonb));

  select * into v_new_branch from branches where id = p_new_branch_id;
  return v_new_branch;
end;
$$;

revoke all on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) from public;
grant execute on function atlas.split_branch(uuid, uuid, text, text, uuid, text, jsonb, uuid, jsonb) to authenticated;
