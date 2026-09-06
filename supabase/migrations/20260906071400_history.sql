-- Sprint F1 step 2: foundations schema, part 5 of 8.
--
-- branches, commits, deltas, tags — the history model (SPEC-data-model.md
-- §3.4, ADR-002). This is the largest migration in the sprint because these
-- four tables and the invariants that hold them together (S-1..S-18) are one
-- coherent unit; splitting them further would just scatter cross-references.
--
-- What this migration deliberately does NOT enforce: the C1-C16 commit
-- invariants (src/contracts/delta.ts) beyond what a per-row CHECK can
-- express. Cross-row invariants (id-never-reused, previous_delta_id matching
-- the parent head's live fact, sequencing, resulting-head validation) are
-- the job of the commit-writing engine (SPEC §5.3's atlas.commit, landing in
-- src/engine + src/db in later Sprint F1 steps), not a table constraint.
-- The RLS policies here are the coarse-grained authorization gate the spec
-- calls for (role, branch status, authorship) — real and load-bearing, but
-- not a substitute for that engine.

create table branches (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id) on delete cascade,
  name text not null,
  kind branch_kind not null,
  status branch_status not null default 'draft',
  base_commit_id uuid, -- references commits(id); added once commits exists, below
  head_commit_id uuid, -- references commits(id); added once commits exists, below
  shared_for_review boolean not null default false,
  title text,
  created_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (model_id, name),
  check (kind <> 'main' or (status = 'draft' and base_commit_id is null)),
  check (kind = 'main' or base_commit_id is not null),
  check (kind <> 'capture_draft' or status in ('draft', 'archived'))
);

comment on table branches is 'A named mutable pointer to a commit (ADR-002).';

create unique index branches_one_main_per_model_idx on branches (model_id) where kind = 'main';
create index branches_model_id_status_idx on branches (model_id, status);
create index branches_org_id_idx on branches (org_id);

create table commits (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  branch_id uuid not null references branches (id),
  parent_commit_id uuid references commits (id),
  merged_branch_head_commit_id uuid references commits (id),
  kind commit_kind not null,
  message text not null,
  -- Deliberately not a foreign key: a service identity (capture worker,
  -- merge procedure) is a real, meaningful author_id but not necessarily a
  -- row in auth.users (SPEC §3.4).
  author_id uuid not null,
  head_hash bytea,
  depth int not null,
  created_at timestamptz not null default now(),
  check ((kind = 'merge') = (merged_branch_head_commit_id is not null)),
  check (head_hash is null or octet_length(head_hash) = 32)
);

comment on table commits is 'An ordered batch of deltas on a branch. Ancestry is a DAG: two parents on a merge (ADR-002).';

alter table branches
  add constraint branches_base_commit_id_fkey foreign key (base_commit_id) references commits (id),
  add constraint branches_head_commit_id_fkey foreign key (head_commit_id) references commits (id);

create index commits_branch_id_depth_idx on commits (branch_id, depth desc);
create index commits_parent_commit_id_idx on commits (parent_commit_id);
create index commits_merged_branch_head_commit_id_idx on commits (merged_branch_head_commit_id) where merged_branch_head_commit_id is not null;
create index commits_model_id_kind_idx on commits (model_id, kind);
create index commits_org_id_idx on commits (org_id);
-- Enforces linear history within a branch (C13): a commit has at most one
-- child on its own branch.
create unique index commits_branch_id_parent_commit_id_idx on commits (branch_id, parent_commit_id) where parent_commit_id is not null;

