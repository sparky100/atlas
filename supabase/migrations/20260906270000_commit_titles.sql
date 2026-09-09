-- Sprint U4-1 B1: commit titles are generated from the deltas
-- (src/engine/describeEnvelope.ts), not typed by hand — "Add relationship"
-- told a reader nothing an activity feed or a diff page could act on;
-- "Link PowerON supports Outage & Fault Management" does. `message` is
-- renamed to `title` to match (a generated title is a different thing from
-- a caller-typed message, and the product-facing language everywhere else
-- — B2's activity rows, this sprint's own brief — already calls it a
-- title); the string a hook used to hand-write becomes the new, optional
-- `body` column instead of being thrown away.
--
-- Every function that writes `commits` directly (not through a later
-- `create or replace`, which already has the up-to-date column list)
-- has to be recreated here with the new column/param names, or it starts
-- failing at runtime the moment `message` stops existing:
--   - atlas.commit_deltas   (current version: 20260906250000)
--   - atlas.merge_branch    (current version: 20260906161000; forwards its
--     own `p_message` straight through to commit_deltas)
--   - atlas.on_model_created (current version: 20260906220000; inserts the
--     literal genesis title 'Genesis' — zero deltas, nothing for
--     describeEnvelope to describe)
--   - atlas.seed_from_map   (current version: 20260906220000)
-- `merge_branch`/`on_model_created`/`seed_from_map` only rename a param or
-- a column reference in place — same argument types, same count — so
-- `create or replace` alone carries their existing grants across
-- (20260906250000's own precedent for a signature-unchanged replace).
-- `commit_deltas` gains a new trailing `p_body` parameter, which
-- `create or replace` cannot do to an existing function (Postgres rejects
-- changing a function's argument list that way) — `drop function` first,
-- same as 20260906161000_merge_review_queue.sql did the last time this
-- function's own argument list changed (there, adding `p_resolved_conflicts`),
-- and the same reason its grants need restating below: a drop wipes them.

alter table commits rename column message to title;
alter table commits add column body text;

comment on column commits.title is 'Generated from the commit''s own deltas (src/engine/describeEnvelope.ts) for every manual commit; merge/template_seed/genesis commits keep their own domain-specific phrasing instead (Sprint U4-1 B1).';
comment on column commits.body is 'Optional elaboration a caller supplies alongside the generated title. Nothing writes a real one yet — every current caller passes what used to be the whole message, verbatim, as a nice-to-keep fallback — but the column exists so a future free-text note has somewhere to go without another migration.';

drop function if exists atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text, jsonb);

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
  elsif v_branch_kind = 'change' and p_kind not in ('manual', 'merge') then
    raise exception 'commit_deltas: kind % is not allowed on a change branch commit', p_kind using errcode = '22023';
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
    perform atlas.replace_main_head_projection(
      v_org_id, p_model_id, p_base_commit_id, p_commit_id,
      coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
    );
  end if;

  return v_commit;
end;
$$;

revoke all on function atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text, jsonb, text) from public;
grant execute on function atlas.commit_deltas(uuid, uuid, uuid, uuid, commit_kind, text, jsonb, uuid, jsonb, jsonb, jsonb, text, jsonb, text) to authenticated;

