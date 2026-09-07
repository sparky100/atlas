-- Sprint C1-H item 1: the same gap the previous migration fixed for
-- capability_maps/capability_map_items/capability_map_sources exists on
-- every other table service_role touches directly. With this project's
-- `auto_expose_new_tables = false` (supabase/config.toml), no role gets an
-- implicit grant on a new table — BYPASSRLS lets service_role skip policy
-- checks, but the base table GRANT is a separate, still-enforced gate, and
-- nothing before this migration ever granted service_role one anywhere
-- outside the `atlas` schema's functions.
--
-- Granted per table, matching exactly what a legitimate service-role use
-- needs today, not a blanket grant-everything statement — the same
-- "every table's exposure is a deliberate line" philosophy the
-- `authenticated`-role grants already follow (CLAUDE.md). Left deltas,
-- commits, tags, resolved_conflicts, and element_merges alone deliberately:
-- SPEC §9's "insert via procedure only" for these means no code path,
-- service_role included, should hold a standing update/delete grant on
-- them.
--
-- Uses: organisations (repository.integration.test.ts's afterAll cleanup,
-- deleting the test org); aliases, sources, facts, merge_requests (direct
-- assertions against real database state RLS would otherwise hide from a
-- test's own session); elements_head (an assertion, and the P-7 test's
-- deliberate corruption of a materialised head); branches (the
-- split_from-on-a-non-change-branch test, which needs to force a branch
-- into an otherwise-unreachable state to prove the constraint rejects it).

grant delete on organisations to service_role;
grant select on aliases to service_role;
grant select on sources to service_role;
grant select, update on elements_head to service_role;
grant select on facts to service_role;
grant select on merge_requests to service_role;
grant update on branches to service_role;
