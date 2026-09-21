-- F6, value streams (docs/ADR-023-value-streams.md; SPEC-data-model.md
-- §3.1, §3.3, §3.10, §5.2): one element type, one relationship type, and
-- the starter-map storage that goes with them.
--
-- 1. `element_type` gains 'value_stream' (a stream, or a stage when
--    elements_head.parent_id is set) — its first *addition* since
--    20260906071100_enums.sql created it (20260913010000 only ever removed
--    a label) — and `relationship_type` gains 'enables' (capability →
--    stage), the same standalone `add value` shape
--    20260921030000_relationship_type_replaces.sql just used for
--    'replaces'. `deltas.element_type` is already plain text (that
--    migration's own choice — history is immutable), so the widening
--    reaches elements_head, relationships_head and deltas.relationship_type
--    only. Neither new label is referenced by name anywhere else in this
--    file, on purpose: Postgres refuses to use an enum label inside the
--    transaction that added it, and Supabase runs each migration file as
--    one transaction. The two finer rules — a stage never has children,
--    `enables` targets a stage and never a stream — are C22, engine-only
--    (src/engine/deltas.ts), for the same reason C18/C20 are: cross-row
--    dependencies Postgres has no plain CHECK for.
-- 2. Two content tables mirroring capability_map_items' own shape, RLS/
--    grants and published-immutability guard (20260906110000,
--    20260906190000): capability_map_value_stream_items (streams and their
--    stages, depth two) and capability_map_value_stream_enables (stage →
--    capability, by code — the content file names the capability by
--    *name*, scripts/loadCapabilityMaps.ts resolves it, so this table only
--    ever holds resolved codes). Not overloaded onto capability_map_items:
--    its level-1–3 trigger and every reader of it assume capabilities.
-- 3. atlas.seed_from_map gains p_relationships_head, passed straight
--    through to atlas.replace_main_head_projection's sixth argument
--    (previously a hardcoded '[]'::jsonb) so a template_seed commit can
--    carry `enables` edges alongside its element creates. Everything else
--    in the function is 20260906370000's text, verbatim.
-- 4. attribute_definitions.applies_to's CHECK (20260914020000) is
--    deliberately untouched — custom attributes on value streams are out
--    of scope (ADR-023, Alternatives rejected; SPEC §11).

alter type element_type add value if not exists 'value_stream';
alter type relationship_type add value if not exists 'enables';

-- ---------------------------------------------------------------------------
-- 2. Starter-map content tables
-- ---------------------------------------------------------------------------

create table capability_map_value_stream_items (
  id uuid primary key,
  map_id uuid not null references capability_maps (id) on delete cascade,
  code text not null,
  parent_code text,
  name text not null,
  description text,
  item_order int not null,
  created_at timestamptz not null default now(),

  unique (map_id, code),
  foreign key (map_id, parent_code) references capability_map_value_stream_items (map_id, code)
);

comment on table capability_map_value_stream_items is 'One value stream (parent_code null) or one of its stages (parent_code = the stream''s code) in a starter map (SPEC §3.10, ADR-023). item_order, not order: a reserved SQL keyword.';

create index capability_map_value_stream_items_map_id_idx on capability_map_value_stream_items (map_id);

-- Depth two, the same rule C22 enforces on the seeded elements: a row with
-- a parent must name a row that has none (a stream), and a row that has
-- children can never itself be given a parent.
create or replace function atlas.guard_capability_map_value_stream_item_depth()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_parent_code text;
begin
  if new.parent_code is null then
    return new;
  end if;

  if exists (select 1 from capability_map_value_stream_items where map_id = new.map_id and parent_code = new.code) then
    raise exception 'capability_map_value_stream_items: % has stages of its own and cannot itself become a stage — a value stream has exactly two levels', new.code using errcode = '23514';
  end if;

  select parent_code into v_parent_parent_code from capability_map_value_stream_items where map_id = new.map_id and code = new.parent_code;
  if not found then
    raise exception 'capability_map_value_stream_items: parent_code % not found in this map', new.parent_code using errcode = '23514';
  end if;
  if v_parent_parent_code is not null then
    raise exception 'capability_map_value_stream_items: % would be a stage under a stage — a value stream has exactly two levels', new.code using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger capability_map_value_stream_items_guard_depth
  before insert or update on capability_map_value_stream_items
  for each row execute function atlas.guard_capability_map_value_stream_item_depth();

create table capability_map_value_stream_enables (
  map_id uuid not null references capability_maps (id) on delete cascade,
  stage_code text not null,
  capability_code text not null,
  created_at timestamptz not null default now(),

  primary key (map_id, stage_code, capability_code),
  foreign key (map_id, stage_code) references capability_map_value_stream_items (map_id, code) on delete cascade,
  foreign key (map_id, capability_code) references capability_map_items (map_id, code) on delete cascade
);

comment on table capability_map_value_stream_enables is 'A starter map''s "this capability enables this stage" links (SPEC §3.10, ADR-023) — capability_code is the resolved capability_map_items.code; the content file names the capability by name and scripts/loadCapabilityMaps.ts resolves it.';

-- `enables` targets a stage, never a stream — the content-table twin of
-- C22's own `enables` half. The FK already guarantees the row exists; this
-- gives the clearer reason first, the same way guard_capability_map_item_level
-- does for a missing parent.
create or replace function atlas.guard_capability_map_value_stream_enables_stage()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_parent_code text;
begin
  select parent_code into v_parent_code from capability_map_value_stream_items where map_id = new.map_id and code = new.stage_code;
  if not found then
    raise exception 'capability_map_value_stream_enables: stage_code % not found in this map', new.stage_code using errcode = '23514';
  end if;
  if v_parent_code is null then
    raise exception 'capability_map_value_stream_enables: % is a stream, not a stage — enables targets a stage only', new.stage_code using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger capability_map_value_stream_enables_guard_stage
  before insert or update on capability_map_value_stream_enables
  for each row execute function atlas.guard_capability_map_value_stream_enables_stage();

-- Published maps are immutable (SPEC §3.10) — the same guard function
-- capability_map_items uses (20260906190000); its body reads only map_id,
-- so it is reused rather than cloned per table.
create trigger capability_map_value_stream_items_guard_immutable
  before insert or update or delete on capability_map_value_stream_items
  for each row execute function atlas.guard_capability_map_item_immutable();

create trigger capability_map_value_stream_enables_guard_immutable
  before insert or update or delete on capability_map_value_stream_enables
  for each row execute function atlas.guard_capability_map_item_immutable();

-- RLS: product content, readable by every authenticated user, written only
-- by the loader as service_role — verbatim the capability_map_items shape,
-- explicit service_role grant included (auto_expose_new_tables = false).
alter table capability_map_value_stream_items enable row level security;
alter table capability_map_value_stream_items force row level security;

create policy capability_map_value_stream_items_select on capability_map_value_stream_items
  for select to authenticated
  using (true);

grant select on capability_map_value_stream_items to authenticated;
grant select, insert, update, delete on capability_map_value_stream_items to service_role;

alter table capability_map_value_stream_enables enable row level security;
alter table capability_map_value_stream_enables force row level security;

create policy capability_map_value_stream_enables_select on capability_map_value_stream_enables
  for select to authenticated
  using (true);

grant select on capability_map_value_stream_enables to authenticated;
grant select, insert, update, delete on capability_map_value_stream_enables to service_role;

-- ---------------------------------------------------------------------------
-- 3. atlas.seed_from_map: + p_relationships_head
-- ---------------------------------------------------------------------------

drop function if exists atlas.seed_from_map(uuid, uuid, uuid, uuid, text, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text);

create or replace function atlas.seed_from_map(
  p_commit_id uuid,
  p_model_id uuid,
  p_branch_id uuid,
  p_expected_head_commit_id uuid,
  p_title text,
  p_capability_map_id uuid,
  p_source_id uuid,
  p_source_name text,
  p_deltas jsonb,
  p_elements_head jsonb,
  p_facts jsonb,
  p_aliases jsonb,
  p_head_hash text,
  p_relationships_head jsonb default '[]'::jsonb
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

  -- Optimistic concurrency: v_head_commit_id, just read inside this same
  -- transaction, is the real current head — if it differs from what the
  -- client fetched and expected, main moved underneath this call (ADR-018
  -- means "moved" here can only mean "someone else already seeded it, or
  -- committed to it, since"). Rejecting here, with a clear message, beats
  -- letting branches_guard_head_advance's generic error surface instead.
  if v_head_commit_id is distinct from p_expected_head_commit_id then
    raise exception 'seed_from_map: branch % has moved since expectedHeadCommitId % was read (now %) — refresh and retry', p_branch_id, p_expected_head_commit_id, v_head_commit_id using errcode = '23514';
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

  -- parent_commit_id is v_head_commit_id (the real, just-verified current
  -- head — the genesis commit, for every real-world call), never null.
  -- depth is 1: the seed commit sits one below genesis (depth 0), the
  -- same "parent's depth + 1" every other commit path computes
  -- (commit_deltas's own `c.depth + 1`) — genesis is the only commit kind
  -- ever allowed depth 0 or a null parent.
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

  -- F6: p_relationships_head where '[]'::jsonb was hardcoded before — a
  -- seed carrying value streams also carries their `enables` edges.
  perform atlas.replace_main_head_projection(
    v_org_id, p_model_id, null, p_commit_id, coalesce(p_elements_head, '[]'::jsonb), coalesce(p_relationships_head, '[]'::jsonb), coalesce(p_facts, '[]'::jsonb)
  );

  insert into aliases (id, org_id, model_id, element_id, alias_value, alias_type, source_id, confidence, created_by)
  select (a ->> 'id')::uuid, v_org_id, p_model_id, (a ->> 'element_id')::uuid, a ->> 'alias_value', 'template_code', p_source_id, (a ->> 'confidence')::numeric, auth.uid()
  from jsonb_array_elements(p_aliases) as a;

  return v_commit;
end;
$$;

revoke all on function atlas.seed_from_map from public;
grant execute on function atlas.seed_from_map to authenticated;
