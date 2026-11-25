-- Item 5 of the 25 Nov review (proposals/PROPOSAL-truthful-option-states.md,
-- Simon chose option A on 2026-11-25): choosing an option records the choice
-- only. No change branch is made until someone presses "Start delivery"
-- (atlas.work_on_decision_option on the chosen option).
--
--   * decisions.chosen_option_id is the authority for "which option was
--     chosen". It is backfilled from branch_id (every accepted decision on the
--     live project has an option row for its branch, checked 2026-11-25).
--   * decisions.branch_id stays, and now means "the chosen option's delivery
--     change". It is null while delivery has not started.
--   * atlas.choose_decision_option takes the option id. The old signature is
--     dropped, so there is still exactly one callable version and the advisor
--     count is unchanged.
--   * atlas.work_on_decision_option also starts delivery on the chosen option
--     of an accepted decision, and records that branch on the decision. That
--     is the one write the decision guard now allows after the choice.
--
-- Who may do what is unchanged: owners and architects choose; owners,
-- architects and contributors work on an option or start delivery.

alter table public.decisions add column chosen_option_id uuid references public.decision_options (id);
create index decisions_chosen_option_idx on public.decisions (chosen_option_id) where chosen_option_id is not null;
comment on column public.decisions.chosen_option_id is 'The option this decision chose. Written once, by atlas.choose_decision_option. branch_id is that option''s delivery change, and is null until delivery starts.';

-- Compatibility backfill, not a user edit (same reason as 20261123140000).
-- An accepted decision from before options were rows (none on the live
-- project) gets its option row from the chosen branch, so nothing is lost and
-- the new check below holds on any database this replays against.
insert into public.decision_options (decision_id, branch_id, title, position, created_by, updated_by)
select d.id, d.branch_id, coalesce(nullif(btrim(b.title), ''), b.name), 0, d.decided_by, d.decided_by
from public.decisions d
join public.branches b on b.id = d.branch_id
where d.status = 'accepted'
  and not exists (select 1 from public.decision_options o where o.decision_id = d.id and o.branch_id = d.branch_id);

alter table public.decisions disable trigger decisions_guard_update;
update public.decisions d
set chosen_option_id = o.id
from public.decision_options o
where d.status = 'accepted' and d.chosen_option_id is null
  and o.decision_id = d.id and o.branch_id = d.branch_id;
alter table public.decisions enable trigger decisions_guard_update;

-- An accepted decision names its option; its branch may not exist yet.
alter table public.decisions drop constraint decisions_decided_consistent;
alter table public.decisions add constraint decisions_decided_consistent
  check ((status = 'accepted') = (decided_by is not null and decided_at is not null and chosen_option_id is not null));

-- The guard: a decision's own fields are editable only while proposed. The one
-- exception is starting delivery on an accepted decision: branch_id goes from
-- null to the chosen option's own branch, and nothing else changes. Plain
-- clients still cannot name branch_id at all (it is not in the update grant);
-- only atlas.work_on_decision_option writes it.
create or replace function atlas.guard_decision_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_probe decisions;
begin
  if old.status = 'proposed' then
    return new;
  end if;
  if old.status = 'accepted' and old.branch_id is null and new.branch_id is not null then
    v_probe := new;
    v_probe.branch_id := null;
    if v_probe is not distinct from old
       and exists (select 1 from decision_options o where o.id = old.chosen_option_id and o.branch_id = new.branch_id) then
      return new;
    end if;
  end if;
  raise exception 'guard_decision_update: a decision''s own fields are only editable while proposed' using errcode = '42501';
end;
$$;

drop function atlas.choose_decision_option(uuid, uuid, text, text, date);

create function atlas.choose_decision_option(p_decision_id uuid, p_option_id uuid, p_reasons text, p_reconsider_if text default null, p_review_by date default null)
returns decisions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision decisions;
  v_option decision_options;
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

  select * into v_option from decision_options where id = p_option_id and decision_id = p_decision_id for update;
  if v_option.id is null then
    raise exception 'choose_decision_option: option % is not one of decision %''s options', p_option_id, p_decision_id using errcode = '42501';
  end if;

  -- An option someone already worked on keeps its change, which becomes the
  -- delivery change. A candidate with no change stays that way.
  if v_option.branch_id is not null then
    select * into v_branch from branches where id = v_option.branch_id for update;
    if v_branch.id is null then
      raise exception 'choose_decision_option: option % points at missing branch %', p_option_id, v_option.branch_id using errcode = '22023';
    end if;
    if v_branch.kind <> 'change' or v_branch.intent <> 'explore' or v_branch.status <> 'draft' then
      raise exception 'choose_decision_option: the option''s change must be a draft, explore-intent change' using errcode = '42501';
    end if;
    update branches set intent = 'propose' where id = v_branch.id;
  end if;

  update decisions
    set status = 'accepted', chosen_option_id = v_option.id, branch_id = v_option.branch_id,
        decided_by = auth.uid(), decided_at = now(),
        reconsider_if = nullif(btrim(p_reconsider_if), ''), review_by = p_review_by
    where id = p_decision_id;

  insert into decision_arguments (id, decision_id, stance, body, author, created_at)
    values (gen_random_uuid(), p_decision_id, 'for', p_reasons, auth.uid(), now());

  update branches
    set status = 'cancelled', cancel_reason = 'Not chosen: see decision ' || p_decision_id, cancelled_at = now(), cancelled_by = auth.uid()
    where id in (select linked_id from decision_links where decision_id = p_decision_id and linked_type = 'branch'
                   and linked_id is distinct from v_option.branch_id)
      and status = 'draft';

  select * into v_decision from decisions where id = p_decision_id;
  return v_decision;
