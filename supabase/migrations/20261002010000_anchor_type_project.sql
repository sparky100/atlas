-- ADR-024 (projects), F10 step 1, part 1 of 2: a project page carries its
-- own comment thread (ADR-010), so `anchor_type` gains 'project'.
--
-- Its own migration, ahead of 20261002020000_projects.sql: Postgres does
-- not let a new enum value be used in the same transaction that adds it,
-- and that migration's anchor functions compare against 'project'.

alter type anchor_type add value if not exists 'project';