-- Same reason as commit_deltas above: `create or replace function` cannot
-- rename an existing parameter (Postgres 42P13, "cannot change name of
-- input parameter") — only the argument *types* and *count* are allowed to
-- stay fixed for a bare replace. `p_message` -> `p_title` is a rename at
-- the same position/type, which still hits this, and was missed here on
-- first write (only commit_deltas's own signature-widening case was
-- handled) — found applying this migration for the first time, ever, to
-- any database, so fixed in place rather than left broken in history for
-- a follow-up migration nothing has depended on yet.
drop function if exists atlas.merge_branch(uuid, uuid, text, jsonb, jsonb, jsonb, text);

create or replace function atlas.merge_branch(
  p_merge_request_id uuid,
  p_commit_id uuid,
  p_title text,
  p_elements_head jsonb default '[]'::jsonb,
  p_relationships_head jsonb default '[]'::jsonb,
  p_facts jsonb default '[]'::jsonb,
  p_head_hash text default null
)
returns commits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req merge_requests;
  v_branch branches;
  v_main branches;
  v_commit commits;
begin
  select * into v_req from merge_requests where id = p_merge_request_id for update;
  if v_req.id is null then
    raise exception 'merge_branch: merge request % not found', p_merge_request_id using errcode = '22023';
  end if;
  if atlas.has_role(v_req.org_id, 'owner', 'architect') is not true then
    raise exception 'merge_branch: only owners and architects may merge' using errcode = '42501';
  end if;
  if v_req.status <> 'approved' then
    raise exception 'merge_branch: merge request % is not approved (status %)', p_merge_request_id, v_req.status using errcode = '42501';
  end if;

  select * into v_branch from branches where id = v_req.branch_id;
  select * into v_main from branches where model_id = v_req.model_id and kind = 'main';

  if not atlas.branch_reaches_commit(v_req.branch_id, v_main.head_commit_id) then
    update merge_requests set status = 'pending' where id = p_merge_request_id;
    update branches set status = 'proposed' where id = v_req.branch_id;
    return null;
  end if;

  v_commit := atlas.commit_deltas(
    p_commit_id => p_commit_id,
    p_model_id => v_req.model_id,
    p_branch_id => v_main.id,
    p_base_commit_id => v_main.head_commit_id,
    p_kind => 'merge',
    p_title => p_title,
    p_deltas => '[]'::jsonb,
    p_merged_branch_head_commit_id => v_branch.head_commit_id,
    p_elements_head => p_elements_head,
    p_relationships_head => p_relationships_head,
    p_facts => p_facts,
    p_head_hash => p_head_hash
  );

  update merge_requests set status = 'merged', merge_commit_id = v_commit.id, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_merge_request_id;

  -- ADR-006: the branch becomes merged and read-only, never deleted, so its
  -- own as-is/to-be history stays queryable exactly as it looked when
  -- reviewed.
  update branches set status = 'merged' where id = v_req.branch_id;

  return v_commit;
end;
$$;

-- The drop above wipes merge_branch's own grants (same reasoning as
-- commit_deltas's restatement above it) — restated identically to
-- 20260906161000_merge_review_queue.sql's original grant.
revoke all on function atlas.merge_branch(uuid, uuid, text, jsonb, jsonb, jsonb, text) from public;
grant execute on function atlas.merge_branch(uuid, uuid, text, jsonb, jsonb, jsonb, text) to authenticated;

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
  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, title, author_id, depth, head_hash)
  values (v_commit_id, new.org_id, new.id, v_branch_id, null, null, 'genesis', 'Genesis', new.created_by, 0, null);

  insert into branches (id, org_id, model_id, name, kind, status, base_commit_id, head_commit_id, shared_for_review, created_by, updated_at)
  values (v_branch_id, new.org_id, new.id, 'main', 'main', 'draft', v_commit_id, v_commit_id, false, new.created_by, now());

  return new;
end;
$$;

-- Same rename-hits-42P13 fix as merge_branch above: p_message -> p_title
-- at the same position/type.
drop function if exists atlas.seed_from_map(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text);

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
    v_org_id, p_model_id, v_head_commit_id, p_commit_id, coalesce(p_elements_head, '[]'::jsonb), '[]'::jsonb, coalesce(p_facts, '[]'::jsonb)
  );

  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  select (a ->> 'id')::uuid, v_org_id, p_model_id, (a ->> 'element_id')::uuid, a ->> 'alias_value', 'template_code', p_source_id, (a ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_aliases) as a;

  return v_commit;
end;
$$;

-- Same reasoning as merge_branch's restatement above: the drop wipes
-- seed_from_map's own grants, restated identically to
-- 20260906120000_seed_from_map.sql's original grant.
revoke all on function atlas.seed_from_map(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text) from public;
grant execute on function atlas.seed_from_map(uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text) to authenticated;
