-- Sprint U4-1 (follow-up to B4): `owns.primary` gets the same database-level
-- backstop `supports.role` got in 20260906280000_supports_role.sql — a
-- partial unique index enforcing "at most one primary `owns` edge per
-- owned element" (relationship_type_rules.ts's `maxPrimaryPerTo: 1`,
-- `owns` only), the cross-row cardinality rule Postgres can't express as a
-- column `CHECK`.
--
-- Real enforcement of this rule now lives in `apply()`
-- (src/engine/deltas.ts's `checkPrimaryCardinality`, invariant C17,
-- docs/SPEC-data-model.md §6.3/§3.3) — checked on every fold, so a
-- violation is caught at commit time on a `change` branch's own commits,
-- not only once (if ever) they reach `main`. This index is a backstop
-- behind that, the same role the `supports.role` index already plays: it
-- only ever materialises for a `main`/tag commit (`relationships_head` is
-- never populated for a `change` branch, SPEC §6.3), so it catches a
-- violation that somehow reached `relationships_head` some other way (a
-- bug in `apply()`, a direct write bypassing the engine) rather than being
-- the thing that actually closes the branch-time gap — `apply()` is.
create unique index relationships_head_one_primary_owns_per_target
  on relationships_head (commit_id, to_element_id)
  where relationship_type = 'owns' and (attributes ->> 'primary') = 'true';

comment on index relationships_head_one_primary_owns_per_target is
  'At most one live `owns` edge with primary=true per owned element, per materialised head (Sprint U4-1) — mirrors relationships_head_one_primary_supports_per_system. Partial unique index, not a CHECK: this is a cross-row cardinality rule, which CHECK cannot express. Backstop behind apply()''s C17, which is what actually enforces this on a change branch (this index only ever materialises for main/tags).';
