-- Sprint U2 step 2: atlas.seed_from_map — the tailoring flow's "import"
-- action (SPEC-data-model.md §3.10/§5.1, ADR-012).
--
-- src/db/repository.integration.test.ts's beforeAll has, since Sprint U1
-- step 3a, hand-inserted a model's genesis commit as service_role with the
-- comment "standing in for the not-yet-built atlas.seed_from_map ...
-- actually writing main's first commit is future work". This migration is
-- that function. The stand-in is replaced in this same step (see that
-- file's diff) to call the real thing.
--
-- Why this is a separate function from atlas.commit_deltas, not an
-- extension of it:
--   1. Genesis is structurally different. commit_deltas's branch/depth
--      lookup is `join commits c on c.id = p_base_commit_id` — deliberately
--      requires a real existing base commit (every non-genesis commit has
--      one). A capability-map import's whole point is that no commit
--      exists yet (SPEC §5.1: "the first commit of a model seeded from a
--      capability map"); reusing that lookup for a null base would need a
--      parallel no-base branch through the same function, at which point
--      it is two functions wearing one name.
--   2. It writes tables commit_deltas never touches. Seeding also creates
--      one `sources` row (kind = 'template') and one `aliases` row per
--      seeded element (alias_type = 'template_code', SPEC §3.10) — both
--      RLS-restricted to system paths for exactly this reason
--      (20260906071500_sources_and_aliases.sql's own RLS comments: "template
--      aliases/sources come from capability-map seeding ... a system path,
--      not a direct authenticated insert"). commit_deltas has no reason to
--      ever write those tables for a normal edit; bolting seeding-only
--      columns onto its signature would make every ordinary call carry
--      dead parameters.
--
-- What it does NOT do: recompute deltas from capability_map_items itself.
-- Same division of labour as commit_deltas (see that function's own
-- comment) — the client reads capability_map_items (already
-- `authenticated`-readable), builds one `element.create` delta per item
-- through the same tested TS engine (src/engine/deltas.ts's `fold`, from
-- `emptyHead()`), and this function just persists the result atomically:
-- the commit, its deltas, the materialised projection, the template
-- source, and the per-element template_code aliases, plus advancing main's
-- head from null to the new commit — all in one transaction, so a failure
-- partway through (a rejected alias, a bad head_hash) leaves nothing
-- written rather than an elements_head with no aliases to match it.
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
  v_map_status map_status;
  v_commit commits;
begin
  select org_id into v_org_id from models where id = p_model_id;
  if v_org_id is null then
    raise exception 'seed_from_map: model % not found', p_model_id using errcode = '22023';
  end if;

  -- Same role gate as commit_deltas's main-branch case (ADR-015): only
  -- owner/architect may seed a model, same as only owner/architect may
  -- otherwise commit directly to main.
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
  -- §5.1) — literally the first: a model is seeded once, at most, ever.
  -- Later tailoring (rename/delete/add) is ordinary `manual` commits on
  -- top of this one, not a second seed.
  if v_head_commit_id is not null then
    raise exception 'seed_from_map: model % has already been seeded (main already has a head commit)', p_model_id using errcode = '42501';
  end if;

  -- Defence in depth: the import picker only ever offers published maps
  -- (src/db/capabilityMapTemplates.ts), but this function does not trust
  -- that a client actually used it.
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

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, message, author_id, depth, head_hash)
  values (p_commit_id, v_org_id, p_model_id, p_branch_id, null, null, 'template_seed', p_message, auth.uid(), 0, decode(p_head_hash, 'hex'))
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

  -- guard_branch_head_advance (unchanged) already handles this null-safely:
  -- `new.head_commit_id is not distinct from old.head_commit_id` and the
  -- existence check's `c.parent_commit_id is not distinct from
  -- old.head_commit_id` both treat NULL correctly, so genesis needs no
  -- special case there.
  update branches set head_commit_id = p_commit_id where id = p_branch_id;

  perform atlas.replace_main_head_projection(
    v_org_id, p_model_id, null, p_commit_id, coalesce(p_elements_head, '[]'::jsonb), '[]'::jsonb, coalesce(p_facts, '[]'::jsonb)
  );

  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  select (a ->> 'id')::uuid, v_org_id, p_model_id, (a ->> 'element_id')::uuid, a ->> 'alias_value', 'template_code', p_source_id, (a ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_aliases) as a;

  return v_commit;
end;
$$;

revoke all on function atlas.seed_from_map from public;
grant execute on function atlas.seed_from_map to authenticated;
