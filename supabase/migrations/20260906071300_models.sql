-- Sprint F1 step 2: foundations schema, part 4 of 8.
--
-- models (SPEC-data-model.md §3.2). model_shares (cross-org sharing) is not
-- part of this sprint's table list, so models_select below is
-- `atlas.is_member(org_id)` only — the spec's full policy also ORs in
-- `atlas.model_shared_with_me(id)`, which reads model_shares. When that
-- table's migration lands, it drops and recreates this policy to add the
-- clause; nothing about this policy or models itself needs to change
-- structurally.

create table models (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  name text not null,
  slug text not null,
  description text,
  schema_version int not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (org_id, slug)
);

comment on table models is 'A landscape. One org owns it; sharing is by grant, never by moving it (ADR-009).';

create index models_org_id_idx on models (org_id);

-- The main branch is created automatically so a model is never in a state
-- with no branch to commit against; see 20260906071400_history.sql for the
-- branches table and this trigger's function
-- (atlas.on_model_created is defined there, after branches exists).

alter table models enable row level security;
alter table models force row level security;

create policy models_select on models
  for select to authenticated
  using (atlas.is_member(org_id));

create policy models_insert on models
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') and created_by = auth.uid());

create policy models_update on models
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'))
  with check (atlas.has_role(org_id, 'owner', 'architect'));

create policy models_delete on models
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner'));

grant select, insert, update, delete on models to authenticated;
