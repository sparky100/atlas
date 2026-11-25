-- Item 3 of the 25 Nov review (proposals/PROPOSAL-outcome-on-the-need.md):
-- the outcome the business wants, recorded with the need ("Issue a connection
-- quote in two days, not ten, by March 2027").
--
-- * decisions.outcome: one plain sentence, empty until written. Editable while
--   the decision is proposed (atlas.guard_decision_update already refuses any
--   change to an accepted or cancelled decision other than its delivery
--   pointer, so the outcome is locked once an option is chosen).
-- * decision_option_ratings.criterion gains 'outcome' ("Reaches the outcome").
-- * A pack frozen while the decision is open must have an outcome to lead with.
--   A decision chosen before outcomes existed can still be frozen; its pack
--   says plainly that no outcome was recorded.

alter table decisions
  add column outcome text not null default '' check (length(outcome) <= 1000);

comment on column decisions.outcome is 'The outcome the business wants, in one plain sentence: what will be better, for whom, by when. Empty until written; locked once an option is chosen.';

grant update (outcome) on decisions to authenticated;

alter table decision_option_ratings drop constraint decision_option_ratings_criterion_check;
alter table decision_option_ratings add constraint decision_option_ratings_criterion_check
  check (criterion in ('outcome', 'cost', 'effort', 'deliveryRisk', 'timing', 'vendorFit'));

comment on table decision_option_ratings is 'A decision''s own judgement ratings, one row per (decision, option, criterion) - outcome/cost/effort/deliveryRisk/timing/vendorFit, defined in src/contracts/decisionCriteria.ts. The option id is the key; branch_id is retained for branch-backed options and is null for a candidate that has not been worked on. Read-only once the decision is no longer proposed (RLS, not a snapshot).';

-- Same body as 20261119140000_decision_packs.sql, plus the outcome check.
create or replace function atlas.set_decision_pack_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
begin
  -- Serialise two people freezing the same decision at once: versions 1 and 2.
  perform pg_advisory_xact_lock(hashtextextended(new.decision_id::text, 0));
  select * into v_decision from decisions where id = new.decision_id;
  if v_decision.id is null then
    raise exception 'freeze_decision_pack: decision % not found', new.decision_id using errcode = '22023';
  end if;
  if v_decision.status = 'proposed' and btrim(v_decision.outcome) = '' then
    raise exception 'Say what outcome we want before freezing a pack: the pack leads with it.' using errcode = '22023';
  end if;
  new.org_id := v_decision.org_id;
  new.decision_status := v_decision.status;
  new.frozen_by := auth.uid();
  new.frozen_at := now();
  select coalesce(max(version), 0) + 1 into new.version from decision_packs where decision_id = new.decision_id;
  return new;
end;
$$;

revoke all on function atlas.set_decision_pack_fields() from public, anon, authenticated;
