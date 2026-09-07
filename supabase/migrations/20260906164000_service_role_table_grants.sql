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
-- `authenticated`-role grants already follow (CLAUDE.md). No write grant
-- (insert/update/delete) on deltas, tags, resolved_conflicts, or
-- element_merges, deliberately: SPEC §9's "insert via procedure only" for
-- these means no code path, service_role included, should hold a standing
-- write grant on them. `commits` is the one deliberate exception (below) —
-- every e2e/*.spec.ts fixture seeds its test model's genesis commit with a
-- direct service-role insert, a long-established pattern in this repo's
-- own test setup (CLAUDE.md rule 7's "seed data lives in test setup," not
-- a new shortcut introduced here) that bypasses atlas.commit_deltas on
-- purpose, precisely because there is no real genesis-commit product path
-- to seed one through yet. Read access is a different question again —
-- service_role reading `deltas` (below) to fold history is exactly what a
-- read-only admin/debug path should be able to do.
--
-- Uses: organisations (repository.integration.test.ts's afterAll cleanup,
-- deleting the test org, and landscape-perf.spec.ts's own equivalent);
-- aliases, sources, facts, merge_requests (direct assertions against real
-- database state RLS would otherwise hide from a test's own session);
-- elements_head (an assertion, and the P-7 test's deliberate corruption of
-- a materialised head); branches (a read for rebuildHead/buildCommitLoader's
-- own direct use of the service-role client, and two writes: every
-- e2e fixture's own head_commit_id advance after seeding a genesis commit,
-- and the split_from-on-a-non-change-branch test's write, which needs to
-- force a branch into an otherwise-unreachable state to prove the
-- constraint rejects it); commits (every e2e fixture's genesis-commit
-- insert, and the same rebuildHead/buildCommitLoader read); deltas (the
-- same rebuildHead/buildCommitLoader read, folding a model's full commit
-- history independently of any one branch's session); resolved_conflicts
-- (an assertion that a refresh's field-conflict resolution was actually
-- recorded).

grant delete on organisations to service_role;
grant select on aliases to service_role;
grant select on sources to service_role;
grant select, update on elements_head to service_role;
grant select on facts to service_role;
grant select on merge_requests to service_role;
grant select, update on branches to service_role;
grant select, insert on commits to service_role;
grant select on deltas to service_role;
grant select on resolved_conflicts to service_role;
