-- Sprint C1-H item 1: src/db/*.ts calls every atlas.* RPC unqualified
-- (`supabase.rpc('commit_deltas', ...)`, `supabase.rpc('seed_from_map', ...)`,
-- etc. — never `.schema('atlas')`), which only ever reaches a function
-- PostgREST exposes directly. supabase/config.toml's `[api] schemas` never
-- listed `atlas`, so none of these RPCs — including atlas.commit_deltas,
-- "the one place a commit is ever written from" — were ever actually
-- reachable against a real Supabase instance. Confirmed via the first real
-- RPC call this codebase ever made in CI: atlas.seed_from_map failed with
-- "Could not find the function public.seed_from_map(...) in the schema
-- cache." Fixed by adding "atlas" to config.toml's `[api] schemas` (that
-- file's own change, not a migration).
--
-- Exposing the whole schema, though, also exposes every OTHER function in
-- it as a potential RPC endpoint — not just the ones this repo already
-- deliberately revoked-from-public and re-granted one at a time
-- (commit_deltas, seed_from_map, submit_merge_request, and the rest of the
-- review-queue functions). Four security-definer helpers never got that
-- treatment, because they were only ever meant to be called from inside an
-- RLS policy expression, where Postgres still requires the evaluating role
-- to hold EXECUTE — so they've been running on Postgres's default
-- (unrevoked) PUBLIC execute grant since they were created:
-- atlas.is_member, atlas.has_role, atlas.member_role,
-- atlas.branch_visible_to_viewer. With `atlas` unexposed this was
-- harmless; exposed, `anon` could call any of them directly. Narrowed to
-- `authenticated`, matching this repo's policies (they all evaluate
-- `auth.uid()` against the caller's own membership, and only revoked from
-- `authenticated` themselves, not from a real caller's own membership) —
-- an authenticated caller invoking one directly only ever learns something
-- about their own membership they could already establish indirectly by
-- reading `members`/`organisations` through RLS, so this is a real
-- narrowing (blocks anonymous probing) without breaking the policies that
-- depend on `authenticated` holding execute.
--
-- Every other atlas.* function is either already revoked-from-public with
-- its own explicit grant, or returns `trigger` (guard_*, on_*,
-- touch_updated_at) — PostgREST does not expose trigger functions as API
-- endpoints regardless of their execute grants, so those needed no change.

revoke all on function atlas.is_member(uuid) from public;
grant execute on function atlas.is_member(uuid) to authenticated;

revoke all on function atlas.has_role(uuid, member_role[]) from public;
grant execute on function atlas.has_role(uuid, member_role[]) to authenticated;

revoke all on function atlas.member_role(uuid) from public;
grant execute on function atlas.member_role(uuid) to authenticated;

revoke all on function atlas.branch_visible_to_viewer(uuid) from public;
grant execute on function atlas.branch_visible_to_viewer(uuid) to authenticated;
