-- ADR-021 §5 item 5, C2b: "prepare, replay, decide" (§2, §3.3) as one RPC.
-- Writes up to two commits on a change branch, atomically: an optional
-- `preparation` commit (mechanical, derived from the findings alone — the
-- engine's own buildStructuralResolutions, src/engine/mergeResolution.ts,
-- already computed its exact deltas before this is ever called), then the
-- `merge` commit that replays main and carries the reviewer's actual
-- decision. `atlas.commit_deltas` itself does the real work for each —
-- this function only decides the two commits' adjacency (M's parent is P's
-- id, or the branch's own head directly when P is empty — never a
-- client-supplied value, so there is nothing for a client to get wrong
-- here) and gates the one thing commit_deltas can't check on its own: that
-- a `preparation` commit is only ever written from here.
--
-- `p_prep_commit`/`p_merge_commit` are `{id, title, deltas: [...]}` —
-- deltas already shaped the way `commit_deltas.p_deltas` expects (the
-- same wire shape `src/contracts/rows.ts`'s `envelopeToDeltaRows` already
-- produces for every other commit path). No parent field on either: this
-- function computes both parents itself (C21's adjacency guarantee, by
-- construction — there is no input shape here that could ask for a
-- mismatched one).

-- 1. Extend atlas.commit_deltas's own kind-restriction (unchanged
--    signature — same create-or-replace, only the branch-kind/kind check
--    changes) to accept 'preparation' on a change branch, but only when
--    called from this file's atlas.refresh_branch — enforced by a
--    transaction-local flag only server-side PL/pgSQL can set (a client
--    talking to PostgREST has no way to run `set_config` itself; the only
--    path that can raise this flag is the function body below).
create or replace function atlas.commit_deltas(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_base_commit_id uuid,
  p_kind commit_kind,
  p_title text,
  p_deltas jsonb,
  p_merged_branch_head_commit_id uuid default null,
  p_elements_head jsonb default null,
  p_relationships_head jsonb default null,
  p_facts jsonb default null,
  p_head_hash text default null,
  p_resolved_conflicts jsonb default null,
  p_body text default null
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

  if v_branch_kind = 'main' and p_kind not in ('manual', 'merge', 'template_seed') then
    raise exception 'commit_deltas: kind % is not allowed on a main commit', p_kind using errcode = '22023';
  elsif v_branch_kind = 'change' and p_kind not in ('manual', 'merge', 'preparation') then
    raise exception 'commit_deltas: kind % is not allowed on a change branch commit', p_kind using errcode = '22023';
  elsif v_branch_kind = 'change' and p_kind = 'preparation' and coalesce(current_setting('atlas.refresh_branch_active', true), 'off') <> 'on' then
    -- ADR-021 §2a amendment 1/C21: a preparation commit is written only by
    -- atlas.refresh_branch, never directly by a client — same restriction
    -- genesis has via on_model_created, expressed differently here because
    -- (unlike genesis) refresh_branch really does go through this same
    -- function rather than inserting the commit row itself.
    raise exception 'commit_deltas: preparation commits may only be written by atlas.refresh_branch' using errcode = '42501';
  end if;

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, title, body, author_id, depth, head_hash)
  values (
    p_commit_id, v_org_id, p_model_id, p_branch_id, p_base_commit_id, p_merged_branch_head_commit_id, p_kind, p_title, p_body, auth.uid(), v_depth,
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
      (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, nullif(d -> 'value', 'null'::jsonb), (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
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

  update branches
  set head_commit_id = p_commit_id,
      base_commit_id = case
        when v_branch_kind = 'change' and p_kind = 'merge' then p_merged_branch_head_commit_id
        else base_commit_id
      end
  where id = p_branch_id;

  if v_branch_kind = 'main' then
    if p_elements_head is null and p_relationships_head is null and p_facts is null then
      perform atlas.apply_deltas_to_main_projection(v_org_id, p_model_id, p_base_commit_id, p_commit_id, p_deltas);
    else
      perform atlas.replace_main_head_projection(
        v_org_id, p_model_id, p_base_commit_id, p_commit_id,
        coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
      );
    end if;
  end if;

  return v_commit;
end;
$$;

-- 2. The RPC itself.
create function atlas.refresh_branch(
  p_branch_id uuid,
  p_expected_head_commit_id uuid,
  p_main_head_commit_id uuid,
  p_prep_commit jsonb,
  p_merge_commit jsonb,
  p_resolved_conflicts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_model_id uuid;
  v_current_head uuid;
  v_prep_id uuid;
  v_merge_id uuid;
  v_merge_parent uuid;
  v_distinct_sources int;
begin
  -- C13: row-locked read, same pattern atlas.merge_branch already uses on
  -- merge_requests — a concurrent refresh_branch call on the same branch
  -- blocks here until this transaction finishes, then re-reads the
  -- now-current head rather than a stale snapshot.
  select b.org_id, b.model_id, b.head_commit_id into v_org_id, v_model_id, v_current_head
  from branches b where b.id = p_branch_id for update;

  if v_org_id is null then
    return jsonb_build_object('status', 'invalid', 'reason', format('branch %s not found', p_branch_id));
  end if;

  if v_current_head is distinct from p_expected_head_commit_id then
    return jsonb_build_object('status', 'stale_head');
  end if;

  if not exists (
    select 1 from commits c
    join branches b on b.id = c.branch_id
    where c.id = p_main_head_commit_id and b.model_id = v_model_id and b.kind = 'main'
  ) then
    return jsonb_build_object('status', 'invalid', 'reason', 'p_main_head_commit_id is not a commit on this model''s main branch');
  end if;

  -- C21: preparation and merge share one merge_resolution source — checked
  -- across both commits' own deltas (resolved_conflicts rows reference
  -- delta ids, not a source of their own, so they need no check here).
  select count(distinct source_id) into v_distinct_sources
  from (
    select (d ->> 'source_id')::uuid as source_id from jsonb_array_elements(coalesce(p_prep_commit -> 'deltas', '[]'::jsonb)) d
    union all
    select (d ->> 'source_id')::uuid from jsonb_array_elements(coalesce(p_merge_commit -> 'deltas', '[]'::jsonb)) d
  ) s;
  if v_distinct_sources > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'preparation and merge commit deltas must share one merge_resolution source');
  end if;

  begin
    if p_prep_commit is not null then
      v_prep_id := (p_prep_commit ->> 'id')::uuid;
      perform set_config('atlas.refresh_branch_active', 'on', true);
      perform atlas.commit_deltas(
        p_commit_id => v_prep_id,
        p_model_id => v_model_id,
        p_branch_id => p_branch_id,
        p_base_commit_id => p_expected_head_commit_id,
        p_kind => 'preparation',
        p_title => p_prep_commit ->> 'title',
        p_deltas => p_prep_commit -> 'deltas'
      );
      perform set_config('atlas.refresh_branch_active', 'off', true);
      v_merge_parent := v_prep_id;
    else
      v_prep_id := null;
      v_merge_parent := p_expected_head_commit_id;
    end if;

    v_merge_id := (p_merge_commit ->> 'id')::uuid;
    perform atlas.commit_deltas(
      p_commit_id => v_merge_id,
      p_model_id => v_model_id,
      p_branch_id => p_branch_id,
      p_base_commit_id => v_merge_parent,
      p_kind => 'merge',
      p_title => p_merge_commit ->> 'title',
      p_deltas => p_merge_commit -> 'deltas',
      p_merged_branch_head_commit_id => p_main_head_commit_id,
      p_resolved_conflicts => p_resolved_conflicts
    );
  exception
    when unique_violation or check_violation then
      -- Backstop for the same race the row lock above already guards
      -- against in practice (commits_branch_id_parent_commit_id_idx, or
      -- atlas.guard_branch_head_advance's own check) — converted to a
      -- status, not a raised error, matching atlas.merge_branch's own
      -- REFRESH_REQUIRED convention: the whole transaction still rolls
      -- back either way (a PL/pgSQL exception block does not commit
      -- partial work — everything this call did is undone), this only
      -- changes what the caller sees.
      return jsonb_build_object('status', 'stale_head');
  end;

  return jsonb_build_object('status', 'ok', 'prepCommitId', v_prep_id, 'mergeCommitId', v_merge_id);
end;
$$;

revoke all on function atlas.refresh_branch from public;
grant execute on function atlas.refresh_branch to authenticated;
