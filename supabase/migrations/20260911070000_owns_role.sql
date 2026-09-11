-- Prompt 7k item 2: owns.role replaces owns.primary for cardinality
-- purposes — src/contracts/delta.ts's OwnsAttributes/OwnsRole doc
-- comments and src/engine/deltas.ts's checkPrimaryCardinality have the
-- full reasoning. Cardinality changes from "at most one primary owner per
-- target, across all roles" to "at most one owner per (target, role)" — a
-- target may now have up to three live owns edges at once
-- (business/technical/service), never two holding the same role.
--
-- This migration is schema-only. It does NOT touch any row's data — no
-- existing owns edge's attributes are rewritten here. Per this sprint's
-- own new SPEC §6.8 rule ("data changes are commits, never row
-- rewrites"), an existing owns edge keeps its primary value exactly as
-- recorded until a real relationship.update commit changes it:
-- src/db/backfillOwnsRole.ts (run once per model via
-- `pnpm backfill:owns-role <modelId> <email> <password>`, part of
-- releasing this change) writes that commit. A raw SQL UPDATE on
-- relationships_head/deltas was deliberately rejected: it would leave a
-- future rebuildHead/foldFromGenesis replay (which re-derives the
-- projection from deltas, not from whatever the projection currently
-- holds) to silently regenerate the old primary-shaped attributes and
-- undo the fix, and would leave commits.head_hash (computed once, at
-- commit time, never recomputed) permanently mismatched for every
-- downstream commit. A real commit sidesteps both problems entirely.
--
-- Until that backfill commit lands on a given model, its pre-existing
-- owns edges have no `role` at all — relationships_head_one_owner_per_role
-- below is a partial index keyed on `(attributes ->> 'role')`, and
-- Postgres treats NULL as never conflicting with itself in a unique
-- index, so those edges simply have no cardinality enforcement (same as
-- checkPrimaryCardinality's own engine-level guard: it only checks C17
-- for a create/update/restore that actually sets a role) until migrated —
-- consistent with "old commits fold unchanged," not a regression from
-- today's coverage of them.

drop index if exists relationships_head_one_primary_owns_per_target;

create unique index relationships_head_one_owner_per_role
  on relationships_head (commit_id, to_element_id, (attributes ->> 'role'))
  where relationship_type = 'owns';

comment on index relationships_head_one_owner_per_role is
  'At most one live `owns` edge per (owned element, role), per materialised head (Prompt 7k item 2) -- replaces relationships_head_one_primary_owns_per_target now that role can be business/technical/service rather than a single primary flag. Partial unique index, not a CHECK: a cross-row cardinality rule. Backstop behind apply()''s C17 (checkPrimaryCardinality), which is what actually enforces this on a change branch (this index only ever materialises for main/tags). NULL role (a not-yet-backfilled edge) never conflicts with itself or anything else, by Postgres''s own unique-index semantics -- see this migration''s own top comment.';
