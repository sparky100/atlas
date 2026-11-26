-- Step 2 of the catalogue maintenance plan: link a product to a capability's
-- meaning, not to one map version (ADR-036, ADR-038).
--   1. One-off alignment of the general capabilities (codes 1-8) that have the
--      same code, name and definition in every published set.
--   2. A product can link once to a shared capability.
--   3. A helper resolves a product's links into one pinned capability set.
--   4. Validation, save, draft checks and publication use the helper.
-- No new function is callable by signed-in users (build rule 9).

-- 1. Alignment. Only a code that appears in every published set, with one name
-- and one definition throughout, is aligned. Matching names alone is never enough in general; here
-- Simon approved the bulk alignment on 26 November 2026, and the basis says so.
do $$
declare
  v_code record;
  v_cap uuid;
  v_key text;
  v_basis text;
begin
  for v_code in
    select i.code, min(i.name) as name, min(i.description) as definition,
      count(distinct m.id) as sets
    from public.capability_map_items i
    join public.capability_maps m on m.id = i.map_id and m.status = 'published'
    where i.code ~ '^[1-8](\.|$)'
    group by i.code
    having count(distinct (i.name, i.description)) = 1
      and count(distinct m.id) = (select count(*) from public.capability_maps where status = 'published')
      and bool_and(i.description is not null and btrim(i.description) <> '')
    order by i.code
  loop
    v_key := left(regexp_replace(lower(v_code.name), '[^a-z0-9]+', '-', 'g'), 90);
    v_key := regexp_replace(v_key, '(^-+|-+$)', '', 'g');
    if v_key !~ '^[a-z]' then v_key := 'general-' || v_key; end if;
    v_key := regexp_replace(v_key, '-+$', '', 'g');
    if length(v_code.name) > 200 or length(v_code.definition) > 2000 then continue; end if;
    -- Reuse an identity that an earlier alignment already made for this code.
    select l.capability_id into v_cap
      from public.reference_map_item_links l
      join public.capability_map_items i on i.id = l.map_item_id
      where i.code = v_code.code limit 1;
    if v_cap is null then
      select id into v_cap from public.reference_capabilities where stable_key = v_key;
    end if;
    if v_cap is null then
      v_cap := gen_random_uuid();
      insert into public.reference_capabilities(id, stable_key) values (v_cap, v_key);
      insert into public.reference_capability_revisions(capability_id, revision, name, definition, status, published_at)
      values (v_cap, 1, v_code.name, v_code.definition, 'published', now());
    end if;
    v_basis := left('General capability ' || v_code.code || ': the same code, name and definition in all '
      || v_code.sets::text || ' published sets. Bulk alignment approved by Simon on 26 November 2026.', 500);
    insert into public.reference_map_item_links(map_item_id, capability_id, capability_revision, review_basis, mapped_by)
      select i.id, v_cap, 1, v_basis, '00000000-0000-0000-0000-000000000000'::uuid
      from public.capability_map_items i
      join public.capability_maps m on m.id = i.map_id and m.status = 'published'
      where i.code = v_code.code
        and exists (select 1 from public.reference_capability_revisions r
          where r.capability_id = v_cap and r.revision = 1 and r.status = 'published'
            and r.name = i.name and r.definition = i.description)
      on conflict (map_item_id) do nothing;
  end loop;
end $$;

-- 2. One link from a product to a shared capability. Written only by
-- atlas.save_catalogue_product; admins can read; the browser has no write grant.
create table public.catalogue_product_general_links (
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  capability_id uuid not null references public.reference_capabilities(id) on delete restrict,
  how_it_supports text not null check (length(btrim(how_it_supports)) between 1 and 300),
  primary key (product_id, capability_id)
);
create index catalogue_product_general_links_capability_idx
  on public.catalogue_product_general_links(capability_id);
comment on table public.catalogue_product_general_links is
  'A product supports a shared capability in every sector set that aligns to it. Written only by atlas.save_catalogue_product.';

alter table public.catalogue_product_general_links enable row level security;
alter table public.catalogue_product_general_links force row level security;
create policy catalogue_product_general_links_admin_read on public.catalogue_product_general_links
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
  );
