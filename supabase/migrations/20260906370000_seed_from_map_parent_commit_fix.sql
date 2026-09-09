-- Second half of the bug 20260906360000 partially fixed. That migration
-- restored the genesis check (v_head_kind <> 'genesis'), which had been
-- masking THIS bug: atlas.seed_from_map has hardcoded `parent_commit_id =
-- null, depth = 0` for its own commit insert since
-- 20260906320000_seed_from_draft_map.sql shipped — a second regression in
-- that same migration, alongside the genesis-check one. main's head is
-- never null (ADR-018) — a genesis-only model's head is the genesis
-- commit, not nothing — so `branches_guard_head_advance`
-- (20260906071800_branch_head_advance.sql) rejects the resulting `update
-- branches set head_commit_id = p_commit_id`: the new head's own
-- `parent_commit_id` (null) never equals the branch's real current head
-- (the genesis commit's id). Found live, 2026-09-09, the moment
-- 20260906360000's fix let a real seed attempt reach this far for the
-- first time — before that fix, every attempt died earlier at the
-- (wrongly) unconditional "already been seeded" check, so this half of
-- the regression had never been exercised either.
--
-- 20260906270000_commit_titles.sql's own version already had the correct
-- shape (`parent_commit_id = v_head_commit_id`, `depth = 1`) — this
-- restores exactly that, verbatim, plus one deliberate hardening
-- `seed_from_draft_map.sql`'s own header comment described as its intent
-- but the code never actually added: an explicit client-supplied
-- `p_expected_head_commit_id`, checked against the freshly-read head
-- before it's trusted as the new commit's parent. `atlas.commit_deltas`
-- takes its own client-supplied base commit id the same way
-- (src/db/commits.ts's own `expectedHeadCommitId`) and relies on the
-- trigger alone to reject a stale one; this goes one step further and
-- raises its own clear error first, rather than surfacing the trigger's
-- generic "head_commit_id must advance..." text to a caller that passed
-- a head it never actually fetched.

drop function if exists atlas.seed_from_map(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text);

create or replace function atlas.seed_from_map(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_expected_head_commit_id uuid,
  p_title text,
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

  -- Optimistic concurrency: v_head_commit_id, just read inside this same
  -- transaction, is the real current head — if it differs from what the
  -- client fetched and expected, main moved underneath this call (ADR-018
  -- means "moved" here can only mean "someone else already seeded it, or
  -- committed to it, since"). Rejecting here, with a clear message, beats
  -- letting branches_guard_head_advance's generic error surface instead.
  if v_head_commit_id is distinct from p_expected_head_commit_id then
    raise exception 'seed_from_map: branch % has moved since expectedHeadCommitId % was read (now %) — refresh and retry', p_branch_id, p_expected_head_commit_id, v_head_commit_id using errcode = '23514';
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

  -- Defence in depth: the import picker only ever offers published or
  -- draft maps (src/db/capabilityMapTemplates.ts's
  -- listSeedableCapabilityMaps, Sprint U4-1 C6), never a deprecated one —
  -- but this function does not trust that a client actually used it.
  select status into v_map_status from capability_maps where id = p_capability_map_id;
  if v_map_status is null then
    raise exception 'seed_from_map: capability map % not found', p_capability_map_id using errcode = '22023';
  end if;
  if v_map_status not in ('published', 'draft') then
    raise exception 'seed_from_map: capability map % is %, not published or draft', p_capability_map_id, v_map_status using errcode = '42501';
  end if;

  if jsonb_array_length(p_deltas) = 0 then
    raise exception 'seed_from_map: a seed commit needs at least one delta' using errcode = '22023';
  end if;

  insert into sources (id, org_id, model_id, kind, name, capability_map_id, created_by)
  values (p_source_id, v_org_id, p_model_id, 'template', p_source_name, p_capability_map_id, auth.uid());

  -- parent_commit_id is v_head_commit_id (the real, just-verified current
  -- head — the genesis commit, for every real-world call), never null.
  -- depth is 1: the seed commit sits one below genesis (depth 0), the
  -- same "parent's depth + 1" every other commit path computes
  -- (commit_deltas's own `c.depth + 1`) — genesis is the only commit kind
  -- ever allowed depth 0 or a null parent.
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, title, author_id, depth, head_hash)
  values (p_commit_id, v_org_id, p_model_id, p_branch_id, v_head_commit_id, null, 'template_seed', p_title, auth.uid(), 1, decode(p_head_hash, 'hex'))
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
