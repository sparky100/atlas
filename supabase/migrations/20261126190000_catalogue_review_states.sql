-- Catalogue review states (proposals/PROPOSAL-catalogue-maintenance.md, step 1;
-- Simon, 2026-11-26). A product claim is first DRAFTED (typed by a person, or
-- later found by the Researcher) and then REVIEWED. Reviewing is its own
-- action, recorded with the reviewer's name and date, and the server decides
-- it: a browser can no longer type itself in as the reviewer. Any platform
-- admin may review, including the person who drafted the claim. Publication
-- refuses a product with a claim that is not reviewed. Who published a version
-- is recorded in the existing draft events, which now carry the actor's name.
--
-- Additive and forward-only. Published entries, claims and saved citations are
-- not touched. The 20 claims already in the library were reviewed before this
-- change and stay reviewed, with the reviewer text they already carry.

-- 1. Claim states, with who drafted and who reviewed.
alter table public.catalogue_product_claims
  add column review_state text not null default 'drafted'
    check (review_state in ('drafted', 'reviewed')),
  add column origin text not null default 'person'
    check (origin in ('person', 'researcher', 'imported')),
  add column drafted_by uuid,
  add column drafted_by_name text check (length(btrim(drafted_by_name)) between 1 and 120),
  add column drafted_at timestamptz not null default now(),
  add column reviewed_by_user uuid,
  alter column reviewed_by drop not null,
  alter column reviewed_at drop not null;

-- Claims that exist today were loaded with a named review.
update public.catalogue_product_claims
set review_state = 'reviewed', origin = 'imported', drafted_at = created_at;

alter table public.catalogue_product_claims
  add constraint catalogue_product_claims_review_complete
  check ((review_state = 'reviewed') = (reviewed_by is not null and reviewed_at is not null));

create index catalogue_product_claims_waiting_idx
  on public.catalogue_product_claims (product_id, position) where review_state = 'drafted';

comment on column public.catalogue_product_claims.review_state is
  'drafted until a platform admin reviews it; reviewed claims carry reviewed_by (name), reviewed_by_user and reviewed_at. Set only by atlas.save_catalogue_product.';
comment on column public.catalogue_product_claims.origin is
  'Who wrote the claim: a person in the editor, the Researcher (a later step), or imported from a file.';

-- 2. Events record the acting person's name as well as their id.
alter table public.catalogue_product_events drop constraint catalogue_product_events_action_check;
alter table public.catalogue_product_events
  add constraint catalogue_product_events_action_check check (action in ('created', 'saved', 'reviewed')),
  add column actor_name text;
alter table public.catalogue_draft_events add column actor_name text;

-- 3. The acting person's readable name, worked out on the server. Helper only:
-- not callable through the API.
create function atlas.catalogue_actor_name(p_user uuid)
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select left(coalesce(
    nullif(btrim(p.display_name), ''),
    nullif(btrim(p.handle), ''),
    nullif(btrim(split_part(u.email, '@', 1)), ''),
    'Platform admin'), 120)
  from (select 1) one
  left join atlas.profiles p on p.user_id = p_user
  left join auth.users u on u.id = p_user
$$;
revoke all on function atlas.catalogue_actor_name(uuid) from public, anon, authenticated;

create function atlas.catalogue_event_actor_name()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  new.actor_name := coalesce(new.actor_name, atlas.catalogue_actor_name(new.actor_id));
  return new;
end;
$$;
revoke all on function atlas.catalogue_event_actor_name() from public, anon, authenticated;
create trigger catalogue_product_events_actor_name before insert on public.catalogue_product_events
  for each row execute function atlas.catalogue_event_actor_name();
create trigger catalogue_draft_events_actor_name before insert on public.catalogue_draft_events
  for each row execute function atlas.catalogue_event_actor_name();

-- 4. Product validation: a claim no longer carries a reviewer. The browser
-- sends the statement and its source; the server records who drafted it.
create or replace function atlas.catalogue_product_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_item jsonb;
  v_map_id uuid;
  v_source_date date;
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

-- 5. Saving a product, and reviewing, in one function. A claim whose
-- statement, kind, source and source date are unchanged keeps its state (who
-- drafted it, whether and by whom it was reviewed). A new or changed claim is a
-- new draft by the person saving. A claim sent with "review": true is marked
-- reviewed by the person saving, and the server writes that person's name: the
-- browser cannot name a reviewer. Reviewing is folded into this existing
-- function rather than a new one, so no new function is callable by signed-in
-- users (build rule 9: no new advisor finding).
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

-- 6. Publication: every claim of every chosen product must be reviewed. Same
-- body as before, with the "pending review" text marker replaced by the state.
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
      select count(*) from public.catalogue_product_capabilities l
        where l.product_id = v_product_id and l.capability_map_id = v_map_id
    ) not between 1 and 10 then
      v_issues := array_append(v_issues, v_product.product || ' needs 1-10 capability links in this capability set.');
    end if;
  end loop;
  return v_issues;
end;
$$;
revoke all on function atlas.catalogue_draft_issues(jsonb) from public, anon;
grant execute on function atlas.catalogue_draft_issues(jsonb) to authenticated;
