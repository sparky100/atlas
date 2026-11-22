-- Platform-owned editing workspace for the next version of a starter map.
-- Existing published maps, map items, seeded models and loader semantics stay
-- fixed. Drafts here are not seedable and are never shown in the model picker.
create table public.reference_map_drafts (
  id uuid primary key default gen_random_uuid(),
  base_map_id uuid references public.capability_maps(id) on delete restrict,
  sector text not null check (btrim(sector) <> ''),
  version int not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  edit_revision int not null default 1 check (edit_revision > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_map_id uuid references public.capability_maps(id) on delete restrict,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sector, version),
  check ((status = 'published') = (published_map_id is not null))
);
create index reference_map_drafts_base_map_idx on public.reference_map_drafts(base_map_id) where base_map_id is not null;
create index reference_map_drafts_published_map_idx on public.reference_map_drafts(published_map_id) where published_map_id is not null;
-- The inventory's where-used count and the existing map FK both use this.
create index if not exists sources_capability_map_id_idx on public.sources(capability_map_id)
  where capability_map_id is not null;

create table public.reference_map_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.reference_map_drafts(id) on delete restrict,
  action text not null check (action in ('created', 'saved', 'aligned', 'published')),
  actor_id uuid not null,
  edit_revision int not null,
  happened_at timestamptz not null default now()
);
create index reference_map_events_draft_idx on public.reference_map_events(draft_id, happened_at);

-- The admin chooses one published identity, or explicitly creates a new
-- identity. No map code or name is used to infer a shared identity.
create table public.reference_map_draft_alignments (
  draft_id uuid not null references public.reference_map_drafts(id) on delete restrict,
  item_code text not null,
  kind text not null check (kind in ('existing', 'new')),
  capability_id uuid,
  capability_revision int,
  stable_key text,
  identity_definition text,
  reviewed_name text not null,
  reviewed_description text not null,
  review_basis text not null check (btrim(review_basis) <> '' and length(review_basis) <= 500),
  aligned_by uuid not null,
  aligned_at timestamptz not null default now(),
  primary key (draft_id, item_code),
  foreign key (capability_id, capability_revision)
    references public.reference_capability_revisions(capability_id, revision) on delete restrict,
  check (stable_key is null or (stable_key ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(stable_key) <= 100)),
  check (identity_definition is null or (btrim(identity_definition) <> '' and length(identity_definition) <= 2000)),
  check (
    (kind = 'existing' and capability_id is not null and capability_revision is not null and stable_key is null and identity_definition is null)
    or (kind = 'new' and capability_id is null and capability_revision is null and stable_key is not null and identity_definition is not null)
  )
);
create index reference_map_draft_alignments_capability_idx
  on public.reference_map_draft_alignments(capability_id, capability_revision) where capability_id is not null;

alter table public.reference_map_drafts enable row level security;
alter table public.reference_map_drafts force row level security;
alter table public.reference_map_events enable row level security;
alter table public.reference_map_events force row level security;
alter table public.reference_map_draft_alignments enable row level security;
alter table public.reference_map_draft_alignments force row level security;
create policy reference_map_drafts_admin_read on public.reference_map_drafts
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy reference_map_events_admin_read on public.reference_map_events
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy reference_map_draft_alignments_admin_read on public.reference_map_draft_alignments
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
revoke all on public.reference_map_drafts, public.reference_map_events, public.reference_map_draft_alignments from public, anon, authenticated;
grant select on public.reference_map_drafts, public.reference_map_events, public.reference_map_draft_alignments to authenticated;
grant select, insert, update, delete on public.reference_map_drafts, public.reference_map_events, public.reference_map_draft_alignments to service_role;

