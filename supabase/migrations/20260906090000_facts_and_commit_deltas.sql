-- Sprint U1 step 3a (prerequisite for the element page):
--
-- 1. `facts` (SPEC-data-model.md §3.5, S-8) — the attribute-grain
--    provenance projection. Named in the original Sprint F1 migration list
--    alongside elements_head/relationships_head but never actually
--    migrated; added now because the element page's provenance badges are
--    the first thing that needs it. Same commit-scoped, select-only-for-
--    authenticated RLS pattern as elements_head/relationships_head.
--
-- 2. `atlas.commit_deltas` — the one place a commit is ever written from
--    here on. Synchronous, single round trip, single transaction: inserts
--    the commit and its deltas, advances the branch head (still checked by
--    atlas.guard_branch_head_advance, unchanged from Sprint F1 step 6), and
--    — only when the branch is `main` — materialises elements_head,
--    relationships_head and facts for the new head via
--    atlas.replace_main_head_projection. This replaces src/db/commits.ts's
--    previous two-round-trip insert-then-CAS: what used to be "a lost race
--    leaves a harmless orphan commit" is now simply "the whole function
--    call fails and nothing was written," because a PL/pgSQL function body
--    is one transaction.
--
--    Security definer, with its own authorization check, because it has to
--    do something the plain `commits_insert`/`branches` RLS policies never
--    allowed: advance `main`. This is a permanent product decision (ADR-015,
--    UI-principles.md §4.2), not a sprint-scoped workaround: contributors
--    never commit to main, whether or not a branch/review-queue UI exists —
--    only owner/architect may. A `change` branch still takes
--    owner/architect/contributor, matching commits_insert's original rule,
--    and still must be `draft`.
--
-- 3. `atlas.replace_main_head_projection` — the actual projection writer,
--    factored out so both `commit_deltas` and `src/db/rebuildHead.ts` (a
--    TypeScript-driven full refold, for repair/verification — SPEC §6.6's
--    integrity job) share one write path. Not granted to `authenticated`
--    at all: `commit_deltas` calls it as its own owner (a security-definer
--    function's internal calls run with the *definer's* privileges, which
--    always include execute on functions it owns, regardless of grants to
--    other roles) — an authenticated user has no way to call this directly
--    with arbitrary data for an org they don't belong to. Idempotent for a
--    single commit_id (always clears that commit's own rows before
--    inserting, whether or not it's tagged) — rebuildHead deliberately
--    re-runs this for a commit whose projection already exists, main's
--    current head included, to verify it's still correct.
--
-- Why the fold/apply logic itself isn't reimplemented in SQL: src/engine
-- already has ~450 lines of tested `apply`/`fold` covering all 8 delta
-- kinds, including retract/restore's history-chain recovery. Duplicating
-- that in PL/pgSQL would mean two implementations of the same semantics
-- that could silently drift. Instead, src/db/commits.ts computes the
-- resulting Head with the existing engine (it already does this for
-- validation) and serialises it into the jsonb arrays these functions take
-- — the engine stays the one place fold/apply is defined, and this
-- migration's job is only to write the result atomically.
--
-- The real cost of that choice: the *whole* materialised projection for
-- the new head crosses the wire on every main commit, not just the
-- touched rows — a one-element edit on a 2,000-element landscape still
-- sends all 2,000 elements back. Deliberate for now (SPEC §6.5's own
-- "fetch everything" allowance; this product's stated scale is one or two
-- architects, not a live-editing crowd), with delta-apply directly against
-- the existing projection rows named as the upgrade path if that payload
-- ever needs it (ADR-015) — measured, not guessed, by Sprint U1 step 4's
-- Playwright perf test against a generated 2,000-element model.

-- Every prior atlas.* function was only ever invoked implicitly, through an
-- RLS policy or trigger expression compiled at creation time by the
-- migration role — those don't re-check schema USAGE per call. This
-- migration is the first time a client calls into the schema directly
-- (`select atlas.commit_deltas(...)`, and `rebuildHead`'s direct call to
-- atlas.replace_main_head_projection as service_role), which does need it.
grant usage on schema atlas to authenticated, service_role;

create table facts (
  commit_id uuid not null references commits (id) on delete cascade,
  subject_type subject_type not null,
  subject_id uuid not null,
  attribute text not null,
  value jsonb,
  delta_id uuid not null references deltas (id),
  source_id uuid not null references sources (id),
  source_ref text,
  effective_date date,
  confidence numeric(3, 2) not null check (confidence between 0 and 1),
  asserted_by uuid not null,
  asserted_at timestamptz not null,
  primary key (commit_id, subject_id, attribute)
);

comment on table facts is 'Attribute-grain provenance at a commit: which delta currently asserts each fact (SPEC §3.5, S-8, ADR-007).';

create index facts_commit_id_source_id_idx on facts (commit_id, source_id);

alter table facts enable row level security;
alter table facts force row level security;

-- Same delegation pattern as elements_head/relationships_head (§9.5): no
-- insert/update/delete policy for authenticated at all, and select just
-- checks the owning commit is visible — commits' own RLS (org/branch
-- membership) does the real tenancy check via this subquery.
create policy facts_select on facts
  for select to authenticated
  using (exists (select 1 from commits c where c.id = facts.commit_id));

