-- Fix (item-7 re-triage, Group 1): decisions_update's own `using` clause
-- included `status = 'proposed'`, which made a closed/chosen decision's row
-- invisible to the scan the instant its own status moved past 'proposed' —
-- so the BEFORE UPDATE guard trigger (atlas.guard_decision_update, meant to
-- raise a real, explicit exception once a decision leaves 'proposed') never
-- even got a row to fire on. RLS silently excluded the row first, so a
-- caller's plain update matched zero rows and returned success with no
-- error, instead of the guard trigger's own informative rejection.
--
-- `status = 'proposed'` moves to `with check` only, which *is* evaluated
-- per-row after the trigger runs — a plain update by a member/owner/
-- architect can still see and attempt to touch the row regardless of its
-- current status, but the guard trigger now actually gets a chance to run
-- first and raise its own exception once status has moved past 'proposed';
-- `with check` remains a second line of defence against any write that
-- somehow reaches this table without going through the trigger.

drop policy decisions_update on decisions;

create policy decisions_update on decisions
  for update to authenticated
  using (
    atlas.is_member(org_id)
    and (created_by = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  )
  with check (
    atlas.is_member(org_id)
    and status = 'proposed'
    and (created_by = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  );
