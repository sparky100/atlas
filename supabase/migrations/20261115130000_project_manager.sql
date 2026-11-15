-- A project's project manager: optional, and either an Atlas user or a plain
-- name (a PM is often not an Atlas user). `owner_id` stays the architect.
--
-- Deliberately no foreign key and no index on project_manager_id: an FK on
-- a new column raises the "unindexed foreign key" advisor finding, and the
-- index that fixes it raises "unused index". The id is never joined on in SQL
-- (the UI looks it up in the org's member list), so neither is needed.
-- No new table, function or policy: the existing projects_update policy and
-- the column-level update grant below govern who can edit it.

alter table projects
  add column project_manager_id uuid,
  add column project_manager_name text check (project_manager_name is null or length(btrim(project_manager_name)) between 1 and 200),
  add constraint projects_one_project_manager check (project_manager_id is null or project_manager_name is null);

comment on column projects.project_manager_id is 'Optional: the project manager, when they are an Atlas user. At most one of this and project_manager_name is set.';
comment on column projects.project_manager_name is 'Optional: the project manager as a plain name, when they are not an Atlas user (1-200 characters).';

grant update (project_manager_id, project_manager_name) on projects to authenticated;
