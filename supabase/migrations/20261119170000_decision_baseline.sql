-- Phase B (Simon approved 2026-11-19): every decision has a "Stay as we are"
-- baseline option. It is DESCRIBED, NOT SCORED: two plain-text answers (the
-- operational risk of staying as we are, and why we can't or won't change)
-- that the other options are compared against.
--
-- The baseline is a real, empty explore-intent change branch linked to the
-- decision like any other option (a decided decision needs a branch_id, see
-- decisions_decided_consistent), so choosing it is just choosing that branch.
-- `baseline_branch_id` records which of the decision's options is the baseline.
--
-- No new table, no new function that callers can execute, no change to who can
-- see or change data. The three columns follow the existing rule: plain-editable
-- by owner/architect/contributor only while the decision is proposed (the
-- grant list plus atlas.guard_decision_update), RLS unchanged.
alter table decisions add column stay_risk text not null default '';
alter table decisions add column stay_reason text not null default '';
alter table decisions add column baseline_branch_id uuid references branches (id);

comment on column decisions.stay_risk is 'The operational risk of staying as we are (the baseline option). Plain text; editable while the decision is proposed.';
comment on column decisions.stay_reason is 'Why we cannot or will not change (the baseline option). Plain text; editable while the decision is proposed.';
comment on column decisions.baseline_branch_id is 'Which of this decision''s option branches is the "Stay as we are" baseline. It must be linked to the decision as an option. Null on decisions made before the baseline existed.';

-- Covers the foreign key (CLAUDE.md rule 9: no new unindexed-FK advisor finding).
create index decisions_baseline_branch_idx on decisions (baseline_branch_id) where baseline_branch_id is not null;

grant update (stay_risk, stay_reason, baseline_branch_id) on decisions to authenticated;

-- The baseline must be one of this decision's own options, so a caller cannot
-- point it at any other branch. Runs as the caller (RLS applies); trigger-only,
-- not callable through the API.
create function atlas.check_decision_baseline()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.baseline_branch_id is not null
     and new.baseline_branch_id is distinct from old.baseline_branch_id
     and not exists (
       select 1 from decision_links l
       where l.decision_id = new.id and l.linked_type = 'branch' and l.linked_id = new.baseline_branch_id
     ) then
    raise exception 'check_decision_baseline: the baseline must be one of the decision''s own options' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function atlas.check_decision_baseline() from public, anon, authenticated;

create trigger decisions_check_baseline
  before update on decisions
  for each row execute function atlas.check_decision_baseline();
