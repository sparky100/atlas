-- ADR-018: main never has an empty head — every model's main branch gets a
-- real genesis commit (kind = 'genesis', zero deltas) the instant the model
-- is created, so there is no "model has no commits yet" state anywhere in
-- the schema any more. See 20260906220000_main_always_has_head.sql for the
-- actual implementation.
--
-- This migration only adds the enum value. Postgres does not allow a new
-- enum label to be referenced by name in the same transaction that adds it
-- (ALTER TYPE ... ADD VALUE commits are visible only after the transaction
-- commits) — hence this trivial migration, split from the one that uses
-- 'genesis' as a real commit kind.

alter type commit_kind add value 'genesis';
