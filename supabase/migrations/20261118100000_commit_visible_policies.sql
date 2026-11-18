-- Home-page speed: one cheap visibility check instead of a nested policy per row.
--
-- The select policies on elements_head, relationships_head, facts and deltas
-- were `exists (select 1 from commits c where c.id = <table>.commit_id)`.
-- That subquery runs the whole `commits_select` policy for every row read
-- (has_role up to three times, each with its own members lookup), and makes
-- the planner expand that policy into every query on these tables. On the
-- live demo model it measured about 130 ms per Home read (77 ms planning,
-- 56 ms execution for 241 rows), several of them at once per page load.
--
-- `atlas_private.commit_visible(commit)` states the SAME rule as
-- `commits_select`, in one query:
--   - owner, architect, contributor of the commit's organisation: visible;
--   - viewer of the organisation: visible when the branch is main or shared
--     for review (atlas.branch_visible_to_viewer), or the commit is tagged;
--   - anyone: visible when atlas.commit_shared_with_me(commit).
-- Anything else, an unknown commit, or a signed-out caller is NOT visible
-- (written fail-closed: a null comparison coalesces to false).
--
-- Access is unchanged. Insert/update/delete policies are not touched and the
-- `commits` table's own policy is not touched.
--
-- Advisor note: the function lives in `atlas_private`, a schema that is NOT in
-- the API's exposed schemas (supabase/config.toml `schemas`), so it is not an
-- RPC and adds no "signed-in users can execute SECURITY DEFINER function"
-- finding. Policies need EXECUTE and schema USAGE for `authenticated`; nobody
-- else gets either.
--
-- ROLLBACK (forward-only repo; apply as a new migration if ever needed):
--   drop policy elements_head_select on elements_head;
--   create policy elements_head_select on elements_head for select to authenticated
--     using (exists (select 1 from commits c where c.id = elements_head.commit_id));
--   (and the same for relationships_head_select, facts_select, deltas_select)
--   drop function atlas_private.commit_visible(uuid);

create schema if not exists atlas_private;
revoke all on schema atlas_private from public, anon;
grant usage on schema atlas_private to authenticated;

create or replace function atlas_private.commit_visible(p_commit uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select (
      m.role in ('owner', 'architect', 'contributor')
      or (
        m.role = 'viewer'
        and (
          atlas.branch_visible_to_viewer(c.branch_id)
          or exists (select 1 from tags t where t.commit_id = c.id)
        )
      )
      or atlas.commit_shared_with_me(c.id)
    )
    from commits c
    left join members m on m.org_id = c.org_id and m.user_id = (select auth.uid())
    where c.id = p_commit
  ), false);
$$;

revoke all on function atlas_private.commit_visible(uuid) from public, anon;
grant execute on function atlas_private.commit_visible(uuid) to authenticated;

drop policy elements_head_select on elements_head;
create policy elements_head_select on elements_head
  for select to authenticated
  using (atlas_private.commit_visible(commit_id));

drop policy relationships_head_select on relationships_head;
create policy relationships_head_select on relationships_head
  for select to authenticated
  using (atlas_private.commit_visible(commit_id));

drop policy facts_select on facts;
create policy facts_select on facts
  for select to authenticated
  using (atlas_private.commit_visible(commit_id));

drop policy deltas_select on deltas;
create policy deltas_select on deltas
  for select to authenticated
  using (atlas_private.commit_visible(commit_id));
