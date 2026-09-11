-- Sprint 7j item 2: organisation settings (rename, member directory, role
-- change, remove member, Delete organisation). `guard_last_owner` and the
-- member RLS this needs already exist in full (20260906071200_tenancy.sql)
-- — nothing new needed there. This migration narrows the two blanket
-- column grants that would otherwise let a client bypass this sprint's own
-- rules (same convention 20260911040000_model_archive.sql already
-- established for `models`), and adds the one genuinely new function:
-- `atlas.delete_organisation`.

-- `organisations_update`'s own RLS is already owner-only; the blanket
-- `grant update on organisations` (20260906071200_tenancy.sql) lets that
-- owner update any column, including `created_by`/`created_at` — neither
-- of which should ever change after creation.
revoke update on organisations from authenticated;
grant update (name, slug) on organisations to authenticated;

-- Same reasoning for `members`: `members_update`'s RLS is owner-only, but
-- the only column a settings screen ever legitimately changes is `role`
-- (`org_id`/`user_id` identify the row; `invited_by`/`joined_at` are
-- historical facts, not settings).
revoke update on members from authenticated;
grant update (role) on members to authenticated;

-- `organisations_delete`'s RLS (owner-only) plus `models.org_id`'s own FK
-- (no cascade — confirmed in 20260911040000_model_archive.sql's own
-- research) already make "delete an organisation with models in it" fail
-- outright. This wraps that in the prompt's own "only when no models"
-- precondition with a friendly, structured outcome instead of a raw FK
-- violation, and is the one place `organisations`' delete grant now goes
-- through — same "route destructive actions through one function, not a
-- raw client delete anyone can also reach" convention as `atlas.delete_model`.
-- Nothing beyond `members` needs explicit cleanup: every other org-scoped
-- table requires a `model_id`, and this only ever runs when none exist —
-- `members` itself already cascades from `organisations` (`on delete
-- cascade`, 20260906071200_tenancy.sql).
revoke delete on organisations from authenticated;

create or replace function atlas.delete_organisation(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exists boolean;
  v_model_count int;
begin
  select exists (select 1 from organisations where id = p_org_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('status', 'not_found');
  end if;
  if atlas.has_role(p_org_id, 'owner') is not true then
    raise exception 'delete_organisation: only an owner may delete an organisation' using errcode = '42501';
  end if;

  select count(*) into v_model_count from models where org_id = p_org_id;
  if v_model_count > 0 then
    return jsonb_build_object('status', 'has_models', 'count', v_model_count);
  end if;

  delete from organisations where id = p_org_id;
  return jsonb_build_object('status', 'deleted');
end;
$$;

revoke all on function atlas.delete_organisation from public;
grant execute on function atlas.delete_organisation to authenticated;
