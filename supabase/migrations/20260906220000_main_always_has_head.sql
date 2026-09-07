-- ADR-018: main never has an empty head.
--
-- Before this migration, a freshly created model's main branch had
-- base_commit_id/head_commit_id both null until something committed to it
-- — and nothing could, because atlas.commit_deltas's own branch/depth
-- lookup (`join commits c on c.id = p_base_commit_id`) requires a real
-- existing commit to attach to. The only way to get a model's first
-- commit was atlas.seed_from_map (a capability-map import), which is why
-- every other write path (a hand-typed first capability, the three
-- service-role "bootstrap a genesis commit" blocks this migration's
-- sibling changes remove from e2e/landscape-perf.spec.ts and
-- e2e/element-edit.spec.ts) had no product path at all.
--
-- Fix: atlas.on_model_created (below) now also inserts one zero-delta
-- 'genesis' commit for the new main branch and points base_commit_id and
-- head_commit_id at it, in the same transaction as the model insert.
-- 'genesis' is the only commit kind ever allowed a null parent_commit_id,
-- and the only inserter of one is this trigger (never a client RPC —
-- atlas.commit_deltas and atlas.seed_from_map both still require a real
-- parent, enforced below by requiring a parent unconditionally rather than
-- special-casing null). Every branch of every kind now always has both
-- columns set from the moment it exists, so the two old kind-conditional
-- CHECKs collapse into one flat "always set" rule.
--
-- Order of operations, all in this one transaction: backfill first (so the
-- NOT NULL/CHECK changes below never see a violating row), then the
-- trigger for future models, then the constraints, then seed_from_map.

-- ---------------------------------------------------------------------------
-- 1. Backfill: any existing main branch with no head yet gets a genesis
--    commit, exactly what atlas.on_model_created will now do at creation
--    time. depth 0, no deltas, no head_hash (an empty fold has nothing to
--    hash against — rebuildHead's own verification only ever runs from a
--    commit with real content; a bare genesis commit is never tagged or
--    cited on its own).
-- ---------------------------------------------------------------------------

do $$
declare
  v_branch record;
  v_commit_id uuid;
begin
  for v_branch in
    select b.id, b.org_id, b.model_id, m.created_by
    from branches b
    join models m on m.id = b.model_id
    where b.kind = 'main' and b.head_commit_id is null
  loop
    v_commit_id := gen_random_uuid();
    insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
    values (v_commit_id, v_branch.org_id, v_branch.model_id, v_branch.id, null, null, 'genesis', 'Genesis', v_branch.created_by, 0, null);
    update branches set base_commit_id = v_commit_id, head_commit_id = v_commit_id where id = v_branch.id;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. atlas.on_model_created: every future model's main branch is born with
--    its genesis commit already attached, not created bare and fixed up
--    later.
--
--    commits.branch_id and branches.{base,head}_commit_id now point at each
--    other's very first row within the same transaction — genuinely mutual,
--    not a chicken-and-egg mistake to route around: the trigger below must
--    insert the genesis commit (which names its branch_id) before the
--    branch exists to be named, in order to then insert the branch (which
--    names that commit as its base/head) in the same breath. Postgres
--    checks a plain FK immediately, per row, which rejects the first insert
--    outright — so `commits_branch_id_fkey` becomes deferrable, checked
--    only at transaction commit, when both rows are already there. The two
--    `branches` FKs (`base_commit_id`/`head_commit_id` → `commits`) need no
--    such change: by the time branches is inserted below, the commit it
--    references already exists.
-- ---------------------------------------------------------------------------

alter table commits drop constraint commits_branch_id_fkey;
alter table commits add constraint commits_branch_id_fkey foreign key (branch_id) references branches(id) deferrable initially deferred;

create or replace function atlas.on_model_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch_id uuid := gen_random_uuid();
  v_commit_id uuid := gen_random_uuid();
begin
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
  values (v_commit_id, new.org_id, new.id, v_branch_id, null, null, 'genesis', 'Genesis', new.created_by, 0, null);

  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, shared_for_review, created_by, updated_at)
  values (v_branch_id, new.org_id, new.id, 'main', 'main', 'draft', v_commit_id, v_commit_id, false, new.created_by, now());

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. branches: base_commit_id/head_commit_id are now always set, for every
--    kind — the old main-only exception is gone. NOT NULL replaces the old
--    kind-conditional CHECKs outright (the backfill above already made
--    every existing row satisfy this).
-- ---------------------------------------------------------------------------

-- The two original CHECKs from 20260906071400_history.sql had no names of
-- their own — Postgres auto-named them, and the exact rendering of
-- pg_get_constraintdef (spacing, type-cast syntax) isn't worth hard-coding
-- an exact match against — so find them by substring content instead and
-- drop by whatever name this database actually assigned.
do $$
declare
  v_conname text;
begin
  for v_conname in
    select conname from pg_constraint
    where conrelid = 'public.branches'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) like '%base_commit_id IS NULL%'
        or pg_get_constraintdef(oid) like '%base_commit_id IS NOT NULL%'
      )
  loop
    execute format('alter table branches drop constraint %I', v_conname);
  end loop;
end;
$$;

alter table branches
  alter column base_commit_id set not null,
  alter column head_commit_id set not null;

comment on column branches.base_commit_id is 'Every branch''s fork point — for main, its own genesis commit (ADR-018: never null). For a change/capture_draft branch, the main commit it forked from.';
comment on column branches.head_commit_id is 'Every branch''s current tip — for a freshly created main, the same genesis commit as base_commit_id (ADR-018: never null).';