create table deltas (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  commit_id uuid not null references commits (id),
  seq int not null,
  kind delta_kind not null,
  subject_type subject_type generated always as (
    case
      when kind in ('element_create', 'element_update', 'element_retract', 'element_restore')
        then 'element'::subject_type
      else 'relationship'::subject_type
    end
  ) stored,
  subject_id uuid not null,
  attribute text not null,
  element_type element_type,
  relationship_type relationship_type,
  name text,
  parent_id uuid,
  from_element_id uuid,
  to_element_id uuid,
  value jsonb,
  previous_delta_id uuid references deltas (id),
  -- sources does not exist until 20260906071600_sources_and_aliases.sql;
  -- the FK is added there, once it can be.
  source_id uuid not null,
  source_ref text,
  effective_date date,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  created_by uuid not null,
  created_at timestamptz not null default now(),

  unique (commit_id, seq),
  unique (commit_id, subject_id, attribute),

  check (effective_date is null or effective_date <= current_date),

  -- attribute: '$exists' for every kind except the two update kinds.
  check (kind in ('element_update', 'relationship_update') or attribute = '$exists'),

  -- element_type / relationship_type follow subject_type exactly.
  check (
    (subject_type = 'element' and element_type is not null and relationship_type is null)
    or (subject_type = 'relationship' and relationship_type is not null and element_type is null)
  ),

  -- name: only on element_create, and required there.
  check ((kind = 'element_create') = (name is not null)),

  -- parent_id: the dedicated column is populated only by element_create's
  -- initial value; a later re-parent is an element_update with
  -- attribute = 'parentId' carrying the new value in `value` instead
  -- (SPEC §3.4, §4.2).
  check (kind = 'element_create' or parent_id is null),

  -- from/to: only on relationship_create, and required there (endpoints are
  -- immutable, S-5).
  check ((kind = 'relationship_create') = (from_element_id is not null)),
  check ((kind = 'relationship_create') = (to_element_id is not null)),

  -- value: required on the two create kinds (the initial attributes object,
  -- possibly `{}`, but never absent); forbidden on retract/restore, which
  -- carry no payload; free on update (null there means "clear").
  check (kind not in ('element_create', 'relationship_create') or value is not null),
  check (
    kind not in ('element_retract', 'element_restore', 'relationship_retract', 'relationship_restore')
    or value is null
  ),

  -- previous_delta_id: absent only on the two create kinds; every other
  -- kind supersedes or reverses something.
  check ((kind in ('element_create', 'relationship_create')) = (previous_delta_id is null))
);

comment on table deltas is 'One fact assertion (ADR-002, ADR-007). The only source of truth for model content.';

create index deltas_model_id_subject_id_attribute_idx on deltas (model_id, subject_id, attribute);
create index deltas_previous_delta_id_idx on deltas (previous_delta_id) where previous_delta_id is not null;
create index deltas_source_id_idx on deltas (source_id);
create index deltas_model_id_from_element_id_idx on deltas (model_id, from_element_id) where from_element_id is not null;
create index deltas_model_id_to_element_id_idx on deltas (model_id, to_element_id) where to_element_id is not null;
create index deltas_org_id_idx on deltas (org_id);

create table tags (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  model_id uuid not null references models (id),
  name text not null,
  commit_id uuid not null references commits (id),
  description text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (model_id, name)
);

comment on table tags is 'Immutable pointer to a main commit; the product''s "version" (ADR-002).';

create index tags_org_id_idx on tags (org_id);
create index tags_commit_id_idx on tags (commit_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A model is never without a branch to commit against: the main branch is
-- created as a side effect of the model, not by any client-composed
-- envelope, so it is one of the rare rows the database mints an id for
-- (SPEC §2).
create or replace function atlas.on_model_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into branches (id, org_id, model_id, name, kind, status, shared_for_review, created_by, updated_at)
  values (gen_random_uuid(), new.org_id, new.id, 'main', 'main', 'draft', false, new.created_by, now());
  return new;
end;
$$;

create trigger models_create_main_branch
  after insert on models
  for each row execute function atlas.on_model_created();

-- A tag can only ever point at a commit that is actually on the model's main
-- branch (SPEC §3.4) — checked here so it holds regardless of which future
-- code path creates a tag.
create or replace function atlas.guard_tag_on_main()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from commits c
    join branches b on b.id = c.branch_id
    where c.id = new.commit_id and b.kind = 'main' and b.model_id = new.model_id
  ) then
    raise exception 'a tag must point at a commit on its model''s main branch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tags_guard_on_main
  before insert on tags
  for each row execute function atlas.guard_tag_on_main();

create or replace function atlas.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger branches_touch_updated_at
  before update on branches
  for each row execute function atlas.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper needed by branches/commits: whether a viewer-role member may
-- see a given branch's content at all (main, or explicitly shared for
-- review). Needs only branches, so it belongs here rather than in tenancy.
-- ---------------------------------------------------------------------------

