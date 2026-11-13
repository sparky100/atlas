-- Security fix: atlas.has_role returned NULL, not false, for someone who is not
-- a member of the organisation (member_role is NULL, and NULL = any(...) is
-- NULL). Row-level security treats NULL as "no", but a guard written
-- `if not atlas.has_role(...) then raise exception` does not: in PL/pgSQL,
-- `IF NOT NULL` is not true, so the exception is skipped and a non-member
-- passes the check. The older functions are written `has_role(...) is not
-- true` and are safe; these newer ones used `not` and were not:
--
--   atlas.set_review_period                      (20261112020000)
--   atlas.create_api_key, atlas.revoke_api_key   (20261112030000)
--   atlas.set_entra_tenant, atlas.clear_entra_tenant (20261113030000)
--   two guards in the duplicate-check functions  (20260924020000)
--
-- Reproduced on a real database: an owner of one organisation could create
-- an API key for another. The fix is in the helper, so every present and
-- future `not atlas.has_role(...)` guard is correct: a non-member is false.
-- Nothing in the schema negates has_role in a policy (checked), so RLS
-- behaviour is unchanged: false and NULL both deny.

create or replace function atlas.has_role(p_org uuid, variadic p_roles member_role[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(atlas.member_role(p_org) = any (p_roles), false);
$$;
