-- Sprint F1 step 2: foundations schema, part 2 of 8.
--
-- Enumerated types needed by the tables this sprint creates
-- (SPEC-data-model.md §3.1). Only the subset this sprint's tables use — the
-- remaining twelve enums in §3.1 land in the migrations that create their
-- owning tables (comments, decisions, capture, merge review, views,
-- capability maps), so every object a migration creates is used by
-- something else in that same migration.

create type member_role as enum ('owner', 'architect', 'contributor', 'viewer');

create type element_type as enum ('capability', 'system', 'container', 'component', 'actor');

create type relationship_type as enum ('supports', 'uses', 'owns', 'flows_to');

create type branch_kind as enum ('main', 'change', 'capture_draft');

create type branch_status as enum ('draft', 'proposed', 'in_review', 'approved', 'merged', 'rejected', 'archived');

create type commit_kind as enum ('manual', 'capture', 'merge', 'template_seed');

create type delta_kind as enum (
  'element_create', 'element_update', 'element_retract', 'element_restore',
  'relationship_create', 'relationship_update', 'relationship_retract', 'relationship_restore'
);

create type subject_type as enum ('element', 'relationship');

create type source_kind as enum ('document', 'spreadsheet', 'interview', 'capture_job', 'template', 'manual', 'merge_resolution');

create type alias_type as enum ('name', 'code', 'external_ref', 'source_system_key', 'template_code', 'merged_id');