-- ---------------------------------------------------------------------------
-- 4. atlas.seed_from_map: main's head is the genesis commit now, never
--    null, so this always has a real parent to attach to — the "genesis
--    is structurally different, no base commit exists yet" reasoning in
--    this function's own original module comment (20260906120000_seed_from_map.sql)
--    no longer holds; template_seed is an ordinary commit with a parent
--    like any other, and this function keeps existing as a separate
--    function for its other reason (writes sources/aliases commit_deltas
--    never does), not because genesis needs special-casing any more.
--
--    "Seeded once, ever" (SPEC §5.1) used to be "head_commit_id is null";
--    it is now "the current head is still the genesis commit itself" — the
--    same fact (nothing but genesis has happened yet), expressed against a
--    head that always exists rather than one that might not.
-- ---------------------------------------------------------------------------

create or replace function atlas.seed_from_map(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_message text,
  p_capability_map_id uuid,
  p_source_id uuid,
  p_source_name text,
  p_deltas jsonb,
  p_elements_head jsonb,
  p_facts jsonb,
  p_aliases jsonb,
  p_head_hash text
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_branch_kind branch_kind;
  v_branch_model_id uuid;
  v_head_commit_id uuid;
  v_head_kind commit_kind;
  v_map_status map_status;
  v_commit commits;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'seed_from_map: model % not found', p_model_id using errcode = '22023';
  end if;

  if atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'seed_from_map: only owners and architects may seed a model' using errcode = '42501';
  end if;

  select kind, model_id, head_commit_id into v_branch_kind, v_branch_model_id, v_head_commit_id
  from branches where id = p_branch_id;
  if v_branch_kind is null or v_branch_model_id <> p_model_id then
    raise exception 'seed_from_map: branch % is not a branch of model %', p_branch_id, p_model_id using errcode = '22023';
  end if;
  if v_branch_kind <> 'main' then
    raise exception 'seed_from_map: capability maps seed a model''s main branch only, not %', v_branch_kind using errcode = '42501';
  end if;

  -- "the first commit of a model seeded from a capability map" (SPEC
  -- §5.1) — literally the first real one: a model is seeded once, at
  -- most, ever. main's head is always at least the genesis commit
  -- (ADR-018); seeding is only allowed while it's *still* that genesis
  -- commit and nothing else. Later tailoring (rename/delete/add) is
  -- ordinary `manual` commits on top of this one, not a second seed.
  select kind into v_head_kind from commits where id = v_head_commit_id;
  if v_head_kind <> 'genesis' then
    raise exception 'seed_from_map: model % has already been seeded (main''s head is past genesis)', p_model_id using errcode = '42501';
  end if;

  select status into v_map_status from capability_maps where id = p_capability_map_id;
  if v_map_status is null then
    raise exception 'seed_from_map: capability map % not found', p_capability_map_id using errcode = '22023';
  end if;
  if v_map_status <> 'published' then
    raise exception 'seed_from_map: capability map % is not published', p_capability_map_id using errcode = '42501';
  end if;

  if jsonb_array_length(p_deltas) = 0 then
    raise exception 'seed_from_map: a seed commit needs at least one delta' using errcode = '22023';
  end if;

  insert into sources (id, org_id, model_id, kind, name, capability_map_id, created_by)
  values (p_source_id, v_org_id, p_model_id, 'template', p_source_name, p_capability_map_id, auth.uid());

  -- parent_commit_id is now the genesis commit (never null — only
  -- 'genesis' commits ever have a null parent, and this is never one),
  -- and depth is 1: genesis is always depth 0, and this is always the
  -- first non-genesis commit on this branch.
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
  values (p_commit_id, v_org_id, p_model_id, p_branch_id, v_head_commit_id, null, 'template_seed', p_message, auth.uid(), 1, decode(p_head_hash, 'hex'))
  returning * into v_commit;

  insert into deltas (
    id, org_id, model_id, commit_id, seq, kind, subject_id, attribute, element_type, relationship_type, name, parent_id, from_element_id, to_element_id,
    value, previous_delta_id, source_id, source_ref, effective_date, confidence, created_by
  )
  select
    (d ->> 'id')::uuid, v_org_id, p_model_id, p_commit_id, (ord - 1)::int, (d ->> 'kind')::delta_kind, (d ->> 'subject_id')::uuid, d ->> 'attribute',
    nullif(d ->> 'element_type', '')::element_type, nullif(d ->> 'relationship_type', '')::relationship_type, d ->> 'name', (d ->> 'parent_id')::uuid,
    (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, d -> 'value', (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
    d ->> 'source_ref', nullif(d ->> 'effective_date', '')::date, (d ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_deltas) with ordinality as t (d, ord);

  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  -- p_old_commit_id is now the genesis commit rather than null —
  -- replace_main_head_projection already handles a non-null old id
  -- correctly (it tries to GC that commit's own elements_head/
  -- relationships_head/facts rows, which is a harmless no-op here since
  -- genesis never has any).
  perform atlas.replace_main_head_projection(
    v_org_id, p_model_id, v_head_commit_id, p_commit_id, coalesce(p_elements_head, '[]'::jsonb), '[]'::jsonb, coalesce(p_facts, '[]'::jsonb)
  );

  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  select (a ->> 'id')::uuid, v_org_id, p_model_id, (a ->> 'element_id')::uuid, a ->> 'alias_value', 'template_code', p_source_id, (a ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_aliases) as a;

  return v_commit;
end;
$$;
