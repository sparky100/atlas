-- Sprint H1 item 4 (docs/AUDIT-2026-09-U2.md §2.E.3 item 1): `facts` was
-- migrated without `org_id`/`model_id`, even though SPEC §2/S-20 states
-- "every table carries org_id, including projections and deltas... and
-- explicitly names `facts` in its composite-PK carve-out list" — and its
-- two sibling projection tables, elements_head and relationships_head
-- (20260906071600_projections.sql), already have both columns. Backfilled
-- from `commits` (the owning row for every fact, via `commit_id`) rather
-- than left to derive them via a join on every read, matching S-20's own
-- stated reason for the convention: "RLS policies stay one predicate, and
-- never need a join to decide" (facts_select isn't rewritten to use it
-- here — out of this item's scope — but the column is now there for
-- whoever does).

alter table facts add column org_id uuid;
alter table facts add column model_id uuid;

update facts f
set org_id = c.org_id, model_id = c.model_id
from commits c
where c.id = f.commit_id;

alter table facts
  alter column org_id set not null,
  alter column model_id set not null,
  add constraint facts_org_id_fkey foreign key (org_id) references organisations (id),
  add constraint facts_model_id_fkey foreign key (model_id) references models (id);

create index facts_model_id_subject_id_idx on facts (model_id, subject_id);

comment on column facts.org_id is 'Denormalised from commits.org_id (S-20) — backfilled, Sprint H1.';
comment on column facts.model_id is 'Denormalised from commits.model_id (S-20) — backfilled, Sprint H1.';

-- atlas.replace_main_head_projection: facts now carries org_id/model_id,
-- supplied the same way elements_head/relationships_head already get
-- theirs — constant per call, from this function's own p_org_id/p_model_id
-- parameters, not from anything in the p_facts payload. No new parameter,
-- no change to src/engine/projection.ts's serializeHeadProjection: a
-- fact's org_id/model_id were never something the engine's per-commit Head
-- needed to track (a Head is already scoped to one model), exactly like
-- elements_head/relationships_head's own rows never carried them through
-- src/engine/deltas.ts's ElementRow/RelationshipRow either.
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

  if exists (
    select 1 from jsonb_array_elements(p_facts) as f
    where not exists (select 1 from deltas d where d.id = (f ->> 'delta_id')::uuid)
  ) then
    raise exception 'replace_main_head_projection: a fact in p_facts references a delta_id that is not a row in deltas' using errcode = '22023';
  end if;

  insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
  select p_new_commit_id, p_org_id, p_model_id, (f ->> 'subject_type')::subject_type, (f ->> 'subject_id')::uuid, f ->> 'attribute', f -> 'value', d.id,
    (f ->> 'source_id')::uuid, f ->> 'source_ref', nullif(f ->> 'effective_date', '')::date, (f ->> 'confidence')::numeric, d.created_by, d.created_at
  from jsonb_array_elements(p_facts) as f
  join deltas d on d.id = (f ->> 'delta_id')::uuid;
end;
$$;

revoke all on function atlas.replace_main_head_projection from public;
grant execute on function atlas.replace_main_head_projection to service_role;
