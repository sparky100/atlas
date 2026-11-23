-- D1 stage 4c: the "Stay as we are" baseline is a candidate, not a branch.
--
-- Stage 3 made every other option a candidate with an optional delivery
-- branch. The baseline still created an empty explore branch up front, which
-- meant "add the baseline" created a change nobody had worked on. This
-- migration records the baseline as a `decision_options` row instead:
--   * `baseline_option_id` is the stable identity the page reads;
--   * the legacy `baseline_branch_id` is filled from the option's branch for
--     older reads, and stays null while the baseline has no branch;
--   * the existing trigger now validates the option belongs to this decision.

alter table decisions add column baseline_option_id uuid references decision_options (id) on delete set null;
create index decisions_baseline_option_idx on decisions (baseline_option_id) where baseline_option_id is not null;

-- Existing baselines already have one candidate row per branch option.
--
-- This is compatibility metadata, not a user edit. The normal update guard
-- refuses every write to a decision that has left `proposed`, which would
-- abort this backfill on the first accepted or rejected decision in a
-- populated database. Backfills are exactly the case the trigger's
-- proposed-only rule does not cover.
alter table decisions disable trigger decisions_guard_update;
update decisions d
set baseline_option_id = o.id
from decision_options o
where o.decision_id = d.id
  and o.branch_id = d.baseline_branch_id
  and d.baseline_option_id is null;
alter table decisions enable trigger decisions_guard_update;

comment on column decisions.baseline_option_id is 'Which of this decision''s candidates is the "Stay as we are" baseline. It may have no delivery branch. Null on decisions made before the baseline existed.';
grant update (baseline_option_id) on decisions to authenticated;

-- Runs as the caller (RLS applies); trigger-only, not callable through the API.
-- A new write names the option. A legacy write that only names a branch is
-- resolved back to that branch's candidate, so both paths keep working until
-- the old column is removed.
create or replace function atlas.check_decision_baseline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_option_id uuid;
  v_branch_id uuid;
begin
  if new.baseline_option_id is not null then
    select o.id, o.branch_id into v_option_id, v_branch_id
    from decision_options o
    where o.id = new.baseline_option_id and o.decision_id = new.id;

    if v_option_id is null then
      raise exception 'check_decision_baseline: the baseline must be one of the decision''s own options' using errcode = '42501';
    end if;
    -- Keep the compatibility pointer truthful while it still exists.
    new.baseline_branch_id := v_branch_id;
  elsif new.baseline_option_id is null
        and new.baseline_option_id is distinct from old.baseline_option_id then
    new.baseline_branch_id := null;
  elsif new.baseline_branch_id is not null
        and new.baseline_branch_id is distinct from old.baseline_branch_id then
    select o.id into new.baseline_option_id
    from decision_options o
    where o.decision_id = new.id and o.branch_id = new.baseline_branch_id
    limit 1;

    if new.baseline_option_id is null then
      raise exception 'check_decision_baseline: the baseline must be one of the decision''s own options' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function atlas.check_decision_baseline() from public, anon, authenticated;
