-- Sprint H1 item 3 (docs/AUDIT-2026-09-U2.md §2.E.3 item 14): atlas.commit_deltas
-- placed no restriction at all on p_kind — the kind in ('manual', 'merge')
-- restriction SPEC §9.3's commits_insert policy states only applies to a
-- *direct* table insert, which commit_deltas (security definer) bypasses
-- entirely. Restricting it here, in the one function that actually writes
-- commits now, is the real gate; the RLS policy's own restriction was
-- already dead code for any commit_deltas-driven write.
--
-- Per SPEC §5.1's kind descriptions: `main` accepts manual (owner/architect
-- editing directly), merge (a future approved-change merge, ADR-006 —
-- not yet built, but commit_deltas is already named as where it will land,
-- §5.3's implementation note), and template_seed (a model's genesis commit
-- via atlas.seed_from_map, which does not call commit_deltas itself, but
-- the kind exists in commit_kind and CommitKind either way). `change`
-- accepts manual only for now: a refresh (a merge commit pulling main into
-- a change branch, S-11) is real SPEC design but has no product path yet
-- (no branch/review-queue UI, ADR-015's own note) — allowing it here before
-- anything produces one would be untested surface, not a completed feature.

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

  if atlas.has_role(v_org_id, 'owner', 'architect', 'contributor') is not true then
    raise exception 'commit_deltas: insufficient role in this organisation' using errcode = '42501';
  end if;

  select b.kind, c.depth + 1 into v_branch_kind, v_depth
  from branches b join commits c on c.id = p_base_commit_id
  where b.id = p_branch_id;
  if v_branch_kind is null then
    raise exception 'commit_deltas: base_commit_id % is not a known commit on branch %', p_base_commit_id, p_branch_id using errcode = '22023';
  end if;

  if v_branch_kind = 'main' and atlas.has_role(v_org_id, 'owner', 'architect') is not true then
    raise exception 'commit_deltas: only owners and architects may commit directly to main' using errcode = '42501';
  elsif v_branch_kind = 'change' and not exists (select 1 from branches b where b.id = p_branch_id and b.status = 'draft') then
    raise exception 'commit_deltas: branch % is not a draft change branch', p_branch_id using errcode = '42501';
  elsif v_branch_kind not in ('main', 'change') then
    raise exception 'commit_deltas: cannot commit directly to a % branch', v_branch_kind using errcode = '42501';
  end if;

  -- Sprint H1 item 3: p_kind restricted by branch kind.
  if v_branch_kind = 'main' and p_kind not in ('manual', 'merge', 'template_seed') then
    raise exception 'commit_deltas: kind % is not allowed on a main commit', p_kind using errcode = '22023';
  elsif v_branch_kind = 'change' and p_kind <> 'manual' then
    raise exception 'commit_deltas: kind % is not allowed on a change branch commit', p_kind using errcode = '22023';
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