create or replace function atlas.branch_visible_to_viewer(p_branch uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from branches b
    where b.id = p_branch and (b.kind = 'main' or b.shared_for_review)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS: branches
-- ---------------------------------------------------------------------------

alter table branches enable row level security;
alter table branches force row level security;

create policy branches_select on branches
  for select to authenticated
  using (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    or (atlas.has_role(org_id, 'viewer') and (kind = 'main' or shared_for_review))
  );

-- Only change branches are created directly; main is created by the trigger
-- above (as the model's owner/architect creating the model), and
-- capture_draft branches are created by the capture worker (service role,
-- ADR-004) — neither goes through this policy. A new change branch must
-- fork from a real commit on the model's main branch, and starts with no
-- commits of its own yet (head equals base) — the future commit engine is
-- the only thing that ever advances head_commit_id past that point.
create policy branches_insert on branches
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and kind = 'change'
    and status = 'draft'
    and created_by = auth.uid()
    and head_commit_id = base_commit_id
    and exists (
      select 1 from commits c
      join branches mb on mb.id = c.branch_id
      where c.id = branches.base_commit_id
        and mb.kind = 'main'
        and mb.model_id = branches.model_id
    )
  );

-- Only title and shared_for_review are directly editable today. Advancing
-- head_commit_id or status goes through the commit/merge engine landing in
-- later Sprint F1 steps — allowing a raw update to those now, with none of
-- the invariant-checking that engine will do, would be exactly the kind of
-- demo shortcut CLAUDE.md rules out.
create policy branches_update on branches
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect', 'contributor'))
  with check (atlas.has_role(org_id, 'owner', 'architect', 'contributor'));

revoke update on branches from authenticated;
grant select, insert on branches to authenticated;
grant update (title, shared_for_review) on branches to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: commits (literal per SPEC §9.3, minus the `or
-- atlas.commit_shared_with_me(id)` clause — that helper reads model_shares,
-- which is not part of this sprint; it is added back when that table's
-- migration lands, per the note at the top of this file).
-- ---------------------------------------------------------------------------

alter table commits enable row level security;
alter table commits force row level security;

create policy commits_select on commits
  for select to authenticated
  using (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    or (
      atlas.has_role(org_id, 'viewer')
      and (
        atlas.branch_visible_to_viewer(branch_id)
        or exists (select 1 from tags t where t.commit_id = commits.id)
      )
    )
  );

-- Direct inserts: contributors and above, on a draft change branch they can
-- see, as the author. Never on main (S-17) and never on capture_draft
-- (service role only).
create policy commits_insert on commits
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and author_id = auth.uid()
    and kind in ('manual', 'merge')
    and exists (
      select 1 from branches b
      where b.id = commits.branch_id
        and b.org_id = commits.org_id
        and b.model_id = commits.model_id
        and b.kind = 'change'
        and b.status = 'draft'
    )
  );

-- No update or delete policies: append-only for every application role.
-- The future atlas.merge_branch / atlas.seed_from_map are the only writers
-- of commits whose branch is main.
grant select, insert on commits to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: deltas (follows commits exactly, per SPEC §9.3's own description —
-- visibility and insert-eligibility are both expressed as "the referenced
-- commit passes the same checks", not duplicated here.)
-- ---------------------------------------------------------------------------

alter table deltas enable row level security;
alter table deltas force row level security;

create policy deltas_select on deltas
  for select to authenticated
  using (exists (select 1 from commits c where c.id = deltas.commit_id));

create policy deltas_insert on deltas
  for insert to authenticated
  with check (
    exists (
      select 1 from commits c
      join branches b on b.id = c.branch_id
      where c.id = deltas.commit_id
        and atlas.has_role(c.org_id, 'owner', 'architect', 'contributor')
        and c.kind in ('manual', 'merge')
        and b.kind = 'change'
        and b.status = 'draft'
    )
  );

grant select, insert on deltas to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: tags
-- ---------------------------------------------------------------------------

alter table tags enable row level security;
alter table tags force row level security;

create policy tags_select on tags
  for select to authenticated
  using (atlas.is_member(org_id));
  -- Cross-org visibility of a specifically shared tag is added once
  -- model_shares lands (mirrors the models_select note above).

create policy tags_insert on tags
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') and created_by = auth.uid());

-- No update or delete policies: tags are immutable once created (ADR-002).
grant select, insert on tags to authenticated;