revoke all on public.catalogue_product_general_links from public, anon, authenticated;
grant select on public.catalogue_product_general_links to authenticated;
grant select, insert, update, delete on public.catalogue_product_general_links to service_role;

-- 3. The links that apply to one pinned set: the product's own links in any
-- version of that sector's set (matched by code, using the pinned set's
-- wording) plus its shared links resolved through the alignment. A sector link
-- wins over a shared link on the same code. Invoker only: revoked from
-- signed-in users, called from the guarded functions below.
create function atlas.catalogue_product_links_in_map(p_product uuid, p_map uuid)
returns table(capability_code text, capability_name text, how_it_supports text)
language sql stable
set search_path = public, pg_temp as $$
  with sector_links as (
    select distinct on (pi.code) pi.code, pi.name, l.how_it_supports
    from public.catalogue_product_capabilities l
    join public.capability_maps lm on lm.id = l.capability_map_id
    join public.capability_maps pm on pm.id = p_map and pm.sector = lm.sector
    join public.capability_map_items pi on pi.map_id = pm.id and pi.code = l.capability_code
    where l.product_id = p_product
    order by pi.code, lm.version desc
  ), shared_links as (
    select distinct on (i.code) i.code, i.name, g.how_it_supports
    from public.catalogue_product_general_links g
    join public.reference_map_item_links rl on rl.capability_id = g.capability_id
    join public.capability_map_items i on i.id = rl.map_item_id and i.map_id = p_map
    where g.product_id = p_product
    order by i.code, g.capability_id
  )
  select s.code, s.name, s.how_it_supports from sector_links s
  union all
  select g.code, g.name, g.how_it_supports from shared_links g
  where g.code not in (select code from sector_links)
$$;
revoke all on function atlas.catalogue_product_links_in_map(uuid, uuid) from public, anon, authenticated;

