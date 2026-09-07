-- Sprint C1-H item 2: a change branch's base_commit_id must move on a
-- refresh (SPEC §5, S-11; UI-principles §6.2's As-is/To-be/Diff selector).
--
-- atlas.commit_deltas only ever did `update branches set head_commit_id =
-- p_commit_id` — base_commit_id was set once, at fork time
-- (src/db/branches.ts's createChangeBranch), and never touched again.
-- src/db/branchProjection.ts's As-is projection folds from
-- `branch.base_commit_id`; after a refresh (p_kind = 'merge' on a change
-- branch, pulling main into it — src/db/commits.ts's caller passes main's
-- current head as p_merged_branch_head_commit_id for exactly this commit)
-- base_commit_id kept pointing at the branch's *original* fork point, so
-- As-is silently kept showing a stale main state instead of the state the
-- refresh just merged in. If main moved again after that refresh, As-is
-- would be wrong in a way nothing surfaced.
--
-- The fix: when this commit is a change branch's refresh, base_commit_id
-- becomes p_merged_branch_head_commit_id — main's head at the moment of
-- the refresh — in the same update, same transaction as head_commit_id
-- moving. Every other case (a manual commit, or any commit to main)
-- leaves base_commit_id exactly as it was.
--
-- Signature is unchanged, so no `drop function` first (SPEC §6's own note
-- on 20260906161000_merge_review_queue.sql's drop-then-create: that's only
-- needed for an arity/type change).

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
  p_head_hash text default null,
  p_resolved_conflicts jsonb default null
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

  -- Sprint H1 item 3, amended Sprint C1: a change branch now also accepts
  -- `merge` (a refresh pulling main into the branch, S-11) alongside
  -- `manual`.
  if v_branch_kind = 'main' and p_kind not in ('manual', 'merge', 'template_seed') then
    raise exception 'commit_deltas: kind % is not allowed on a main commit', p_kind using errcode = '22023';
  elsif v_branch_kind = 'change' and p_kind not in ('manual', 'merge') then
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

  if p_resolved_conflicts is not null and jsonb_array_length(p_resolved_conflicts) > 0 then
    insert into resolved_conflicts (id, org_id, model_id, winning_delta_id, discarded_delta_id, resolution_delta_id, resolved_by, rationale)
    select
      coalesce((rc ->> 'id')::uuid, gen_random_uuid()), v_org_id, p_model_id, (rc ->> 'winning_delta_id')::uuid, (rc ->> 'discarded_delta_id')::uuid,
      nullif(rc ->> 'resolution_delta_id', '')::uuid, auth.uid(), rc ->> 'rationale'
    from jsonb_array_elements(p_resolved_conflicts) as rc;
  end if;

  -- Sprint C1-H item 2: base_commit_id moves with head_commit_id when this
  -- commit is a change branch's refresh (a merge pulling main in) — every
  -- other case (manual commit, any commit to main) leaves it untouched.
  update branches
  set head_commit_id = p_commit_id,
      base_commit_id = case
        when v_branch_kind = 'change' and p_kind = 'merge' then p_merged_branch_head_commit_id
        else base_commit_id
      end
  where id = p_branch_id;

  if v_branch_kind = 'main' then
    perform atlas.replace_main_head_projection(
      v_org_id, p_model_id, p_base_commit_id, p_commit_id,
      coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
    );
  end if;

  return v_commit;
end;
$$;
