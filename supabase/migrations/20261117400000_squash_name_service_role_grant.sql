-- atlas.squash_name is the expression behind elements_head_squashed_name_trgm_idx
-- (20261016010000). Postgres evaluates an index expression as the role that
-- writes the row, so any role that updates elements_head's name needs EXECUTE
-- on it. The original migration granted it to `authenticated` only; the
-- service role (used by tooling and tests that repair or rebuild a projection)
-- was refused with "permission denied for function squash_name".
--
-- The function is immutable, invoker-rights, touches no table and returns a
-- string derived from its argument alone, so granting it to the service role
-- widens nothing. `public` and `anon` stay revoked.
revoke all on function atlas.squash_name(text) from public, anon;
grant execute on function atlas.squash_name(text) to authenticated, service_role;