grant select on facts to authenticated;

-- ---------------------------------------------------------------------------
-- atlas.replace_main_head_projection: the projection writer.
-- ---------------------------------------------------------------------------

create or replace function atlas.replace_main_head_projection(
  p_org_id uuid,
  p_model_id uuid,
  p_old_commit_id uuid,
  p_new_commit_id uuid,
  p_elements_head jsonb,
  p_relationships_head jsonb,
  p_facts jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Always clear the target commit's own rows first — idempotent even if
  -- called twice for the same commit_id (rebuildHead's repair path
  -- deliberately re-runs this for a commit that may already be
  -- materialised, tagged or not, to verify it's still correct).
  delete from elements_head where commit_id = p_new_commit_id;
  delete from relationships_head where commit_id = p_new_commit_id;
  delete from facts where commit_id = p_new_commit_id;

  -- gcOldHeads (SPEC §6.5): drop the *previous* head's projection rows too,
  -- unless a tag still cites them or it's the same commit just cleared
  -- above — the one thing that keeps a tagged version's projection
  -- queryable without ever walking deltas for it.
  if p_old_commit_id is not null and p_old_commit_id <> p_new_commit_id and not exists (select 1 from tags t where t.commit_id = p_old_commit_id) then
    delete from elements_head where commit_id = p_old_commit_id;
    delete from relationships_head where commit_id = p_old_commit_id;
    delete from facts where commit_id = p_old_commit_id;
  end if;

  insert into elements_head (commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id)
  select p_new_commit_id, p_org_id, p_model_id, (e ->> 'element_id')::uuid, (e ->> 'element_type')::element_type, e ->> 'name', (e ->> 'parent_id')::uuid,
    coalesce(e -> 'attributes', '{}'::jsonb), (e ->> 'exists_delta_id')::uuid
  from jsonb_array_elements(p_elements_head) as e;

  insert into relationships_head (commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id)
  select p_new_commit_id, p_org_id, p_model_id, (r ->> 'relationship_id')::uuid, (r ->> 'relationship_type')::relationship_type, (r ->> 'from_element_id')::uuid,
    (r ->> 'to_element_id')::uuid, coalesce(r -> 'attributes', '{}'::jsonb), (r ->> 'exists_delta_id')::uuid
  from jsonb_array_elements(p_relationships_head) as r;

  insert into facts (commit_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
  select p_new_commit_id, (f ->> 'subject_type')::subject_type, (f ->> 'subject_id')::uuid, f ->> 'attribute', f -> 'value', (f ->> 'delta_id')::uuid,
    (f ->> 'source_id')::uuid, f ->> 'source_ref', nullif(f ->> 'effective_date', '')::date, (f ->> 'confidence')::numeric, (f ->> 'asserted_by')::uuid,
    (f ->> 'asserted_at')::timestamptz
  from jsonb_array_elements(p_facts) as f;
end;
$$;

-- No grant to authenticated or PUBLIC: commit_deltas (below) calls this as
-- its own owner, which always has execute on functions it owns regardless
-- of grants to other roles. service_role gets it directly for a future
-- rebuildHead (a full refold-and-replace repair path, run as service role,
-- not exposed to a user session).
revoke all on function atlas.replace_main_head_projection from public;
grant execute on function atlas.replace_main_head_projection to service_role;

-- ---------------------------------------------------------------------------
-- atlas.commit_deltas: the one place a commit is written from here on.
-- ---------------------------------------------------------------------------

create or replace function atlas.commit_deltas(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_base_commit_id uuid,
  p_kind commit_kind,
  p_message text,
  p_deltas jsonb,
  p_merged_branch_head_commit_id uuid default null,
  p_elements_head jsonb default null,
  p_relationships_head jsonb default null,
  p_facts jsonb default null,
  p_head_hash text default null
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_branch_kind branch_kind;
  v_depth int;
  v_commit commits;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'commit_deltas: model % not found', p_model_id using errcode = '22023';
  end if;

  -- General gate first, before this function reveals anything about
  -- whether p_branch_id/p_base_commit_id even exist: any real membership at
  -- all. `is not true`, not `not ...`: atlas.has_role returns NULL (not
  -- false) for a non-member, since atlas.member_role's underlying query
  -- finds no row. `if not null then` is `if null then`, which PL/pgSQL
  -- treats as false and silently skips the branch — exactly backwards from
  -- "deny by default." Found by testing a non-member's call directly, not
  -- by inspection: it succeeded silently before this fix.
  if atlas.has_role(v_org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'commit_deltas: insufficient role in this organisation' using errcode = '42501';
  end if;

  select b.kind, c.depth + 1 into v_branch_kind, v_depth
  from branches b join commits c on c.id = p_base_commit_id
  where b.id = p_branch_id;
  if v_branch_kind is null then
    raise exception 'commit_deltas: base_commit_id % is not a known commit on branch %', p_base_commit_id, p_branch_id using errcode = '22023';
  end if;

  -- Permanent product decision (ADR-015, UI-principles.md §4.2): a
  -- contributor never commits to main, whether or not a branch/review-queue
  -- UI exists — only owner/architect may. A `change` branch keeps the
  -- broader role set (matching commits_insert's original rule) and must
  -- still be `draft`.
  if v_branch_kind = 'main' and atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'commit_deltas: only owners and architects may commit directly to main' using errcode = '42501';
  elsif v_branch_kind = 'change' and not exists (select 1 from branches b where b.id = p_branch_id and b.status = 'draft') then
    raise exception 'commit_deltas: branch % is not a draft change branch', p_branch_id using errcode = '42501';
  elsif v_branch_kind not in ('main', 'change') then
    raise exception 'commit_deltas: cannot commit directly to a % branch', v_branch_kind using errcode = '42501';
  end if;

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
  values (
    p_commit_id, v_org_id, p_model_id, p_branch_id, p_base_commit_id, p_merged_branch_head_commit_id, p_kind, p_message, auth.uid(), v_depth,
    case when v_branch_kind = 'main' then decode(p_head_hash, 'hex') else null end
  )
  returning * into v_commit;

  if jsonb_array_length(p_deltas) > 0 then
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
  end if;

  -- Advancing the branch head fires atlas.guard_branch_head_advance
  -- (Sprint F1 step 6, unchanged): rejects a stale/wrong parent or a
  -- non-draft branch. This is the concurrency check — commit_deltas adds no
  -- separate one, and the unique (branch_id, parent_commit_id) index above
  -- already rejects a second commit racing for the same parent at insert
  -- time, before this update is even reached.
  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  if v_branch_kind = 'main' then
    perform atlas.replace_main_head_projection(
      v_org_id, p_model_id, p_base_commit_id, p_commit_id,
      coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
    );
  end if;

  return v_commit;
end;
$$;

revoke all on function atlas.commit_deltas from public;
grant execute on function atlas.commit_deltas to authenticated;
