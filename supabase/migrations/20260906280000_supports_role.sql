-- Sprint U4-1 B4: `supports.role` ('primary' | 'secondary') decides which
-- level-1 capability lane a system's landscape tile is placed in
-- (src/ui/landscape/layout.ts). "At most one primary per system"
-- (relationship_type_rules.ts's new `maxPrimaryPerFrom: 1`, `supports`
-- only) is a cross-row cardinality rule, which Postgres can't express as a
-- column `CHECK` — a partial unique index is the standard equivalent, the
-- same mechanism a `CHECK` constraint stands in for everywhere else in
-- this schema that needs "at most one row like X".
--
-- Scope, honestly: this only catches a violation that reaches
-- `relationships_head` — which SPEC §6.3 already only ever materialises
-- for a `main`/tag commit, never a `change` branch's own (structural-only)
-- commits. RelationshipAdd.tsx's "primary?" prompt fires on *either* (any
-- draft change branch a contributor can edit, not main alone — same
-- `canEditBranch` gate every other edit control uses), so a two-primaries
-- commit landing purely on a change branch isn't caught here at all — only
-- once it reaches main (a direct main commit, or that branch's own merge)
-- does `atlas.commit_deltas` insert `deltas` and replace `relationships_head`
-- in the same transaction, so *there* this index rejects the whole commit
-- atomically. This is the same tiered "structural now, schema at main"
-- validation gap SPEC §6.3 already describes for everything else this
-- codebase doesn't yet validate on a change branch — not a new gap this
-- migration introduces, just one it doesn't close either. This is also, as
-- far as this codebase goes, the *first* `maxPrimaryPerTo`/
-- `maxPrimaryPerFrom`-shaped rule to get any runtime enforcement at all —
-- `owns.primary`'s own identical "at most one" (`maxPrimaryPerTo: 1`) has
-- none anywhere in this schema today; fixing that is a real, pre-existing
-- gap, but out of this item's scope (CLAUDE.md's engine-change list names
-- "supports.role" here, not "owns.primary").

create unique index relationships_head_one_primary_supports_per_system
  on relationships_head (commit_id, from_element_id)
  where relationship_type = 'supports' and (attributes ->> 'role') = 'primary';

comment on index relationships_head_one_primary_supports_per_system is
  'At most one live `supports` edge with role=primary per system, per materialised head (Sprint U4-1 B4) — the landscape lane a system''s tile is placed in must be unambiguous. Partial unique index, not a CHECK: this is a cross-row cardinality rule, which CHECK cannot express.';
