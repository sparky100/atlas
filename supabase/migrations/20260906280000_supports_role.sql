-- Sprint U4-1 B4: `supports.role` ('primary' | 'secondary') decides which
-- level-1 capability lane a system's landscape tile is placed in
-- (src/ui/landscape/layout.ts). "At most one primary per system"
-- (relationship_type_rules.ts's new `maxPrimaryPerFrom: 1`, `supports`
-- only) is a cross-row cardinality rule, which Postgres can't express as a
-- column `CHECK` — a partial unique index is the standard equivalent, the
-- same mechanism a `CHECK` constraint stands in for everywhere else in
-- this schema that needs "at most one row like X".
--
-- Scope, honestly: on its own, this index only catches a violation that
-- reaches `relationships_head` — which SPEC §6.3 only ever materialises
-- for a `main`/tag commit, never a `change` branch's own (structural-only)
-- commits. RelationshipAdd.tsx's "primary?" prompt fires on *either* (any
-- draft change branch a contributor can edit, not main alone — same
-- `canEditBranch` gate every other edit control uses), so at the time this
-- migration was the *only* enforcement, a two-primaries commit landing
-- purely on a change branch wasn't caught until it reached main.
--
-- Superseded as the primary defense (Sprint U4-1 follow-up,
-- 20260906290000_owns_primary.sql): `apply()` now enforces this rule
-- inline (src/engine/deltas.ts's `checkPrimaryCardinality`, invariant C17,
-- SPEC §6.3/§3.3) on every fold, for both `supports.role` and
-- `owns.primary` — `fold`/`apply` are the same functions `commitToBranch`
-- calls for a `change` branch's own commits, so the branch-time gap
-- described above is closed there, not here. This index remains as a
-- database-level backstop (the same role its `owns.primary` sibling
-- plays) rather than the thing actually closing the gap.

create unique index relationships_head_one_primary_supports_per_system
  on relationships_head (commit_id, from_element_id)
  where relationship_type = 'supports' and (attributes ->> 'role') = 'primary';

comment on index relationships_head_one_primary_supports_per_system is
  'At most one live `supports` edge with role=primary per system, per materialised head (Sprint U4-1 B4) — the landscape lane a system''s tile is placed in must be unambiguous. Partial unique index, not a CHECK: this is a cross-row cardinality rule, which CHECK cannot express.';
