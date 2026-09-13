-- E3 (docs/prompts/atlas-prompt-pack.md): "Replace the client-computed
-- head on main commits with server-side application of the commit's
-- deltas to elements_head/relationships_head/facts inside commit_deltas
-- ... Payload per commit becomes the deltas only."
--
-- ADR-015 already named this exact upgrade path and drew its boundary
-- precisely: this is NOT a from-scratch SQL reimplementation of `fold`'s
-- full delta-application semantics (validation, merge classification,
-- invariant checking — ADR-015's "Alternatives rejected" explicitly rules
-- that out, and it stays true here: `src/db/commits.ts`'s own client-side
-- `fold` still runs first, unchanged, and still rejects an invalid commit
-- before it ever reaches this function). What moves is *where* an
-- already-validated, already-ordered delta list gets applied to the
-- projection: previously the client computed the whole new head and sent
-- it as data; now this function copies the previous commit's own
-- elements_head/relationships_head/facts rows forward under the new
-- commit id and applies just this commit's own deltas on top — the same
-- "load(parent) then applyAll the new deltas" shape SPEC §6.5 already
-- describes as the incremental-rebuild path, now living in SQL instead of
-- only in `src/engine/head.ts`'s resume-point optimisation.
--
-- Scope, stated plainly rather than silently narrowed: this function
-- covers element.create/update/retract and relationship.create/update/
-- retract — exactly the three actions E8's own perf measurement names
-- (add system, add relationship, save attribute) and the common editing
-- path generally. A commit containing an element.restore or
-- relationship.restore delta is NOT covered: restoring something retracted
-- in an *earlier* commit needs that attribute's last-known value
-- reconstructed from the full delta history on this model (`deltas` is
-- append-only, CLAUDE.md rule 5, but `facts`/`elements_head`/
-- `relationships_head` are not — a retract already deleted the live rows
-- this function would otherwise copy forward), which is a materially
-- harder problem than applying a create/update/retract on top of a
-- known-live snapshot. `src/db/commits.ts` still falls back to sending
-- the full client-computed projection (the pre-E3 path, unchanged) for
-- any commit that contains a restore delta — retract/restore's own
-- round-trip integration coverage (`deltas.property.test.ts`) is
-- completely unaffected either way, since that suite exercises
-- `src/engine`'s own TypeScript apply/fold directly, never this function.
--
-- `apply`'s own doc comment (`src/engine/deltas.ts`) states its trust
-- model: "Assumes delta is valid against head (C1-C16 already checked ...)
-- this function's job is to fold, not to police; it throws only on the
-- internal inconsistencies ... that would mean it was called on invalid
-- input." This function keeps exactly that boundary: it re-checks a
-- retract's own subject-exists guard and C8 (no live relationship may
-- still reference a retracted element) — the two internal-consistency
-- guards `apply` itself bakes in beyond raw mutation — and deliberately
-- does not re-derive C9/C17/C18/C20 (relationship-type rules, primary-
-- supports/owns cardinality, integration-platform `via`, external-owner
-- role), which the client's own `fold` already enforced before this
-- commit was ever sent.
create or replace function atlas.apply_deltas_to_main_projection(
  p_org_id uuid,
  p_model_id uuid,
  p_old_commit_id uuid,
  p_new_commit_id uuid,
  p_deltas jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec record;
begin
  -- Defensive re-run safety, matching atlas.replace_main_head_projection's
  -- own convention: a brand-new commit id should never already have
  -- projection rows, but clearing them first costs nothing and makes this
  -- function idempotent if it were ever re-run against the same commit.
  delete from elements_head where commit_id = p_new_commit_id;
  delete from relationships_head where commit_id = p_new_commit_id;
  delete from facts where commit_id = p_new_commit_id;

  -- Copy the previous head forward, verbatim, under the new commit id —
  -- the same "one full snapshot per commit" shape every projection row's
  -- own (commit_id, ...) primary key already commits this schema to;
  -- what's new is reading that snapshot from the *previous commit's own
  -- rows* instead of a client-computed jsonb payload.
  insert into elements_head (commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id)
  select p_new_commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id
  from elements_head where commit_id = p_old_commit_id;

  insert into relationships_head (commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id)
  select p_new_commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id
  from relationships_head where commit_id = p_old_commit_id;

  insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
  select p_new_commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at
  from facts where commit_id = p_old_commit_id;

  -- Apply each of this commit's own deltas on top of the just-copied
  -- snapshot, in array order — `src/engine/deltas.ts`'s `fold` does
  -- exactly this ("no interdependency resolution beyond order"), so this
  -- loop mirrors it delta-kind for delta-kind. `d ->> 'kind'` is one of
  -- the eight `delta_kind` enum values `commit_deltas`'s own deltas
  -- insert already casts to (`element_create`, `element_update`, ...) —
  -- this reads the very same `p_deltas` jsonb the caller is inserting
  -- into `deltas`, so both stay in lockstep by construction.
  for v_rec in
    select
      (d ->> 'id')::uuid as delta_id,
      d ->> 'kind' as kind,
      (d ->> 'subject_id')::uuid as subject_id,
      d ->> 'attribute' as attribute,
      nullif(d ->> 'element_type', '')::element_type as element_type,
      nullif(d ->> 'relationship_type', '')::relationship_type as relationship_type,
      d ->> 'name' as name,
      (d ->> 'parent_id')::uuid as parent_id,
      (d ->> 'from_element_id')::uuid as from_element_id,
      (d ->> 'to_element_id')::uuid as to_element_id,
      nullif(d -> 'value', 'null'::jsonb) as value,
      (d ->> 'source_id')::uuid as source_id,
      d ->> 'source_ref' as source_ref,
      nullif(d ->> 'effective_date', '')::date as effective_date,
      (d ->> 'confidence')::numeric as confidence
    from jsonb_array_elements(p_deltas) with ordinality as t (d, ord)
    order by ord
  loop
    if v_rec.kind = 'element_create' then
      -- `src/contracts/rows.ts`'s `toDeltaRow`: an element.create's whole
      -- `attributes` object is the wire delta's own `value` (attribute
      -- column is the `$exists` sentinel) — mirrors `apply`'s
      -- `element.create` case, which shallow-copies `delta.attributes`
      -- into the new row wholesale.
      insert into elements_head (commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id)
      values (p_new_commit_id, p_org_id, p_model_id, v_rec.subject_id, v_rec.element_type, v_rec.name, v_rec.parent_id, coalesce(v_rec.value, '{}'::jsonb), v_rec.delta_id);

      -- Facts: $exists, name, parentId, plus one per key in the initial
      -- attributes object — `apply`'s own `setFact` calls inside its
      -- `element.create` case, one-for-one.
      insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
      select p_new_commit_id, p_org_id, p_model_id, 'element'::subject_type, v_rec.subject_id, x.attribute, x.value, v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d,
        lateral (
          values
            ('$exists', jsonb_build_object('type', v_rec.element_type, 'name', v_rec.name, 'parentId', to_jsonb(v_rec.parent_id))),
            ('name', to_jsonb(v_rec.name)),
            ('parentId', to_jsonb(v_rec.parent_id))
        ) as x (attribute, value)
      where d.id = v_rec.delta_id
      union all
      select p_new_commit_id, p_org_id, p_model_id, 'element'::subject_type, v_rec.subject_id, a.key, a.value, v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d, jsonb_each(coalesce(v_rec.value, '{}'::jsonb)) as a (key, value)
      where d.id = v_rec.delta_id;

    elsif v_rec.kind = 'element_update' then
      -- `apply`'s own `element.update` case: `name`/`parentId` are
      -- promoted columns (mutated directly), never jsonb attribute keys;
      -- every other attribute is a single-key write into `attributes` —
      -- add/overwrite for a non-null value, `Reflect.deleteProperty` (here:
      -- the `-` operator) for a null one.
      if v_rec.attribute = 'name' then
        update elements_head set name = v_rec.value #>> '{}' where commit_id = p_new_commit_id and element_id = v_rec.subject_id;
      elsif v_rec.attribute = 'parentId' then
        update elements_head set parent_id = (v_rec.value #>> '{}')::uuid where commit_id = p_new_commit_id and element_id = v_rec.subject_id;
      elsif v_rec.value is null then
        update elements_head set attributes = attributes - v_rec.attribute where commit_id = p_new_commit_id and element_id = v_rec.subject_id;
      else
        update elements_head set attributes = jsonb_set(attributes, array[v_rec.attribute], v_rec.value, true) where commit_id = p_new_commit_id and element_id = v_rec.subject_id;
      end if;

      insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
      select p_new_commit_id, p_org_id, p_model_id, 'element'::subject_type, v_rec.subject_id, v_rec.attribute, v_rec.value, v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d where d.id = v_rec.delta_id
      on conflict (commit_id, subject_id, attribute) do update set
        value = excluded.value, delta_id = excluded.delta_id, source_id = excluded.source_id, source_ref = excluded.source_ref,
        effective_date = excluded.effective_date, confidence = excluded.confidence, asserted_by = excluded.asserted_by, asserted_at = excluded.asserted_at;

    elsif v_rec.kind = 'element_retract' then
      -- `apply`'s own two internal-consistency guards for retract (its
      -- doc comment: the checks it bakes in beyond raw mutation) — a
      -- missing subject, and C8 (no live relationship may still reference
      -- the element being retracted).
      if not exists (select 1 from elements_head where commit_id = p_new_commit_id and element_id = v_rec.subject_id) then
        raise exception 'apply_deltas_to_main_projection: element.retract % does not exist in this head', v_rec.subject_id using errcode = '22023';
      end if;
      if exists (
        select 1 from relationships_head
        where commit_id = p_new_commit_id and (from_element_id = v_rec.subject_id or to_element_id = v_rec.subject_id)
      ) then
        raise exception 'apply_deltas_to_main_projection: element.retract % still has a live relationship referencing it (C8)', v_rec.subject_id using errcode = '22023';
      end if;
      -- `elements_head`'s own row is deleted outright (no soft-delete/
      -- tombstone column) and every live fact for the subject is wiped —
      -- `apply`'s own `deleteAllFactsFor`, exactly.
      delete from elements_head where commit_id = p_new_commit_id and element_id = v_rec.subject_id;
      delete from facts where commit_id = p_new_commit_id and subject_id = v_rec.subject_id;

    elsif v_rec.kind = 'relationship_create' then
      insert into relationships_head (commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id)
      values (p_new_commit_id, p_org_id, p_model_id, v_rec.subject_id, v_rec.relationship_type, v_rec.from_element_id, v_rec.to_element_id, coalesce(v_rec.value, '{}'::jsonb), v_rec.delta_id);

      insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
      select p_new_commit_id, p_org_id, p_model_id, 'relationship'::subject_type, v_rec.subject_id, '$exists', jsonb_build_object('type', v_rec.relationship_type, 'fromElementId', v_rec.from_element_id, 'toElementId', v_rec.to_element_id), v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d where d.id = v_rec.delta_id
      union all
      select p_new_commit_id, p_org_id, p_model_id, 'relationship'::subject_type, v_rec.subject_id, a.key, a.value, v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d, jsonb_each(coalesce(v_rec.value, '{}'::jsonb)) as a (key, value)
      where d.id = v_rec.delta_id;

    elsif v_rec.kind = 'relationship_update' then
      -- No promoted columns for a relationship (endpoints are immutable) —
      -- every attribute goes straight into `attributes`.
      if v_rec.value is null then
        update relationships_head set attributes = attributes - v_rec.attribute where commit_id = p_new_commit_id and relationship_id = v_rec.subject_id;
      else
        update relationships_head set attributes = jsonb_set(attributes, array[v_rec.attribute], v_rec.value, true) where commit_id = p_new_commit_id and relationship_id = v_rec.subject_id;
      end if;

      insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
      select p_new_commit_id, p_org_id, p_model_id, 'relationship'::subject_type, v_rec.subject_id, v_rec.attribute, v_rec.value, v_rec.delta_id, v_rec.source_id, v_rec.source_ref, v_rec.effective_date, v_rec.confidence, d.created_by, d.created_at
      from deltas d where d.id = v_rec.delta_id
      on conflict (commit_id, subject_id, attribute) do update set
        value = excluded.value, delta_id = excluded.delta_id, source_id = excluded.source_id, source_ref = excluded.source_ref,
        effective_date = excluded.effective_date, confidence = excluded.confidence, asserted_by = excluded.asserted_by, asserted_at = excluded.asserted_at;

    elsif v_rec.kind = 'relationship_retract' then
      if not exists (select 1 from relationships_head where commit_id = p_new_commit_id and relationship_id = v_rec.subject_id) then
        raise exception 'apply_deltas_to_main_projection: relationship.retract % does not exist in this head', v_rec.subject_id using errcode = '22023';
      end if;
      delete from relationships_head where commit_id = p_new_commit_id and relationship_id = v_rec.subject_id;
      delete from facts where commit_id = p_new_commit_id and subject_id = v_rec.subject_id;

    else
      -- element_restore / relationship_restore (or any future kind this
      -- function hasn't been taught) — see this function's own header
      -- comment for why restore is out of scope. `src/db/commits.ts` is
      -- responsible for never calling this function with a restore delta
      -- in the list; this is the internal-consistency backstop if it ever
      -- did.
      raise exception 'apply_deltas_to_main_projection: % is not supported by incremental apply — the caller must send a full computed projection for a commit containing a restore delta', v_rec.kind using errcode = '22023';
    end if;
  end loop;

  -- Same old-commit GC atlas.replace_main_head_projection already does:
  -- once nothing points at the previous commit's own projection rows any
  -- more and it isn't tagged, they're dead weight.
  if p_old_commit_id is not null and p_old_commit_id <> p_new_commit_id and not exists (select 1 from tags t where t.commit_id = p_old_commit_id) then
    delete from elements_head where commit_id = p_old_commit_id;
    delete from relationships_head where commit_id = p_old_commit_id;
    delete from facts where commit_id = p_old_commit_id;
  end if;
end;
$$;

revoke all on function atlas.apply_deltas_to_main_projection(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function atlas.apply_deltas_to_main_projection(uuid, uuid, uuid, uuid, jsonb) to service_role;

-- commit_deltas now takes the incremental path whenever the caller omits
-- all three of p_elements_head/p_relationships_head/p_facts (leaves them
-- at their default null) — src/db/commits.ts only does that when the
-- commit has no restore delta in it (see that file's own comment).
-- Passing them (even as explicit empty arrays) keeps the old, full-
-- projection path — merge_branch and seed_from_map both still do this
-- unconditionally and are unaffected by this migration.
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
