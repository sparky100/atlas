-- Phase B acceptance test (Simon, 2026-11-19): a decision records, when it is
-- made, what evidence would make the people who chose reconsider it.
-- Two plain columns on `decisions`, written only by
-- `atlas.choose_decision_option` (neither is in the column update grant), so
-- they are fixed with the choice, like `decided_by`. No new table, no new policy.
alter table decisions add column reconsider_if text;
alter table decisions add column review_by date;

comment on column decisions.reconsider_if is 'Plain statements of what would make the decision be revisited (e.g. "vendor price rises, support is extended, migration slips past March"). Written once, by atlas.choose_decision_option. Null when none was given.';
comment on column decisions.review_by is 'Optional date by which the decision should be looked at again. Written once, by atlas.choose_decision_option.';

-- Replace the function with the same body plus two optional arguments. The old
-- signature is dropped so there is exactly one callable version.
drop function atlas.choose_decision_option(uuid, uuid, text);

create function atlas.choose_decision_option(p_decision_id uuid, p_chosen_branch_id uuid, p_reasons text, p_reconsider_if text default null, p_review_by date default null)
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
  if p_review_by is not null and p_review_by < current_date then
    raise exception 'choose_decision_option: the review date cannot be in the past' using errcode = '22023';
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
    set status = 'accepted', branch_id = p_chosen_branch_id, decided_by = auth.uid(), decided_at = now(),
        reconsider_if = nullif(btrim(p_reconsider_if), ''), review_by = p_review_by
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

revoke all on function atlas.choose_decision_option(uuid, uuid, text, text, date) from public, anon;
grant execute on function atlas.choose_decision_option(uuid, uuid, text, text, date) to authenticated;
