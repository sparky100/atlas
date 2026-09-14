-- F1 ("custom attributes"), PR1: `attribute_definitions` — org-defined
-- attributes, stored as data rather than code (docs/prompts/atlas-prompt-pack.md).
-- Also finishes wiring the two new `delta_kind` values the previous
-- migration added (`element_update_custom`/`relationship_update_custom`,
-- src/contracts/delta.ts's `ElementUpdateCustom`/`RelationshipUpdateCustom`)
-- into the `deltas` table itself and into
-- `atlas.apply_deltas_to_main_projection` (20260913130000) — both of which
-- already switch/check on delta kind by name and would otherwise reject or
-- mis-classify a commit carrying one of the new kinds.

-- ---------------------------------------------------------------------------
-- `deltas` table: teach it the two new kinds.
-- ---------------------------------------------------------------------------

-- `deltas_check` (confirmed by name against the live project): "every
-- delta's `attribute` is the '$exists' sentinel, except the update kinds,
-- which carry a real attribute key." A custom-attribute update carries a
-- real (org-defined) attribute key exactly like a core one does — it needs
-- the same exemption, or every `element.update_custom`/
-- `relationship.update_custom` delta would violate this the moment it
-- carries anything but '$exists'.
alter table deltas drop constraint deltas_check;
alter table deltas add constraint deltas_attribute_exists_sentinel_check
  check (
    kind in ('element_update', 'relationship_update', 'element_update_custom', 'relationship_update_custom')
    or attribute = '$exists'
  );

-- `subject_type` is `generated always as (...) stored` from `kind`
-- (20260906071400_history.sql) — Postgres has no `ALTER ... SET EXPRESSION`,
-- so the only way to change a generated column's own expression is to drop
-- and recreate it. Confirmed directly against the live project before
-- writing this: no index, RLS policy, or foreign key depends on
-- `deltas.subject_type` (only the one CHECK constraint below does), so this
-- is a safe drop — `cascade` removes exactly that one constraint, recreated
-- immediately after with an explicit name. Existing rows recompute to the
-- exact same values they already had (every kind that existed before this
-- migration is still in the same branch of the CASE); only the two new
-- kinds are new territory.
alter table deltas drop column subject_type cascade;

alter table deltas add column subject_type subject_type generated always as (
  case
    when kind in ('element_create', 'element_update', 'element_update_custom', 'element_retract', 'element_restore')
      then 'element'::subject_type
    else 'relationship'::subject_type
  end
) stored;

alter table deltas add constraint deltas_subject_type_matches_own_type
  check (
    (subject_type = 'element' and element_type is not null and relationship_type is null)
    or (subject_type = 'relationship' and relationship_type is not null and element_type is null)
  );

-- Every other CHECK on `deltas` (create/retract/restore-specific: name,
-- parent_id, from/to element, value nullability, previous_delta_id) already
-- holds for the two new kinds with no change: neither is a create/retract/
-- restore kind, so each such constraint's own "kind is not one of these" arm
-- is satisfied automatically — confirmed by reading every one of them
-- against the live project's actual definitions before writing this
-- migration, not assumed.

-- ---------------------------------------------------------------------------
-- `atlas.apply_deltas_to_main_projection`: the E3 incremental-apply path
-- (20260913130000_delta_apply_in_sql.sql) switches on `kind` by name and
-- falls through to its own "not supported" exception for anything it
-- hasn't been taught — which every main-branch commit containing a custom-
-- attribute update would hit today, since `src/db/commits.ts` takes this
-- incremental path for any commit with no restore delta in it (custom
-- updates included). Two new branches, mirroring `element_update`/
-- `relationship_update`'s own fact bookkeeping exactly; `element_update_custom`
-- deliberately does NOT get `element_update`'s `name`/`parentId` special-
-- casing (a custom key can never be mistaken for a promoted column here,
-- same reasoning as the TypeScript `apply()` split in src/engine/deltas.ts),
-- and `relationship_update_custom` needs no special casing to skip in the
-- first place (relationships have no promoted attribute columns), so it
-- just joins `relationship_update`'s existing branch outright.
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
  delete from elements_head where commit_id = p_new_commit_id;
  delete from relationships_head where commit_id = p_new_commit_id;
  delete from facts where commit_id = p_new_commit_id;

  insert into elements_head (commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id)
  select p_new_commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id
  from elements_head where commit_id = p_old_commit_id;

  insert into relationships_head (commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id)
  select p_new_commit_id, org_id, model_id, relationship_id, relationship_type, from_element_id, to_element_id, attributes, exists_delta_id
  from relationships_head where commit_id = p_old_commit_id;

  insert into facts (commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at)
  select p_new_commit_id, org_id, model_id, subject_type, subject_id, attribute, value, delta_id, source_id, source_ref, effective_date, confidence, asserted_by, asserted_at
  from facts where commit_id = p_old_commit_id;

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
      insert into elements_head (commit_id, org_id, model_id, element_id, element_type, name, parent_id, attributes, exists_delta_id)
      values (p_new_commit_id, p_org_id, p_model_id, v_rec.subject_id, v_rec.element_type, v_rec.name, v_rec.parent_id, coalesce(v_rec.value, '{}'::jsonb), v_rec.delta_id);

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

    elsif v_rec.kind = 'element_update_custom' then
      -- No `name`/`parentId` special-casing here, deliberately — an
      -- org-defined key is never treated as a promoted column, even if it
      -- happens to be spelled "name" or "parentId" (src/engine/deltas.ts's
      -- own `apply()` keeps the same split for the same reason).
      if v_rec.value is null then
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
      if not exists (select 1 from elements_head where commit_id = p_new_commit_id and element_id = v_rec.subject_id) then
        raise exception 'apply_deltas_to_main_projection: element.retract % does not exist in this head', v_rec.subject_id using errcode = '22023';
      end if;
      if exists (
        select 1 from relationships_head
        where commit_id = p_new_commit_id and (from_element_id = v_rec.subject_id or to_element_id = v_rec.subject_id)
      ) then
        raise exception 'apply_deltas_to_main_projection: element.retract % still has a live relationship referencing it (C8)', v_rec.subject_id using errcode = '22023';
      end if;
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

    elsif v_rec.kind in ('relationship_update', 'relationship_update_custom') then
      -- No promoted columns for a relationship (endpoints are immutable)
      -- either way, so a custom relationship attribute needs no branch of
      -- its own — it already joins the plain-attribute path unmodified.
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
      raise exception 'apply_deltas_to_main_projection: % is not supported by incremental apply — the caller must send a full computed projection for a commit containing a restore delta', v_rec.kind using errcode = '22023';
    end if;
  end loop;

  if p_old_commit_id is not null and p_old_commit_id <> p_new_commit_id and not exists (select 1 from tags t where t.commit_id = p_old_commit_id) then
    delete from elements_head where commit_id = p_old_commit_id;
    delete from relationships_head where commit_id = p_old_commit_id;
    delete from facts where commit_id = p_old_commit_id;
  end if;
end;
$$;

revoke all on function atlas.apply_deltas_to_main_projection(uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function atlas.apply_deltas_to_main_projection(uuid, uuid, uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- `attribute_definitions`: org-defined attributes (F1). Org-scoped, not
-- model-scoped — the prompt pack's own column list names only `org_id`,
-- confirmed against every reference to this table in the F1 plan; a
-- definition applies across every model in the organisation.
-- ---------------------------------------------------------------------------

create table attribute_definitions (
  id uuid primary key,
  org_id uuid not null references organisations (id),
  key text not null check (length(btrim(key)) > 0),
  label text not null check (length(btrim(label)) > 0),
  kind text not null check (kind in ('text', 'number', 'date', 'boolean', 'select', 'link')),
  -- `kind = 'select'` only — the allowed values, in display order (the same
  -- shape src/contracts/attributeSchema.ts's own `AttributeFieldSchema.options`
  -- already uses for a core enum field). Null for every other kind.
  options text[],
  -- Which element types this definition shows up on — src/contracts/delta.ts's
  -- `ElementType` union (capability/system/container/actor); relationship-
  -- scoped custom attributes are out of this sprint's scope (see
  -- src/db/types.ts's own `AttributeDefinitionRow.applies_to` doc comment).
  applies_to text[] not null check (
    array_length(applies_to, 1) > 0
    and applies_to <@ array['capability', 'system', 'container', 'actor']::text[]
  ),
  required boolean not null default false,
  description text,
  order_index int not null default 0,
  -- Soft-disable, mirroring `models.archived_at` (Sprint 7j item 1): a
  -- deprecated definition disappears from "add a value" pickers, but a
  -- value already set on an element keeps rendering wherever it already
  -- does, unchanged (attribute_definitions never removed data — F1's own
  -- "no fact without provenance"/rule 5 territory is `deltas`, not this
  -- settings table, but the same non-destructive spirit applies).
  deprecated_at timestamptz,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- A key is reused across every element type it applies to, never
  -- redefined twice for the same org (attributeDefinitionToFieldSchema's
  -- own one-key-one-definition assumption).
  unique (org_id, key)
);

comment on table attribute_definitions is 'F1: org-defined attributes, stored as data (prompt pack). Rendered after core attributes by the generic attribute row; validated at commit from the definition (src/contracts/attributeSchema.ts''s validateCustomAttributeValue), never by the engine.';

create index attribute_definitions_org_id_order_idx on attribute_definitions (org_id, order_index);

-- ---------------------------------------------------------------------------
-- RLS — mirrors organisation_settings.sql's own shape: owner-only writes,
-- any org member can read (every member's element/browse pages need to see
-- these to render/filter by them, not just an owner). No delete policy —
-- deprecate (a plain column write, below) is this table's only "retire"
-- mechanism, matching models.archived_at's own precedent of never a real
-- delete for a settings-shaped row with this little downside to keeping.
-- ---------------------------------------------------------------------------

alter table attribute_definitions enable row level security;
alter table attribute_definitions force row level security;

create policy attribute_definitions_select on attribute_definitions
  for select to authenticated
  using (atlas.is_member(org_id));

create policy attribute_definitions_insert on attribute_definitions
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner') and created_by = auth.uid());

create policy attribute_definitions_update on attribute_definitions
  for update to authenticated
  using (atlas.has_role(org_id, 'owner'))
  with check (atlas.has_role(org_id, 'owner'));

grant select, insert on attribute_definitions to authenticated;

-- Reorder (order_index) and deprecate (deprecated_at) are both plain,
-- owner-gated column writes — no RPC (no atomic cross-table effect either
-- needs, unlike merge_requests/decisions), no guard trigger (no restrictive
-- lifecycle state to gate *when* an edit is allowed, unlike
-- decisions/branches.intent). `id`/`org_id`/`created_by`/`created_at` are
-- never in this list — identity/provenance columns, immutable after
-- creation, same convention as every other settings table in this schema.
-- `key` is deliberately excluded too: it's this row's own stable identity
-- once created (attributeDefinitionToFieldSchema and every delta that has
-- ever referenced it by key would otherwise silently point at a renamed
-- thing) — retiring a mistaken key is what deprecate is for, not a rename.
grant update (label, kind, options, applies_to, required, description, order_index, deprecated_at) on attribute_definitions to authenticated;