create function atlas.reference_map_inventory()
returns table (id uuid, sector text, version int, status text, title text,
  published_at timestamptz, item_count bigint, seeded_model_count bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501'; end if;
  return query select m.id, m.sector, m.version, m.status::text, m.title,
    m.published_at,
    (select count(*) from public.capability_map_items i where i.map_id = m.id),
    (select count(distinct s.model_id) from public.sources s where s.capability_map_id = m.id)
    from public.capability_maps m order by m.sector, m.version desc;
end;
$$;
revoke all on function atlas.reference_map_inventory() from public, anon;
grant execute on function atlas.reference_map_inventory() to authenticated;

create function atlas.search_reference_capabilities(p_query text)
returns table (capability_id uuid, revision int, name text, definition text, stable_key text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_query, ''))) < 2 then return; end if;
  return query select r.capability_id, r.revision, r.name, r.definition, c.stable_key
    from public.reference_capability_revisions r
    join public.reference_capabilities c on c.id = r.capability_id
    where r.status = 'published'
      and (r.name ilike '%' || btrim(p_query) || '%' or c.stable_key ilike '%' || btrim(p_query) || '%')
    order by r.name, r.revision desc limit 25;
end;
$$;
revoke all on function atlas.search_reference_capabilities(text) from public, anon;
grant execute on function atlas.search_reference_capabilities(text) to authenticated;