end;
$$;

revoke all on function atlas.choose_decision_option(uuid, uuid, text, text, date) from public, anon;
grant execute on function atlas.choose_decision_option(uuid, uuid, text, text, date) to authenticated;
comment on function atlas.choose_decision_option(uuid, uuid, text, text, date) is
  'Owner or architect chooses one option of a proposed decision, with reasons. Records the option; makes no change. The option''s existing change, if any, becomes the delivery change.';

-- Work on an option (proposed decision) or start delivery (the chosen option
-- of an accepted decision). Same signature, so grants are kept.
create or replace function atlas.work_on_decision_option(p_option_id uuid)
returns branches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_option decision_options;
  v_decision decisions;
  v_main branches;
  v_branch branches;
  v_branch_id uuid := gen_random_uuid();
  v_delivery boolean;
begin
  select * into v_option from decision_options where id = p_option_id for update;
  if v_option.id is null then
    raise exception 'work_on_decision_option: option % not found', p_option_id using errcode = '22023';
  end if;

  select * into v_decision from decisions where id = v_option.decision_id for update;
  if v_decision.id is null then
    raise exception 'work_on_decision_option: decision % not found', v_option.decision_id using errcode = '22023';
  end if;
  if atlas.has_role(v_decision.org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'work_on_decision_option: only owners, architects and contributors may work on an option' using errcode = '42501';
  end if;

  v_delivery := v_decision.status = 'accepted' and v_decision.chosen_option_id = v_option.id;
  if v_decision.status <> 'proposed' and v_delivery is not true then
    raise exception 'work_on_decision_option: decision % is %, and this is not its chosen option', v_decision.id, v_decision.status using errcode = '42501';
  end if;
  if v_delivery and v_option.id is not distinct from v_decision.baseline_option_id then
    raise exception 'work_on_decision_option: staying as we are has nothing to deliver' using errcode = '22023';
  end if;

  -- A branch that is already attached still needs its link if an earlier
  -- interrupted client write left one behind. The link insert is idempotent.
  if v_option.branch_id is not null then
    select * into v_branch from branches where id = v_option.branch_id;
    if v_branch.id is null then
      raise exception 'work_on_decision_option: option % points at missing branch %', p_option_id, v_option.branch_id using errcode = '22023';
    end if;
    insert into decision_links (decision_id, linked_type, linked_id, created_by)
      values (v_decision.id, 'branch', v_branch.id, auth.uid())
      on conflict do nothing;
    if v_delivery and v_decision.branch_id is null then
      update decisions set branch_id = v_branch.id where id = v_decision.id;
    end if;
    return v_branch;
  end if;

  select * into v_main from branches
    where model_id = v_decision.model_id and kind = 'main'
    limit 1;
  if v_main.id is null or v_main.head_commit_id is null then
    raise exception 'work_on_decision_option: this model has no main commit to base an option on' using errcode = '22023';
  end if;

  insert into branches
    (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id,
     title, description, created_by, intent, project_id)
  values
    (v_branch_id, v_decision.org_id, v_decision.model_id,
     'option-' || left(replace(v_branch_id::text, '-', ''), 8),
     'change', 'draft', v_main.head_commit_id, v_main.head_commit_id,
     v_option.title, nullif(v_option.summary, ''), auth.uid(),
     case when v_delivery then 'propose' else 'explore' end,
     v_decision.project_id)
  returning * into v_branch;

  update decision_options
    set branch_id = v_branch.id, updated_by = auth.uid(), updated_at = now()
    where id = v_option.id;

  insert into decision_links (decision_id, linked_type, linked_id, created_by)
    values (v_decision.id, 'branch', v_branch.id, auth.uid())
    on conflict do nothing;

  if v_delivery then
    update decisions set branch_id = v_branch.id where id = v_decision.id;
  end if;

  return v_branch;
end;
$$;

revoke all on function atlas.work_on_decision_option(uuid) from public, anon;
grant execute on function atlas.work_on_decision_option(uuid) to authenticated;
