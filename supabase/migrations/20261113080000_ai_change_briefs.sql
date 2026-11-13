alter table capture_jobs drop constraint capture_jobs_input_kind_check;
alter table capture_jobs add constraint capture_jobs_input_kind_check
  check (input_kind in ('spreadsheet', 'pdf', 'text', 'change_brief'));

alter table capture_jobs add constraint capture_jobs_change_brief_no_reimport
  check (input_kind <> 'change_brief' or reimport_of_job_id is null);

-- Promotion updates the target under a row lock in apply_capture_decisions.
-- Rejecting here rolls back the entire promotion, including its commit.
create function atlas.enforce_change_brief_target()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.input_kind = 'change_brief'
    and old.target_branch_id is not null and new.target_branch_id is distinct from old.target_branch_id
  then
    raise exception 'This AI draft already has a target Change.' using errcode = '42501';
  end if;

  if new.input_kind = 'change_brief' and new.target_branch_id is not null
    and not exists (
      select 1 from branches
      where id = new.target_branch_id and model_id = new.model_id
        and org_id = new.org_id and kind = 'change' and status = 'draft' and intent = 'propose'
    )
  then
    raise exception 'AI draft edits must be applied to a draft Propose change.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger capture_jobs_change_brief_target
  before insert or update of target_branch_id on capture_jobs
  for each row execute function atlas.enforce_change_brief_target();

revoke all on function atlas.enforce_change_brief_target() from public;

create index capture_jobs_change_brief_target_idx on capture_jobs (target_branch_id)
  where input_kind = 'change_brief';

create function atlas.preserve_change_brief_intent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.intent = 'propose' and new.intent is distinct from old.intent
    and exists (
      select 1 from capture_jobs
      where target_branch_id = old.id and input_kind = 'change_brief'
    )
  then
    raise exception 'A Change containing AI draft edits must keep its Propose intent.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger branches_preserve_change_brief_intent
  before update of intent on branches
  for each row execute function atlas.preserve_change_brief_intent();

revoke all on function atlas.preserve_change_brief_intent() from public;
