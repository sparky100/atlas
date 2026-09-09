-- Fixes a regression in 20260906320000_seed_from_draft_map.sql: that
-- migration's own header comment claims its `atlas.seed_from_map`
-- redefinition is "Identical to 20260906270000_commit_titles.sql's
-- version... except the one status check" — but it isn't. It silently
-- reverted commit_titles.sql's own fix (itself carried forward from
-- 20260906220000_main_always_has_head.sql, ADR-018) for the "already
-- seeded" precondition:
--
--   commit_titles.sql (correct):
--     select kind into v_head_kind from commits where id = v_head_commit_id;
--     if v_head_kind <> 'genesis' then raise ... 'already been seeded' ...
--
--   seed_from_draft_map.sql (regressed — what shipped):
--     if v_head_commit_id is not null then raise ... 'already been seeded' ...
--
-- ADR-018 (main_always_has_head.sql) made every model's main branch carry
-- a real, non-null head_commit_id from the moment it's created — the
-- genesis commit. That was the entire point of the fix this migration
-- reverted: "already seeded" has to mean "past genesis", because
-- `head_commit_id is not null` is true for a brand-new, never-seeded
-- model too. Left as `seed_from_draft_map.sql` shipped it, every single
-- call to atlas.seed_from_map fails with "model has already been seeded"
-- — the capability-map import flow is completely broken for every model,
-- always, regardless of whether it was ever actually seeded. Found live,
-- 2026-09-09, the first time a real user tried "Start from a capability
-- map" against this migration (it had never been applied anywhere, local
-- or live, until this same session's PR #21 pushed it for the first
-- time — src/db/repository.integration.test.ts's own "seed via the real
-- tailoring-flow import path" fixture would have caught this immediately
-- had it ever run against this exact function, but integration tests need
-- a real Supabase this sandbox has never had — see CLAUDE.md's own
-- verification section).
--
-- Full redefinition, not a targeted patch — same shape as the migration
-- being fixed and every other in-place function amendment in this schema.
-- Carries seed_from_draft_map.sql's own real, correct change forward
-- (published-or-draft, not published-only) alongside restoring the
-- genesis check; nothing else differs from that migration.

create or replace function atlas.seed_from_map(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
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

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, title, author_id, depth, head_hash)
  values (p_commit_id, v_org_id, p_model_id, p_branch_id, null, null, 'template_seed', p_title, auth.uid(), 0, decode(p_head_hash, 'hex'))
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