-- 4. Product validation and save: shared capability links.
create or replace function atlas.catalogue_product_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_item jsonb;
  v_map_id uuid;
  v_source_date date;
  v_general jsonb := coalesce(p_content -> 'generalCapabilities', '[]'::jsonb);
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['The product is not an object.']; end if;
  if nullif(btrim(p_content ->> 'code'), '') is null
    or (p_content ->> 'code') !~ '^[a-z0-9][a-z0-9-]{1,60}$' then
    v_issues := array_append(v_issues, 'Use a stable lowercase product code (2-61 letters, numbers or hyphens).');
  end if;
  if nullif(btrim(p_content ->> 'product'), '') is null or length(btrim(p_content ->> 'product')) > 120
    or nullif(btrim(p_content ->> 'vendor'), '') is null or length(btrim(p_content ->> 'vendor')) > 120
    or nullif(btrim(p_content ->> 'summary'), '') is null or length(btrim(p_content ->> 'summary')) > 500 then
    v_issues := array_append(v_issues, 'Product, vendor and summary are required (120/120/500 characters).');
  end if;
  if coalesce(jsonb_typeof(p_content -> 'capabilities'), 'null') <> 'array' then
    v_issues := array_append(v_issues, 'Capability links must be a list.');
  elsif jsonb_array_length(p_content -> 'capabilities') > 200 then
    v_issues := array_append(v_issues, 'A product can link to at most 200 capabilities.');
  else
    for v_item in select value from jsonb_array_elements(p_content -> 'capabilities') loop
      v_map_id := null;
      if jsonb_typeof(v_item) <> 'object' or nullif(v_item ->> 'capabilityMapId', '') is null
        or coalesce((v_item ->> 'capabilityMapId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is false
        or nullif(btrim(v_item ->> 'capabilityCode'), '') is null
        or nullif(btrim(v_item ->> 'capabilityName'), '') is null
        or nullif(btrim(v_item ->> 'howItSupports'), '') is null
        or length(btrim(v_item ->> 'capabilityCode')) > 40
        or length(btrim(v_item ->> 'capabilityName')) > 200
        or length(btrim(v_item ->> 'howItSupports')) > 300 then
        v_issues := array_append(v_issues, 'Every capability link needs a set, code, name and short explanation.');
        continue;
      end if;
      v_map_id := (v_item ->> 'capabilityMapId')::uuid;
      if not exists (select 1 from public.capability_map_items i
        where i.map_id = v_map_id
          and i.code = v_item ->> 'capabilityCode'
          and i.name = v_item ->> 'capabilityName') then
        v_issues := array_append(v_issues, 'Capability ' || (v_item ->> 'capabilityCode') || ' does not match its capability set.');
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(p_content -> 'capabilities') c
      group by c ->> 'capabilityMapId', c ->> 'capabilityCode' having count(*) > 1
    ) then v_issues := array_append(v_issues, 'A capability set and code can appear only once.'); end if;
  end if;
  if jsonb_typeof(v_general) <> 'array' then
    v_issues := array_append(v_issues, 'Shared capability links must be a list.');
  elsif jsonb_array_length(v_general) > 60 then
    v_issues := array_append(v_issues, 'A product can link to at most 60 shared capabilities.');
  else
    for v_item in select value from jsonb_array_elements(v_general) loop
      if jsonb_typeof(v_item) <> 'object'
        or coalesce((v_item ->> 'capabilityId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) is false
        or nullif(btrim(v_item ->> 'howItSupports'), '') is null
        or length(btrim(v_item ->> 'howItSupports')) > 300 then
        v_issues := array_append(v_issues, 'Every shared capability link needs a capability and a short explanation.');
        continue;
      end if;
      if not exists (select 1 from public.reference_capability_revisions r
        where r.capability_id = (v_item ->> 'capabilityId')::uuid and r.status = 'published') then
        v_issues := array_append(v_issues, 'A shared capability is unknown or not published.');
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(v_general) c
      group by c ->> 'capabilityId' having count(*) > 1
    ) then v_issues := array_append(v_issues, 'A shared capability can appear only once.'); end if;
  end if;
  if coalesce(jsonb_typeof(p_content -> 'claims'), 'null') <> 'array' then
    v_issues := array_append(v_issues, 'Claims must be a list.');
  elsif jsonb_array_length(p_content -> 'claims') > 200 then
    v_issues := array_append(v_issues, 'A product can have at most 200 dated claims.');
  else
    for v_item in select value from jsonb_array_elements(p_content -> 'claims') loop
      v_source_date := null;
      if coalesce((v_item ->> 'sourceDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) then
        v_source_date := (v_item ->> 'sourceDate')::date;
      end if;
      if jsonb_typeof(v_item) <> 'object'
        or coalesce((v_item ->> 'position') ~ '^[1-9][0-9]*$', false) is false
        or nullif(v_item ->> 'kind', '') is null
        or (v_item ->> 'kind') not in ('functional','deployment','licensing_model','support_end','integration')
        or nullif(btrim(v_item ->> 'statement'), '') is null or length(btrim(v_item ->> 'statement')) > 400
        or nullif(btrim(v_item ->> 'sourceUrl'), '') is null
        or coalesce((v_item ->> 'sourceUrl') ~ '^https://[^/@:\s?#]+(/[^\s]*)?$', false) is false
        or v_source_date is null then
        v_issues := array_append(v_issues, 'Every claim needs a position, kind, statement, HTTPS source and source date.');
      end if;
    end loop;
    if exists (
      select 1 from jsonb_array_elements(p_content -> 'claims') c
      group by c ->> 'position' having count(*) > 1
    ) then v_issues := array_append(v_issues, 'Claim positions must be unique.'); end if;
  end if;
  return v_issues;
end;
$$;
revoke all on function atlas.catalogue_product_issues(jsonb) from public, anon;
grant execute on function atlas.catalogue_product_issues(jsonb) to authenticated;

-- 5. Save, with shared links replaced in the same transaction.
create or replace function atlas.save_catalogue_product(p_id uuid, p_expected_revision int, p_content jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid := p_id;
  v_revision int;
  v_issues text[];
  v_item jsonb;
  v_old jsonb := '[]'::jsonb;
  v_kept jsonb;
  v_name text := atlas.catalogue_actor_name(auth.uid());
  v_review boolean;
  v_reviewed_now int := 0;
  v_state text;
  v_origin text;
  v_drafted_by uuid;
  v_drafted_by_name text;
  v_drafted_at timestamptz;
  v_by text;
  v_by_user uuid;
  v_at date;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  v_issues := atlas.catalogue_product_issues(p_content);
  if cardinality(v_issues) <> 0 then
    raise exception '%', array_to_string(v_issues, ' ') using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.catalogue_products(code, product, vendor, summary, created_by, updated_by)
    values (p_content ->> 'code', p_content ->> 'product', p_content ->> 'vendor',
      p_content ->> 'summary', auth.uid(), auth.uid())
    returning id, edit_revision into v_id, v_revision;
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (v_id, 'created', auth.uid(), v_revision);
  else
    update public.catalogue_products set
      code = p_content ->> 'code', product = p_content ->> 'product',
      vendor = p_content ->> 'vendor', summary = p_content ->> 'summary',
      edit_revision = edit_revision + 1, updated_by = auth.uid(), updated_at = now()
    where id = p_id and edit_revision = p_expected_revision
    returning edit_revision into v_revision;
    if v_revision is null then
      raise exception 'The product changed elsewhere. Reload it before saving.' using errcode = '40001';
    end if;
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_old
      from public.catalogue_product_claims c where c.product_id = p_id;
    delete from public.catalogue_product_capabilities where product_id = p_id;
    delete from public.catalogue_product_general_links where product_id = p_id;
    delete from public.catalogue_product_claims where product_id = p_id;
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (p_id, 'saved', auth.uid(), v_revision);
  end if;
  for v_item in select value from jsonb_array_elements(p_content -> 'capabilities') loop
    insert into public.catalogue_product_capabilities(product_id, capability_map_id,
      capability_code, capability_name, how_it_supports)
    values (v_id, (v_item ->> 'capabilityMapId')::uuid, v_item ->> 'capabilityCode',
      v_item ->> 'capabilityName', v_item ->> 'howItSupports');
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_content -> 'generalCapabilities', '[]'::jsonb)) loop
    insert into public.catalogue_product_general_links(product_id, capability_id, how_it_supports)
    values (v_id, (v_item ->> 'capabilityId')::uuid, btrim(v_item ->> 'howItSupports'));
  end loop;
  for v_item in select value from jsonb_array_elements(p_content -> 'claims') loop
    v_review := (v_item ->> 'review') = 'true';
    select o.j into v_kept from jsonb_array_elements(v_old) as o(j)
      where o.j ->> 'kind' = v_item ->> 'kind'
        and o.j ->> 'statement' = v_item ->> 'statement'
        and o.j ->> 'source_url' = v_item ->> 'sourceUrl'
        and o.j ->> 'source_date' = v_item ->> 'sourceDate'
      limit 1;
    if v_kept is not null then
      v_state := v_kept ->> 'review_state';
      v_origin := v_kept ->> 'origin';
      v_drafted_by := (v_kept ->> 'drafted_by')::uuid;
      v_drafted_by_name := v_kept ->> 'drafted_by_name';
      v_drafted_at := (v_kept ->> 'drafted_at')::timestamptz;
      v_by := v_kept ->> 'reviewed_by';
      v_by_user := (v_kept ->> 'reviewed_by_user')::uuid;
      v_at := (v_kept ->> 'reviewed_at')::date;
    else
      v_state := 'drafted'; v_origin := 'person'; v_drafted_by := auth.uid();
      v_drafted_by_name := v_name; v_drafted_at := now();
      v_by := null; v_by_user := null; v_at := null;
    end if;
    if v_state = 'drafted' and v_review then
      v_state := 'reviewed'; v_by := v_name; v_by_user := auth.uid();
      v_at := greatest(current_date, (v_item ->> 'sourceDate')::date);
      v_reviewed_now := v_reviewed_now + 1;
    end if;
    insert into public.catalogue_product_claims(product_id, position, kind, statement,
      source_url, source_date, review_state, origin, drafted_by, drafted_by_name, drafted_at,
      reviewed_by, reviewed_by_user, reviewed_at)
    values (v_id, (v_item ->> 'position')::int, v_item ->> 'kind', v_item ->> 'statement',
      v_item ->> 'sourceUrl', (v_item ->> 'sourceDate')::date, v_state, v_origin, v_drafted_by,
      v_drafted_by_name, v_drafted_at, v_by, v_by_user, v_at);
  end loop;
  if v_reviewed_now > 0 then
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (v_id, 'reviewed', auth.uid(), v_revision);
  end if;
  return jsonb_build_object('productId', v_id, 'revision', v_revision, 'reviewed', v_reviewed_now);
end;
$$;
revoke all on function atlas.save_catalogue_product(uuid,int,jsonb) from public, anon;
grant execute on function atlas.save_catalogue_product(uuid,int,jsonb) to authenticated;

-- 6. Validation counts the links that apply to the pinned set.
create or replace function atlas.catalogue_draft_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_product_id uuid;
  v_map_id uuid;
  v_map_version int;
  v_product public.catalogue_products%rowtype;
  v_waiting int;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then return array['The catalogue draft is not an object.']; end if;
  if nullif(btrim(p_content ->> 'sector'), '') is null
    or coalesce((p_content ->> 'version') ~ '^[1-9][0-9]*$', false) is false
    or coalesce((p_content ->> 'capabilityMapVersion') ~ '^[1-9][0-9]*$', false) is false then
    v_issues := array_append(v_issues, 'Sector, version and capability-set version are required.');
  elsif coalesce((p_content ->> 'capabilityMapVersion') ~ '^[1-9][0-9]*$', false) then
    v_map_version := (p_content ->> 'capabilityMapVersion')::int;
  end if;
  if nullif(btrim(p_content ->> 'title'), '') is null or length(btrim(p_content ->> 'title')) > 120
    or nullif(btrim(p_content ->> 'sourceDescription'), '') is null
    or length(btrim(p_content ->> 'sourceDescription')) > 1000 then
    v_issues := array_append(v_issues, 'Title (120) and source description (1000) are required.');
  end if;
  if v_map_version is not null then
    select id into v_map_id from public.capability_maps
      where sector = p_content ->> 'sector'
        and version = v_map_version
        and status = 'published';
    if v_map_id is null then
      v_issues := array_append(v_issues, 'The pinned capability set is not a published version for this sector.');
    end if;
  end if;
  if coalesce(jsonb_typeof(p_content -> 'productIds'), 'null') <> 'array' then
    return array_append(v_issues, 'Choose at least one product.');
  end if;
  if jsonb_array_length(p_content -> 'productIds') = 0 then
    return array_append(v_issues, 'Choose at least one product.');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_content -> 'productIds') id
    group by id #>> '{}' having count(*) > 1
  ) then v_issues := array_append(v_issues, 'A product can appear only once in a catalogue version.'); end if;
  if exists (
    select 1 from jsonb_array_elements(p_content -> 'productIds') id
    where (id #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then v_issues := array_append(v_issues, 'A chosen product identifier is not valid.'); end if;
  for v_product_id in select (value #>> '{}')::uuid from jsonb_array_elements(p_content -> 'productIds')
    where (value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' loop
    select * into v_product from public.catalogue_products where id = v_product_id;
    if not found then
      v_issues := array_append(v_issues, 'A chosen product is no longer available.');
      continue;
    end if;
    if not exists (select 1 from public.catalogue_product_claims c where c.product_id = v_product_id) then
      v_issues := array_append(v_issues, v_product.product || ' has no claims.');
    end if;
    if (select count(*) from public.catalogue_product_claims c where c.product_id = v_product_id) > 8 then
      v_issues := array_append(v_issues, v_product.product || ' has more than 8 claims; a catalogue entry allows at most 8.');
    end if;
    select count(*) into v_waiting from public.catalogue_product_claims c
      where c.product_id = v_product_id and c.review_state <> 'reviewed';
    if v_waiting > 0 then
      v_issues := array_append(v_issues, v_product.product || ' has ' || v_waiting::text || ' claim(s) waiting for review.');
    end if;
    if v_map_id is not null and (
      select count(*) from atlas.catalogue_product_links_in_map(v_product_id, v_map_id)
    ) not between 1 and 10 then
      v_issues := array_append(v_issues, v_product.product || ' needs 1-10 capability links that apply to this capability set (its own links plus shared capabilities); it has '
        || (select count(*) from atlas.catalogue_product_links_in_map(v_product_id, v_map_id))::text || '.');
    end if;
  end loop;
  return v_issues;
end;
$$;
revoke all on function atlas.catalogue_draft_issues(jsonb) from public, anon;
grant execute on function atlas.catalogue_draft_issues(jsonb) to authenticated;

-- 7. Publication writes the same resolved links into the frozen entry.
create or replace function atlas.publish_catalogue_draft(p_id uuid, p_expected_revision int)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_draft public.catalogue_drafts%rowtype;
  v_content jsonb;
  v_catalogue_id uuid := gen_random_uuid();
  v_map_id uuid;
  v_product_id uuid;
  v_product public.catalogue_products%rowtype;
  v_entry_id uuid;
  v_issues text[];
  v_claim record;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  select * into v_draft from public.catalogue_drafts where id = p_id for update;
  if not found or v_draft.status <> 'draft' or v_draft.edit_revision <> p_expected_revision then
    raise exception 'The draft changed elsewhere. Reload it before publishing.' using errcode = '40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('product_catalogue:' || v_draft.sector, 0));
  if exists (select 1 from public.product_catalogues where sector = v_draft.sector and version = v_draft.version) then
    raise exception 'This sector and version already exist' using errcode = '23505'; end if;
  v_content := v_draft.content;
  if (v_content ->> 'sector') is distinct from v_draft.sector
    or (v_content ->> 'version') is distinct from v_draft.version::text then
    raise exception 'The draft sector and version cannot change inside its content' using errcode = '22023'; end if;
  v_issues := atlas.catalogue_draft_issues(v_content);
  if cardinality(v_issues) <> 0 then
    raise exception '%', array_to_string(v_issues, ' ') using errcode = '22023'; end if;
  select id into v_map_id from public.capability_maps
    where sector = v_draft.sector and version = (v_content ->> 'capabilityMapVersion')::int
      and status = 'published';
  insert into public.product_catalogues(id, sector, version, capability_map_version, status,
    title, source_description, licence, published_at, withdrawn_at, withdrawn_reason)
  values (v_catalogue_id, v_draft.sector, v_draft.version,
    (v_content ->> 'capabilityMapVersion')::int, 'draft', v_content ->> 'title',
    v_content ->> 'sourceDescription', 'CC-BY-4.0', null, null, null);
  for v_product_id in select (value #>> '{}')::uuid from jsonb_array_elements(v_content -> 'productIds') loop
    select * into v_product from public.catalogue_products where id = v_product_id;
    v_entry_id := gen_random_uuid();
    insert into public.catalogue_entries(id, catalogue_id, product_id, code, product, vendor, summary)
    values (v_entry_id, v_catalogue_id, v_product.id, v_product.code, v_product.product,
      v_product.vendor, v_product.summary);
    insert into public.catalogue_entry_capabilities(entry_id, capability_code, capability_name, how_it_supports)
      select v_entry_id, l.capability_code, l.capability_name, l.how_it_supports
      from atlas.catalogue_product_links_in_map(v_product.id, v_map_id) l;
    for v_claim in select * from public.catalogue_product_claims c
      where c.product_id = v_product.id order by c.position loop
      insert into public.catalogue_claims(id, entry_id, position, kind, statement,
        source_url, source_date, reviewed_by, reviewed_at)
      values (gen_random_uuid(), v_entry_id, v_claim.position, v_claim.kind, v_claim.statement,
        v_claim.source_url, v_claim.source_date, v_claim.reviewed_by, v_claim.reviewed_at);
    end loop;
  end loop;
  update public.product_catalogues set status = 'published', published_at = now()
    where id = v_catalogue_id;
  update public.catalogue_drafts set status = 'published', published_catalogue_id = v_catalogue_id,
    updated_by = auth.uid(), updated_at = now() where id = p_id;
  insert into public.catalogue_draft_events(draft_id, action, actor_id, edit_revision)
  values (p_id, 'published', auth.uid(), v_draft.edit_revision);
  return v_catalogue_id;
end;
$$;
revoke all on function atlas.publish_catalogue_draft(uuid,int) from public, anon;
grant execute on function atlas.publish_catalogue_draft(uuid,int) to authenticated;
