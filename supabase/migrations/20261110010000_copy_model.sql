-- Owner-only "Copy this model" (docs/ADR-030-copy-model.md, SPEC §5.6).
--
-- atlas.copy_model creates a new, independent model in the SAME organisation
-- from the current main head of an existing one, in one transaction:
--
--   * a new `models` row (the existing on_model_created trigger gives it its
--     genesis commit and main branch);
--   * the source's `sources` rows, re-keyed (so every copied fact still names
--     the source it came from) — see `p_source_map`;
--   * ONE ordinary `manual` commit ("Copied from <name>") whose deltas the
--     client built in src/engine/copyModel.ts from the source's head, with new
--     element/relationship ids and each fact's original provenance — and the
--     materialised head projection that commit folds to;
--   * the source's `aliases` (re-pointed at the new element ids);
--   * the source's organisation-visible saved reports and dashboards.
--
-- Deliberately NOT copied: version history, open changes, decisions,
-- projects, comments, review queues, snapshots, private reports/dashboards
-- (they belong to a person), cross-org shares, saved layouts. The new model
-- starts with a clean Work list.
--
-- Nothing in deltas/commits/tags/... is updated or deleted (rule 5); the
-- source model is only read.

create or replace function atlas.copy_model(
  p_source_model_id uuid,
  p_expected_source_head_commit_id uuid,
  p_new_model_id uuid,
  p_name text,
  p_slug text,
  p_description text,
  p_commit_id uuid,
  p_title text,
  p_source_map jsonb,    -- [{ "old": uuid, "new": uuid }, ...] one entry per source row in use
  p_element_map jsonb,   -- { "<old element id>": "<new element id>", ... }
  p_deltas jsonb,
  p_elements_head jsonb,
  p_relationships_head jsonb,
  p_facts jsonb,
  p_head_hash text
)
returns models
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_schema_version int;
  v_source_main_head uuid;
  v_new_branch_id uuid;
  v_new_genesis_id uuid;
  v_model models;
  v_old_report uuid;
  v_new_report uuid;
  v_old_dash uuid;
  v_new_dash uuid;
  v_report_map jsonb := '{}'::jsonb;