-- The validation result is also shown in the editor. Publication calls the
-- same function again inside its transaction, so the browser cannot bypass it.
create function atlas.reference_map_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_item jsonb;
  v_code text;
  v_parent text;
  v_level int;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['The draft is not a map.']; end if;
  if nullif(btrim(p_content ->> 'title'), '') is null
    or nullif(btrim(p_content ->> 'summary'), '') is null
    or nullif(btrim(p_content ->> 'sourceDescription'), '') is null then
    v_issues := array_append(v_issues, 'Title, summary and source description are required.');
  end if;
  if coalesce(jsonb_typeof(p_content -> 'items'), 'null') <> 'array' then
    return array_append(v_issues, 'At least one capability is required.');
  end if;
  if jsonb_array_length(p_content -> 'items') = 0 then
    return array_append(v_issues, 'At least one capability is required.');
  end if;
  for v_item in select value from jsonb_array_elements(p_content -> 'items') loop
    if jsonb_typeof(v_item) <> 'object' then
      v_issues := array_append(v_issues, 'Every capability must be an object.');
      continue;
    end if;
    v_code := nullif(btrim(v_item ->> 'code'), '');
    v_parent := nullif(btrim(v_item ->> 'parentCode'), '');
    if v_code is null or nullif(btrim(v_item ->> 'name'), '') is null
      or coalesce((v_item ->> 'level') ~ '^[123]$', false) is false
      or coalesce((v_item ->> 'order') ~ '^-?[0-9]+$', false) is false then
      v_issues := array_append(v_issues, 'Every capability needs a code, name, level (1–3) and order.');
      continue;
    end if;
    v_level := (v_item ->> 'level')::int;
    if (v_parent is null and v_level <> 1)
      or (v_parent is not null and not exists (
        select 1 from jsonb_array_elements(p_content -> 'items') parent
        where parent ->> 'code' = v_parent
          and (parent ->> 'level') ~ '^[123]$'
          and (parent ->> 'level')::int = v_level - 1
      )) then
      v_issues := array_append(v_issues, 'Check the parent and level for capability ' || v_code || '.');
    end if;
  end loop;
  if exists (select 1 from (
    select value ->> 'code' code from jsonb_array_elements(p_content -> 'items')
  ) codes group by code having count(*) > 1) then
    v_issues := array_append(v_issues, 'Capability codes must be unique.');
  end if;
  if coalesce(jsonb_typeof(p_content -> 'sources'), 'null') <> 'array'
    or coalesce(jsonb_typeof(p_content -> 'valueStreams'), 'null') <> 'array' then
    v_issues := array_append(v_issues, 'Sources and value streams must be lists.');
  end if;
  if jsonb_typeof(p_content -> 'sources') = 'array' then
    if jsonb_array_length(p_content -> 'sources') = 0 or exists (
      select 1 from jsonb_array_elements(p_content -> 'sources') s
      where jsonb_typeof(s) <> 'object' or nullif(btrim(s ->> 'citation'), '') is null
        or nullif(btrim(s ->> 'reviewedBy'), '') is null
        or coalesce((s ->> 'reviewedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) is false
    ) then v_issues := array_append(v_issues, 'Add a cited, dated and reviewed source.'); end if;
    if not exists (select 1 from jsonb_array_elements(p_content -> 'sources') s
      where coalesce(s ->> 'reviewedBy', '') !~* 'pending human review') then
      v_issues := array_append(v_issues, 'At least one source needs completed human review.');
    end if;
  end if;
  if jsonb_typeof(p_content -> 'valueStreams') = 'array' and exists (
    select 1 from jsonb_array_elements(p_content -> 'valueStreams') stream
    where jsonb_typeof(stream) <> 'object'
      or nullif(btrim(stream ->> 'code'), '') is null
      or nullif(btrim(stream ->> 'name'), '') is null
      or coalesce((stream ->> 'order') ~ '^-?[0-9]+$', false) is false
      or jsonb_typeof(stream -> 'stages') is distinct from 'array'
  ) then v_issues := array_append(v_issues, 'Check the value streams and their stages.'); end if;
  if jsonb_typeof(p_content -> 'valueStreams') = 'array' then
    if exists (
      select 1 from (
        select stream ->> 'code' code, stream ->> 'order' sort_order, null::text parent
          from jsonb_array_elements(p_content -> 'valueStreams') stream
        union all
        select stage ->> 'code', stage ->> 'order', stream ->> 'code'
          from jsonb_array_elements(p_content -> 'valueStreams') stream,
            jsonb_array_elements(case when jsonb_typeof(stream -> 'stages') = 'array' then stream -> 'stages' else '[]'::jsonb end) stage
      ) parts group by code having count(*) > 1
    ) then v_issues := array_append(v_issues, 'Value stream and stage codes must be unique.'); end if;
    if exists (
      select 1 from (
        select stream ->> 'order' sort_order, null::text parent
          from jsonb_array_elements(p_content -> 'valueStreams') stream
        union all
        select stage ->> 'order', stream ->> 'code'
          from jsonb_array_elements(p_content -> 'valueStreams') stream,
            jsonb_array_elements(case when jsonb_typeof(stream -> 'stages') = 'array' then stream -> 'stages' else '[]'::jsonb end) stage
      ) parts group by parent, sort_order having count(*) > 1
    ) then v_issues := array_append(v_issues, 'Value-stream sibling order must be unique.'); end if;
    if exists (
      select 1 from jsonb_array_elements(p_content -> 'valueStreams') stream,
        jsonb_array_elements(case when jsonb_typeof(stream -> 'stages') = 'array' then stream -> 'stages' else '[]'::jsonb end) stage
      where jsonb_typeof(stage) <> 'object' or nullif(btrim(stage ->> 'code'), '') is null
        or nullif(btrim(stage ->> 'name'), '') is null
        or coalesce((stage ->> 'order') ~ '^-?[0-9]+$', false) is false
        or jsonb_typeof(stage -> 'enables') is distinct from 'array'
    ) then v_issues := array_append(v_issues, 'Check value-stream stage details.'); end if;
    if exists (
      select 1 from jsonb_array_elements(p_content -> 'valueStreams') stream,
        jsonb_array_elements(case when jsonb_typeof(stream -> 'stages') = 'array' then stream -> 'stages' else '[]'::jsonb end) stage,
        jsonb_array_elements(case when jsonb_typeof(stage -> 'enables') = 'array' then stage -> 'enables' else '[]'::jsonb end) enabled
      where (select count(*) from jsonb_array_elements(p_content -> 'items') item where item ->> 'name' = enabled #>> '{}') <> 1
    ) then v_issues := array_append(v_issues, 'A stage must enable exactly one matching capability name.'); end if;
    if exists (
      select 1 from jsonb_array_elements(p_content -> 'valueStreams') stream,
        jsonb_array_elements(case when jsonb_typeof(stream -> 'stages') = 'array' then stream -> 'stages' else '[]'::jsonb end) stage,
        jsonb_array_elements(case when jsonb_typeof(stage -> 'enables') = 'array' then stage -> 'enables' else '[]'::jsonb end) enabled
      group by stream ->> 'code', stage ->> 'code', enabled having count(*) > 1
    ) then v_issues := array_append(v_issues, 'A stage cannot repeat an enabled capability.'); end if;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_content -> 'items') item
    group by item ->> 'parentCode', item ->> 'order' having count(*) > 1
  ) then v_issues := array_append(v_issues, 'Sibling capability order must be unique.'); end if;
  return v_issues;
end;
$$;
revoke all on function atlas.reference_map_issues(jsonb) from public, anon;
grant execute on function atlas.reference_map_issues(jsonb) to authenticated;

create function atlas.create_reference_map_draft(
  p_sector text, p_version int, p_base_map_id uuid, p_content jsonb
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_sector is null or btrim(p_sector) = '' or p_version is null or p_version < 1
    or exists (select 1 from public.capability_maps where sector = p_sector and version = p_version) then
    raise exception 'Choose an unused positive version for this sector' using errcode = '22023';
  end if;
  if p_base_map_id is not null and not exists (
    select 1 from public.capability_maps where id = p_base_map_id and status = 'published' and sector = p_sector
  ) then raise exception 'The starting map must be a published version in this sector' using errcode = '22023'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Draft content must be an object' using errcode = '22023'; end if;
  insert into public.reference_map_drafts(base_map_id, sector, version, content, created_by, updated_by)
  values (p_base_map_id, p_sector, p_version, p_content, auth.uid(), auth.uid())
  returning id into v_id;
  if p_base_map_id is not null and jsonb_typeof(p_content -> 'items') = 'array' then
    insert into public.reference_map_draft_alignments(draft_id, item_code, kind, capability_id,
      capability_revision, reviewed_name, reviewed_description, review_basis, aligned_by)
      select v_id, old.code, 'existing', link.capability_id, link.capability_revision,
        old.name, coalesce(old.description, ''), 'Reviewed alignment carried forward from unchanged map item', auth.uid()
      from public.capability_map_items old
      join public.reference_map_item_links link on link.map_item_id = old.id
      where old.map_id = p_base_map_id and exists (
        select 1 from jsonb_array_elements(p_content -> 'items') item
        where item ->> 'code' = old.code and item ->> 'name' = old.name
          and coalesce(item ->> 'description', '') = coalesce(old.description, '')
      );
  end if;
  insert into public.reference_map_events(draft_id, action, actor_id, edit_revision)
  values (v_id, 'created', auth.uid(), 1);
  return v_id;
end;
$$;
revoke all on function atlas.create_reference_map_draft(text,int,uuid,jsonb) from public, anon;
grant execute on function atlas.create_reference_map_draft(text,int,uuid,jsonb) to authenticated;

create function atlas.save_reference_map_draft(p_id uuid, p_expected_revision int, p_content jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_revision int;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Draft content must be an object' using errcode = '22023'; end if;
  update public.reference_map_drafts
    set content = p_content, edit_revision = edit_revision + 1,
        updated_by = auth.uid(), updated_at = now()
    where id = p_id and status = 'draft' and edit_revision = p_expected_revision
    returning edit_revision into v_revision;
  if v_revision is null then
    raise exception 'The draft changed elsewhere. Reload it and compare before saving.' using errcode = '40001';
  end if;
  insert into public.reference_map_events(draft_id, action, actor_id, edit_revision)
  values (p_id, 'saved', auth.uid(), v_revision);
  return v_revision;
end;
$$;
revoke all on function atlas.save_reference_map_draft(uuid,int,jsonb) from public, anon;
grant execute on function atlas.save_reference_map_draft(uuid,int,jsonb) to authenticated;

create function atlas.align_reference_map_draft_item(
  p_id uuid, p_expected_revision int, p_code text, p_choice jsonb
) returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_draft public.reference_map_drafts%rowtype;
  v_item jsonb;
  v_kind text := p_choice ->> 'kind';
  v_capability_id uuid;
  v_revision int;
  v_key text;
  v_definition text;
  v_basis text := nullif(btrim(p_choice ->> 'reviewBasis'), '');
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501'; end if;
  select * into v_draft from public.reference_map_drafts where id = p_id for update;
  if not found or v_draft.status <> 'draft' or v_draft.edit_revision <> p_expected_revision then
    raise exception 'The draft changed elsewhere. Reload it before aligning.' using errcode = '40001'; end if;
  select value into v_item from jsonb_array_elements(
    case when jsonb_typeof(v_draft.content -> 'items') = 'array' then v_draft.content -> 'items' else '[]'::jsonb end
  ) where value ->> 'code' = p_code;
  if v_item is null or nullif(btrim(v_item ->> 'name'), '') is null or v_basis is null then
    raise exception 'Choose a named draft item and state the reason for its alignment' using errcode = '22023'; end if;
  if v_kind = 'existing' then
    v_capability_id := (p_choice ->> 'capabilityId')::uuid;
    v_revision := (p_choice ->> 'revision')::int;
    if not exists (select 1 from public.reference_capability_revisions r
      where r.capability_id = v_capability_id and r.revision = v_revision and r.status = 'published') then
      raise exception 'Choose a published canonical capability revision' using errcode = '22023'; end if;
  elsif v_kind = 'new' then
    v_key := p_choice ->> 'stableKey';
    v_definition := p_choice ->> 'definition';
    if v_key is null or v_key !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' or length(v_key) > 100
      or nullif(btrim(v_definition), '') is null or length(v_definition) > 2000 then
      raise exception 'A new capability needs a stable key and definition' using errcode = '22023'; end if;
    if exists (select 1 from public.reference_capabilities c where c.stable_key = v_key) then
      raise exception 'This key exists already. Choose that capability from the search instead.' using errcode = '23505'; end if;
  else
    raise exception 'Choose an existing or a new capability' using errcode = '22023';
  end if;
  insert into public.reference_map_draft_alignments(draft_id, item_code, kind, capability_id,
    capability_revision, stable_key, identity_definition, reviewed_name, reviewed_description, review_basis, aligned_by)
    values (p_id, p_code, v_kind, v_capability_id, v_revision, v_key, v_definition,
      v_item ->> 'name', coalesce(v_item ->> 'description', ''), v_basis, auth.uid())
    on conflict (draft_id, item_code) do update
      set kind = excluded.kind, capability_id = excluded.capability_id,
        capability_revision = excluded.capability_revision, stable_key = excluded.stable_key,
        identity_definition = excluded.identity_definition, reviewed_name = excluded.reviewed_name,
        reviewed_description = excluded.reviewed_description, review_basis = excluded.review_basis,
        aligned_by = excluded.aligned_by, aligned_at = now();
  update public.reference_map_drafts set edit_revision = edit_revision + 1,
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.reference_map_events(draft_id, action, actor_id, edit_revision)
    values (p_id, 'aligned', auth.uid(), v_draft.edit_revision + 1);
  return v_draft.edit_revision + 1;
end;
$$;
revoke all on function atlas.align_reference_map_draft_item(uuid,int,text,jsonb) from public, anon;
grant execute on function atlas.align_reference_map_draft_item(uuid,int,text,jsonb) to authenticated;

-- A single database transaction publishes the complete map. There is no
-- client-side sequence of inserts which could leave half a public version.
create function atlas.publish_reference_map_draft(p_id uuid, p_expected_revision int)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_draft public.reference_map_drafts%rowtype;
  v_map_id uuid := gen_random_uuid();
  v_item jsonb;
  v_source jsonb;
  v_stream jsonb;
  v_stage jsonb;
  v_name text;
  v_code text;
  v_alignment public.reference_map_draft_alignments%rowtype;
  v_new_capability_id uuid;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  -- Lock per sector as well as the draft. Two administrators must not race
  -- and each create a current published map for the same sector.
  select * into v_draft from public.reference_map_drafts
    where id = p_id for update;
  if not found or v_draft.status <> 'draft' or v_draft.edit_revision <> p_expected_revision then
    raise exception 'The draft changed elsewhere. Reload it before publishing.' using errcode = '40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_draft.sector, 0));
  if exists (select 1 from public.capability_maps where sector = v_draft.sector and version = v_draft.version) then
    raise exception 'This sector and version already exist' using errcode = '23505'; end if;
  if (v_draft.content ->> 'sector') is distinct from v_draft.sector
    or (v_draft.content ->> 'version') is distinct from v_draft.version::text then
    raise exception 'The draft sector and version cannot change inside its content' using errcode = '22023'; end if;
  if (v_draft.content ->> 'status') is distinct from 'draft' then
    raise exception 'The editing content must remain a draft' using errcode = '22023'; end if;
  if cardinality(atlas.reference_map_issues(v_draft.content)) <> 0 then
    raise exception 'Resolve the map validation issues before publishing' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(v_draft.content -> 'items') item
    where not exists (
      select 1 from public.reference_map_draft_alignments a
      where a.draft_id = p_id and a.item_code = item ->> 'code'
        and a.reviewed_name = item ->> 'name'
        and a.reviewed_description = coalesce(item ->> 'description', '')
    )) then raise exception 'Review the canonical identity of every new or changed capability before publishing' using errcode = '22023'; end if;

  insert into public.capability_maps(id, sector, version, status, title, summary, source_description)
    values (v_map_id, v_draft.sector, v_draft.version, 'draft',
      v_draft.content ->> 'title', v_draft.content ->> 'summary', v_draft.content ->> 'sourceDescription');
  for v_item in select value from jsonb_array_elements(v_draft.content -> 'items') order by (value ->> 'level')::int loop
    insert into public.capability_map_items(id, map_id, code, parent_code, name, description, level, item_order)
      values (gen_random_uuid(), v_map_id, v_item ->> 'code', v_item ->> 'parentCode',
        v_item ->> 'name', v_item ->> 'description', (v_item ->> 'level')::int, (v_item ->> 'order')::int);
  end loop;
  for v_source in select value from jsonb_array_elements(v_draft.content -> 'sources') loop
    insert into public.capability_map_sources(id, map_id, citation, url, reviewed_by, reviewed_at)
      values (gen_random_uuid(), v_map_id, v_source ->> 'citation', v_source ->> 'url',
        v_source ->> 'reviewedBy', (v_source ->> 'reviewedAt')::date);
  end loop;
  for v_stream in select value from jsonb_array_elements(v_draft.content -> 'valueStreams') loop
    insert into public.capability_map_value_stream_items(id, map_id, code, parent_code, name, description, item_order)
      values (gen_random_uuid(), v_map_id, v_stream ->> 'code', null, v_stream ->> 'name',
        v_stream ->> 'description', (v_stream ->> 'order')::int);
    for v_stage in select value from jsonb_array_elements(v_stream -> 'stages') loop
      insert into public.capability_map_value_stream_items(id, map_id, code, parent_code, name, description, item_order)
        values (gen_random_uuid(), v_map_id, v_stage ->> 'code', v_stream ->> 'code', v_stage ->> 'name',
          v_stage ->> 'description', (v_stage ->> 'order')::int);
      for v_name in select value #>> '{}' from jsonb_array_elements(v_stage -> 'enables') loop
        select code into strict v_code from public.capability_map_items where map_id = v_map_id and name = v_name;
        insert into public.capability_map_value_stream_enables(map_id, stage_code, capability_code)
          values (v_map_id, v_stage ->> 'code', v_code);
      end loop;
    end loop;
  end loop;
  for v_alignment in select a.* from public.reference_map_draft_alignments a
    join public.capability_map_items item on item.map_id = v_map_id and item.code = a.item_code
    where a.draft_id = p_id loop
    if v_alignment.kind = 'new' then
      v_new_capability_id := gen_random_uuid();
      insert into public.reference_capabilities(id, stable_key)
        values (v_new_capability_id, v_alignment.stable_key);
      insert into public.reference_capability_revisions(capability_id, revision, name, definition, status, published_at)
        values (v_new_capability_id, 1, v_alignment.reviewed_name,
          v_alignment.identity_definition, 'published', now());
    else
      v_new_capability_id := v_alignment.capability_id;
    end if;
    insert into public.reference_map_item_links(map_item_id, capability_id, capability_revision, review_basis, mapped_by)
      select item.id, v_new_capability_id,
        case when v_alignment.kind = 'new' then 1 else v_alignment.capability_revision end,
        v_alignment.review_basis, auth.uid()
      from public.capability_map_items item where item.map_id = v_map_id and item.code = v_alignment.item_code;
  end loop;
  update public.capability_maps set status = 'deprecated'
    where sector = v_draft.sector and status = 'published';
  update public.capability_maps set status = 'published', published_at = now() where id = v_map_id;
  update public.reference_map_drafts set status = 'published', published_map_id = v_map_id,
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.reference_map_events(draft_id, action, actor_id, edit_revision)
    values (p_id, 'published', auth.uid(), v_draft.edit_revision);
  return v_map_id;
end;
$$;
revoke all on function atlas.publish_reference_map_draft(uuid,int) from public, anon;
grant execute on function atlas.publish_reference_map_draft(uuid,int) to authenticated;
