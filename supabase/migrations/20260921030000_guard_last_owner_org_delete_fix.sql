-- Fix (item-7 re-triage, Group 2): atlas.guard_last_owner fires on every
-- `members` row delete, including the ones ON DELETE CASCADE performs when
-- the organisation itself is deleted (atlas.delete_organisation does a
-- plain `delete from organisations`, and `members.org_id references
-- organisations(id) on delete cascade` triggers a real per-row DELETE
-- against members). The trigger had no way to tell "the org itself is
-- going away" apart from "a member is being removed from a still-live
-- org" — when the cascade reached the org's last owner row,
-- remaining_owners was (correctly, in isolation) 0, and the guard raised
-- its exception, aborting the whole delete_organisation call for every
-- normal, single-owner org.
--
-- Skip the guard when the parent organisation row is already gone/going in
-- this same transaction — the only case this guard is meant to protect is
-- "a member leaves a still-live org," not "the org itself is being
-- deleted."

create or replace function atlas.guard_last_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  remaining_owners int;
begin
  if tg_op = 'DELETE' then
    if old.role <> 'owner' then
      return old;
    end if;
    if not exists (select 1 from organisations where id = old.org_id) then
      return old;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.role <> 'owner' or new.role = 'owner' then
      return new;
    end if;
  end if;

  select count(*) into remaining_owners
  from members
  where org_id = old.org_id and role = 'owner' and user_id <> old.user_id;

  if remaining_owners = 0 then
    raise exception 'an organisation must always have at least one owner' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
