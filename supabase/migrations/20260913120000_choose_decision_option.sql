-- Prompt pack F3 PR5 ("options, comparison, and choosing"):
-- `atlas.choose_decision_option` — the one RPC that actually closes a
-- decision. Resolved architecture decision 2 (docs/ADR-022-decisions-schema.md):
-- no new privilege model, no new merge mechanism — this only touches
-- `decisions`/`decision_arguments`/`branches` directly; the chosen
-- branch's own review (once it's flipped to `propose` intent here) goes
-- through F0's ordinary review path unchanged.
--
-- Atomically: validates the chosen branch is a `branch`-typed link on this
-- decision, `intent='explore'`, `status='draft'`; sets `decisions.status
-- ='accepted'`, `branch_id`, `decided_by`, `decided_at`; inserts the one
-- `decision_arguments` reasons row (this function is the *only* writer —
-- confirmed by PR4's migration leaving no open insert grant on that
-- table); flips the chosen branch's `intent` to `'propose'` (legal per
-- F0's own "editable while Draft" rule — `atlas.guard_branch_intent_update`
-- only refuses once `status <> 'draft'`, and the branch is still `draft`
-- here); cancels every other `branch`-linked option still in `draft`,
-- reusing `branches.cancel_reason`/`cancelled_at`/`cancelled_by`
-- (`atlas.cancel_change`'s own columns, `20260912111000_cancel_change_function.sql`)
-- for exactly the purpose their own doc comments already generalise to.
create or replace function atlas.choose_decision_option(p_decision_id uuid, p_chosen_branch_id uuid, p_reasons text)
returns decisions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
  v_branch branches;
begin
  if p_reasons is null or btrim(p_reasons) = '' then
    raise exception 'choose_decision_option: reasons are required' using errcode = '22023';
  end if;

  select * into v_decision from decisions where id = p_decision_id for update;
  if v_decision.id is null then
    raise exception 'choose_decision_option: decision % not found', p_decision_id using errcode = '22023';
  end if;
  if atlas.has_role(v_decision.org_id, 'owner', 'architect') is not true then
    raise exception 'choose_decision_option: only owners and architects may choose an option' using errcode = '42501';
  end if;
  if v_decision.status <> 'proposed' then
    raise exception 'choose_decision_option: decision % is % (must be proposed)', p_decision_id, v_decision.status using errcode = '42501';
  end if;

  if not exists (select 1 from decision_links where decision_id = p_decision_id and linked_type = 'branch' and linked_id = p_chosen_branch_id) then
    raise exception 'choose_decision_option: branch % is not a linked option on decision %', p_chosen_branch_id, p_decision_id using errcode = '42501';
  end if;

  select * into v_branch from branches where id = p_chosen_branch_id for update;
  if v_branch.id is null then
    raise exception 'choose_decision_option: branch % not found', p_chosen_branch_id using errcode = '22023';
  end if;
  if v_branch.kind <> 'change' or v_branch.intent <> 'explore' or v_branch.status <> 'draft' then
    raise exception 'choose_decision_option: branch % must be a draft, explore-intent change branch', p_chosen_branch_id using errcode = '42501';
  end if;

  update decisions
    set status = 'accepted', branch_id = p_chosen_branch_id, decided_by = auth.uid(), decided_at = now()
    where id = p_decision_id;

  insert into decision_arguments (id, decision_id, stance, body, author, created_at)
    values (gen_random_uuid(), p_decision_id, 'for', p_reasons, auth.uid(), now());

  update branches set intent = 'propose' where id = p_chosen_branch_id;

  update branches
    set status = 'cancelled', cancel_reason = 'Not chosen: see decision ' || p_decision_id, cancelled_at = now(), cancelled_by = auth.uid()
    where id in (select linked_id from decision_links where decision_id = p_decision_id and linked_type = 'branch' and linked_id <> p_chosen_branch_id)
      and status = 'draft';

  select * into v_decision from decisions where id = p_decision_id;
  return v_decision;
end;
$$;

revoke all on function atlas.choose_decision_option(uuid, uuid, text) from public;
grant execute on function atlas.choose_decision_option(uuid, uuid, text) to authenticated;
