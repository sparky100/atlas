-- Sprint H1 (audit fixes, docs/AUDIT-2026-09-U2.md):
--
-- 1. atlas.replace_main_head_projection no longer trusts the client-sent
--    `asserted_by`/`asserted_at` inside p_facts (§2.E.3 item 15). Every
--    other author-shaped column this function's caller (atlas.commit_deltas)
--    writes — commits.author_id, every delta's created_by — has always come
--    from auth.uid(), never from client input; facts.asserted_by/asserted_at
--    were the one place a client-composed CommitEnvelope's now-removed
--    `authorId` field actually reached the database, letting a client
--    assert a fact under any identity it liked. Since every fact's
--    `delta_id` in p_facts is a real row already in `deltas` by the time
--    this function runs (commit_deltas inserts the new commit's own deltas
--    before calling this), the fix needs no new parameter: join back to
--    deltas.created_by/deltas.created_at, which are already correctly
--    server-derived, whether the delta is brand new (this commit,
--    auth.uid()) or inherited from an ancestor commit (already correct,
--    immutable, since deltas is append-only).
--
-- 2. atlas.touch_updated_at gets the `set search_path = public, pg_temp`
--    every other atlas.* helper function already has (§2.E.3 item 20) —
--    the one function in this schema missing it, found by this audit's
--    line-by-line comparison against SPEC §9's own convention.

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
  delete from elements_head where commit_id = p_new_commit_id;
  delete from relationships_head where commit_id = p_new_commit_id;
  delete from facts where commit_id = p_new_commit_id;

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

  -- Fail fast rather than silently dropping a fact: the join below is an
  -- inner join, so a payload fact whose delta_id isn't a real row in
  -- deltas would otherwise just vanish from the projection instead of
  -- erroring — worse than the trust it replaces, not better.
  if exists (
    select 1 from jsonb_array_elements(p_facts) as f
    where not exists (select 1 from deltas d where d.id = (f ->> 'delta_id')::uuid)
  ) then
    raise exception 'replace_main_head_projection: a fact in p_facts references a delta_id that is not a row in deltas' using errcode = '22023';
  end if;

  -- asserted_by/asserted_at come from deltas (d.created_by/d.created_at),
  -- not from f itself: those two columns on deltas are always
  -- server-derived (auth.uid() for a delta this same commit_deltas call
  -- just inserted; already-correct history for an inherited one), so
  -- deriving facts' provenance the same way closes the one gap where a
  -- client-composed payload used to be trusted for authorship. Every other
  -- column here (value, confidence, source_id, source_ref, effective_date)
  -- is real business data the engine computed from deltas this function
  -- itself validated the existence of via delta_id — only asserted_by/
  -- asserted_at were ever a bare, unverified claim.
  insert into facts (commit_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
  select p_new_commit_id, (f ->> 'subject_type')::subject_type, (f ->> 'subject_id')::uuid, f ->> 'attribute', f -> 'value', d.id,
    (f ->> 'source_id')::uuid, f ->> 'source_ref', nullif(f ->> 'effective_date', '')::date, (f ->> 'confidence')::numeric, d.created_by, d.created_at
  from jsonb_array_elements(p_facts) as f
  join deltas d on d.id = (f ->> 'delta_id')::uuid;
end;
$$;

revoke all on function atlas.replace_main_head_projection from public;
grant execute on function atlas.replace_main_head_projection to service_role;

create or replace function atlas.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
