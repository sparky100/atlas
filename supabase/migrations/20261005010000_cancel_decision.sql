-- Cancel a decision (ADR-022 amendment, 2026-10-03): a proposed decision
-- that's no longer needed can be closed without choosing an option.
-- Before this, `proposed → accepted` (atlas.choose_decision_option) was the
-- only way out of `proposed` — so a decision raised by mistake, or made
-- moot, stayed open forever and blocked its project from closing
-- (atlas.set_project_status's P4 refuses while any decision is proposed).
--
-- Stored as the existing `rejected` status (shown as "Cancelled" in the
-- UI) rather than a new status: `rejected` has been in the check list since
-- the decisions migration but nothing ever set it. Never deleted — the
-- decision stays in every log with who cancelled it, when, and why.
--
-- `decided_by`/`decided_at` record who closed it and when, as they do for
-- an accepted decision; `branch_id` stays null, which is exactly what
-- `decisions_decided_consistent` already requires of a non-accepted row.
alter table decisions add column cancel_reason text;

comment on column decisions.cancel_reason is 'Why a proposed decision was cancelled (status rejected, shown as Cancelled). Set only by atlas.cancel_decision; never granted for a plain update.';

-- A reason only on a cancelled decision, never blank — so a plain insert
-- (decisions_insert allows only status 'proposed') can never carry one.
-- One direction only: a row already `rejected` before this migration (none
-- is written by the app, but test setup forces one) keeps a null reason
-- rather than being given an invented one. atlas.cancel_decision always
-- requires a reason, so every cancellation from here on has one.
alter table decisions add constraint decisions_cancel_reason_consistent
  check (cancel_reason is null or (status = 'rejected' and length(btrim(cancel_reason)) > 0));

-- Atomically: checks the decision is proposed and the caller may close it
-- (an org owner/architect, as for choosing, or the decision's own owner);
-- sets status 'rejected' with the reason, decided_by and decided_at; and
-- cancels every option still in draft, the same way choosing cancels the
-- options not chosen. An option already submitted for review is left to
-- its own review — it's a change in its own right by then.
create or replace function atlas.cancel_decision(p_decision_id uuid, p_reason text)
returns decisions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'cancel_decision: say why the decision is being cancelled' using errcode = '22023';
  end if;

  select * into v_decision from decisions where id = p_decision_id for update;
  if v_decision.id is null then
    raise exception 'cancel_decision: decision % not found', p_decision_id using errcode = '22023';
  end if;
  if atlas.has_role(v_decision.org_id, 'owner', 'architect') is not true
     and not (v_decision.owner_id = auth.uid() and atlas.is_member(v_decision.org_id)) then
    raise exception 'cancel_decision: only the decision''s owner, or an org owner or architect, may cancel it' using errcode = '42501';
  end if;
  if v_decision.status <> 'proposed' then
    raise exception 'cancel_decision: decision % is % (only a proposed decision can be cancelled)', p_decision_id, v_decision.status using errcode = '42501';
  end if;

  update decisions
    set status = 'rejected', cancel_reason = btrim(p_reason), decided_by = auth.uid(), decided_at = now()
    where id = p_decision_id;

  update branches
    set status = 'cancelled', cancel_reason = 'Decision cancelled: see decision ' || p_decision_id, cancelled_at = now(), cancelled_by = auth.uid()
    where id in (select linked_id from decision_links where decision_id = p_decision_id and linked_type = 'branch')
      and status = 'draft';

  select * into v_decision from decisions where id = p_decision_id;
  return v_decision;
end;
$$;

revoke all on function atlas.cancel_decision(uuid, text) from public;
grant execute on function atlas.cancel_decision(uuid, text) to authenticated;
