-- Phase B2 follow-up: the Supabase performance advisor flagged two policies
-- that #561 recreated (`projects_insert`, `project_links_insert`) for
-- calling `auth.uid()` per row (lint 0003 auth_rls_initplan). Same rules,
-- with the call wrapped as `(select auth.uid())` so it is evaluated once.
-- Nothing about who may insert changes; CLAUDE.md rule 9 (no new advisor
-- finding) is the only reason for this migration.

drop policy projects_insert on projects;
create policy projects_insert on projects
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and created_by = (select auth.uid())
    and status in ('active', 'proposed')
    and closed_by is null
    and closed_at is null
    and close_reason is null
    and exists (select 1 from models m where m.id = projects.model_id and m.org_id = projects.org_id)
  );

drop policy project_links_insert on project_links;
create policy project_links_insert on project_links
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from projects p where p.id = project_links.project_id and p.status in ('proposed', 'active', 'on_hold') and atlas.can_edit_project(p))
  );