begin
  select org_id, schema_version into v_org_id, v_schema_version from models where id = p_source_model_id;
  if v_org_id is null then
    raise exception 'copy_model: model % not found', p_source_model_id using errcode = '22023';
  end if;

  -- The real gate (CLAUDE.md / ADR-009): owners only, enforced here, not just
  -- in the UI. `has_role` reads membership for auth.uid(), so a security
  -- definer body still checks the CALLER.
  if atlas.has_role(v_org_id, 'owner') is not true then
    raise exception 'copy_model: only an owner may copy a model' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'copy_model: a copy needs a name' using errcode = '22023';
  end if;
  if jsonb_array_length(p_deltas) = 0 then
    raise exception 'copy_model: there is nothing in this model to copy' using errcode = '22023';
  end if;

  -- Optimistic concurrency: the client built the copy from the head it read.
  -- If main moved since, refuse rather than copy a head that no longer exists.
  select head_commit_id into v_source_main_head from branches where model_id = p_source_model_id and kind = 'main';
  if v_source_main_head is distinct from p_expected_source_head_commit_id then
    raise exception 'copy_model: the model changed while it was being copied — try again' using errcode = '23514';
  end if;

  insert into models (id, org_id, name, slug, description, schema_version, created_by)
  values (p_new_model_id, v_org_id, btrim(p_name), p_slug, p_description, v_schema_version, auth.uid())
  returning * into v_model;

  select id, head_commit_id into v_new_branch_id, v_new_genesis_id from branches where model_id = p_new_model_id and kind = 'main';

  -- Sources: same kind/name/uri, new ids, in the new model. A spreadsheet
  -- source's touched-element list is re-pointed at the new element ids; the
  -- unsaved `pending_aliases` of an in-flight import are not carried over.
  insert into sources (id, org_id, model_id, kind, name, uri, captured_at, capture_job_id, capability_map_id, user_id, created_by, import_touched_element_ids, pending_aliases)
  select
    (m ->> 'new')::uuid, v_org_id, p_new_model_id, s.kind, s.name, s.uri, s.captured_at, s.capture_job_id, s.capability_map_id, s.user_id, s.created_by,
    case when s.import_touched_element_ids is null then null
         else coalesce((select array_agg((p_element_map ->> t::text)::uuid) from unnest(s.import_touched_element_ids) as t where p_element_map ? t::text), '{}'::uuid[]) end,
    '[]'::jsonb
  from jsonb_array_elements(p_source_map) as m
  join sources s on s.id = (m ->> 'old')::uuid and s.model_id = p_source_model_id;

  insert into commits (id, org_id, model_id, branch_id, parent_commit_id, merged_branch_head_commit_id, kind, title, author_id, depth, head_hash)
  values (p_commit_id, v_org_id, p_new_model_id, v_new_branch_id, v_new_genesis_id, null, 'manual', p_title, auth.uid(), 1, decode(p_head_hash, 'hex'));

  insert into deltas (
    id, org_id, model_id, commit_id, seq, kind, subject_id, attribute, element_type, relationship_type, name, parent_id, from_element_id, to_element_id,
    value, previous_delta_id, source_id, source_ref, effective_date, confidence, created_by
  )
  select
    (d ->> 'id')::uuid, v_org_id, p_new_model_id, p_commit_id, (ord - 1)::int, (d ->> 'kind')::delta_kind, (d ->> 'subject_id')::uuid, d ->> 'attribute',
    nullif(d ->> 'element_type', '')::element_type, nullif(d ->> 'relationship_type', '')::relationship_type, d ->> 'name', (d ->> 'parent_id')::uuid,
    (d ->> 'from_element_id')::uuid, (d ->> 'to_element_id')::uuid, d -> 'value', (d ->> 'previous_delta_id')::uuid, (d ->> 'source_id')::uuid,
    d ->> 'source_ref', nullif(d ->> 'effective_date', '')::date, (d ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_deltas) with ordinality as t (d, ord);

  update branches set head_commit_id = p_commit_id where id = v_new_branch_id;

  perform atlas.replace_main_head_projection(
    v_org_id, p_new_model_id, null, p_commit_id, coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
  );

  -- Aliases (names, codes, external refs, merged ids ...) follow their element.
  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  select gen_random_uuid(), v_org_id, p_new_model_id, (p_element_map ->> a.element_id::text)::uuid, a.alias_value, a.alias_type,
         (sm ->> 'new')::uuid, a.confidence, a.created_by
  from aliases a
  join jsonb_array_elements(p_source_map) sm on (sm ->> 'old')::uuid = a.source_id
  where a.model_id = p_source_model_id and p_element_map ? a.element_id::text;

  -- Organisation-visible reports and dashboards only: a private one belongs
  -- to a person, not to the model. The copier (an owner) becomes the creator.
  for v_old_report in select id from saved_reports where model_id = p_source_model_id and visibility = 'organisation' order by created_at, id loop
    v_new_report := gen_random_uuid();
    insert into saved_reports (id, org_id, model_id, name, description, spec, spec_version, visibility, created_by)
    select v_new_report, v_org_id, p_new_model_id, name, description, spec, spec_version, 'organisation', auth.uid()
    from saved_reports where id = v_old_report;
    v_report_map := v_report_map || jsonb_build_object(v_old_report::text, v_new_report::text);
  end loop;

  for v_old_dash in select id from dashboards where model_id = p_source_model_id and visibility = 'organisation' order by created_at, id loop
    v_new_dash := gen_random_uuid();
    insert into dashboards (id, org_id, model_id, name, visibility, created_by)
    select v_new_dash, v_org_id, p_new_model_id, name, 'organisation', auth.uid() from dashboards where id = v_old_dash;
    insert into dashboard_tiles (id, dashboard_id, report_id, position, kind, size, row_limit)
    select gen_random_uuid(), v_new_dash, (v_report_map ->> t.report_id::text)::uuid, t.position, t.kind, t.size, t.row_limit
    from dashboard_tiles t
    where t.dashboard_id = v_old_dash and v_report_map ? t.report_id::text;
  end loop;

  return v_model;
end;
$$;

revoke all on function atlas.copy_model from public;
grant execute on function atlas.copy_model to authenticated;
