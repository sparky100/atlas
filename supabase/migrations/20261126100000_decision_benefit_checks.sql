-- Item 3, part 2 (proposals/PROPOSAL-outcome-on-the-need.md, step 8; Simon
-- chose to build it now, 2026-11-25): "Did we get the outcome?"
--
-- Once a decision's chosen option is in the live model, an owner or architect
-- records whether the outcome came: Yes, Partly or Not yet, with a short note
-- and the member who confirmed it (normally the business owner). Each check is
-- a new row; the latest one is the answer shown. A check is never changed or
-- removed, so the history of who said what, and when, is kept.
--
-- Advisor discipline (CLAUDE.md rule 9), following decision_approvals:
-- * no SECURITY DEFINER function, so the "signed-in users can execute
--   SECURITY DEFINER" count is unchanged;
-- * RLS enabled and forced, a select policy for members and an insert policy
--   for owners and architects with auth.uid() in a select;
-- * the one trigger function is an invoker function with all execute revoked;
-- * the foreign key on decision_id is covered by the primary key that leads
--   with it, so there is no extra index to be reported as unused;
-- * org_id and the people columns carry no foreign key (decision_packs
--   precedent). org_id is copied from the decision by the trigger.

create table decision_benefit_checks (
  decision_id uuid not null references decisions (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  -- org_id, recorded_by and recorded_at are set by the trigger, never taken from the caller.
  org_id uuid not null,
  result text not null check (result in ('yes', 'partly', 'not_yet')),
  note text not null default '' check (length(note) <= 1000),
  -- The member who confirmed it, normally the business owner. Checked to be a member of the decision's organisation.
  confirmed_by uuid not null,
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  primary key (decision_id, id)
);

comment on table decision_benefit_checks is 'Item 3: whether a decision''s outcome came, once its chosen option is in the live model. Yes, partly or not yet, with a note and the member who confirmed it. Insert-only (owner/architect); the latest row is the answer; never updated or deleted by application code.';

create function atlas.set_decision_benefit_check_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
  v_option decision_options;
  v_branch_status text;
begin
  -- Read through the caller's own RLS: a user from another organisation sees no decision.
  select * into v_decision from decisions where id = new.decision_id;
  if v_decision.id is null then
    raise exception 'record_decision_benefit: decision % not found', new.decision_id using errcode = '22023';
  end if;
  if v_decision.status <> 'accepted' or v_decision.chosen_option_id is null then
    raise exception 'record_decision_benefit: the decision has no chosen option yet' using errcode = '22023';
  end if;
  if v_decision.chosen_option_id is not distinct from v_decision.baseline_option_id then
    raise exception 'record_decision_benefit: staying as we are has nothing to deliver, so there is no benefit to confirm' using errcode = '22023';
  end if;
  select * into v_option from decision_options where id = v_decision.chosen_option_id;
  select b.status::text into v_branch_status from branches b where b.id = v_option.branch_id;
  if v_branch_status is distinct from 'merged' then
    raise exception 'record_decision_benefit: the chosen option is not in the live model yet' using errcode = '22023';
  end if;
  if not exists (select 1 from members m where m.org_id = v_decision.org_id and m.user_id = new.confirmed_by) then
    raise exception 'record_decision_benefit: the person who confirmed it must be a member of this organisation' using errcode = '22023';
  end if;
  new.org_id := v_decision.org_id;
  new.recorded_by := auth.uid();
  new.recorded_at := now();
  return new;
end;
$$;

revoke all on function atlas.set_decision_benefit_check_fields() from public, anon, authenticated;

create trigger decision_benefit_checks_set_fields
  before insert on decision_benefit_checks
  for each row execute function atlas.set_decision_benefit_check_fields();

alter table decision_benefit_checks enable row level security;
alter table decision_benefit_checks force row level security;

create policy decision_benefit_checks_select on decision_benefit_checks
  for select to authenticated
  using (atlas.is_member(org_id));

create policy decision_benefit_checks_insert on decision_benefit_checks
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') is true and recorded_by = (select auth.uid()));

revoke all on decision_benefit_checks from public, anon, authenticated;
grant select, insert on decision_benefit_checks to authenticated;
-- No update or delete policy or grant: a check is never changed or removed.
