-- Platform-owned product library and editable sector-catalogue drafts.
--
-- The same product can support capabilities in several sectors. Product
-- identity, claims and capability links are therefore stored once in
-- `catalogue_products`/`catalogue_product_claims`/`catalogue_product_capabilities`,
-- not repeated in each sector's catalogue. A sector catalogue is a fixed
-- publication snapshot: `catalogue_drafts` selects products, and publication
-- writes the existing immutable `catalogue_entries` rows. Published
-- catalogues and saved option snapshots are never rewritten.
--
-- All writes are platform-admin-only SECURITY DEFINER operations. Direct
-- authenticated writes are denied; ordinary users continue to read only
-- published catalogue rows through the existing policies.

create table public.catalogue_products (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  product text not null check (length(btrim(product)) between 1 and 120),
  vendor text not null check (length(btrim(vendor)) between 1 and 120),
  summary text not null check (length(btrim(summary)) between 1 and 500),
  edit_revision int not null default 1 check (edit_revision > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code)
);
create unique index catalogue_products_identity_key
  on public.catalogue_products (lower(btrim(vendor)), lower(btrim(product)));

create table public.catalogue_product_capabilities (
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  capability_map_id uuid not null references public.capability_maps(id) on delete restrict,
  capability_code text not null check (length(btrim(capability_code)) between 1 and 40),
  capability_name text not null check (length(btrim(capability_name)) between 1 and 200),
  how_it_supports text not null check (length(btrim(how_it_supports)) between 1 and 300),
  primary key (product_id, capability_map_id, capability_code),
  foreign key (capability_map_id, capability_code)
    references public.capability_map_items(map_id, code) on delete restrict
);
create index catalogue_product_capabilities_map_idx
  on public.catalogue_product_capabilities(capability_map_id, capability_code);

create table public.catalogue_product_claims (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalogue_products(id) on delete cascade,
  position int not null check (position >= 1),
  kind text not null check (kind in ('functional','deployment','licensing_model','support_end','integration')),
  statement text not null check (length(btrim(statement)) between 1 and 400),
  source_url text not null check (length(source_url) <= 2000 and source_url ~ $url$^https://[^/@:\s?#]+(/[^\s]*)?$$url$),
  source_date date not null,
  reviewed_by text not null check (length(btrim(reviewed_by)) between 1 and 120),
  reviewed_at date not null check (reviewed_at >= source_date),
  created_at timestamptz not null default now(),
  unique (product_id, position)
);
create index catalogue_product_claims_product_idx on public.catalogue_product_claims(product_id, position);

create table public.catalogue_drafts (
  id uuid primary key default gen_random_uuid(),
  base_catalogue_id uuid references public.product_catalogues(id) on delete restrict,
  sector text not null check (btrim(sector) <> ''),
  version int not null check (version > 0),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  edit_revision int not null default 1 check (edit_revision > 0),
  status text not null default 'draft' check (status in ('draft','published')),
  published_catalogue_id uuid references public.product_catalogues(id) on delete restrict,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sector, version),
  check ((status = 'published') = (published_catalogue_id is not null))
);
create index catalogue_drafts_base_idx on public.catalogue_drafts(base_catalogue_id) where base_catalogue_id is not null;
create index catalogue_drafts_published_idx on public.catalogue_drafts(published_catalogue_id) where published_catalogue_id is not null;

create table public.catalogue_product_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalogue_products(id) on delete restrict,
  action text not null check (action in ('created','saved')),
  actor_id uuid not null,
  edit_revision int not null,
  happened_at timestamptz not null default now()
);
create index catalogue_product_events_product_idx on public.catalogue_product_events(product_id, happened_at);

create table public.catalogue_draft_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.catalogue_drafts(id) on delete restrict,
  action text not null check (action in ('created','saved','published')),
  actor_id uuid not null,
  edit_revision int not null,
  happened_at timestamptz not null default now()
);
create index catalogue_draft_events_draft_idx on public.catalogue_draft_events(draft_id, happened_at);

-- Existing entries keep their own snapshot. The new column is a permanent
-- pointer to the canonical product identity. It is null for existing published
-- entries because the immutability trigger refuses any update to them; the
-- platform reader resolves those by code, then vendor/product. New public
-- versions get the pointer at publication. A legacy script load that does not
-- know about the library may also leave it null.
alter table public.catalogue_entries
  add column product_id uuid references public.catalogue_products(id) on delete restrict;
create index catalogue_entries_product_idx on public.catalogue_entries(product_id) where product_id is not null;

-- ---------------------------------------------------------------------------
-- Additive backfill: one product row per normalised vendor/product pair.
-- Published snapshots and saved citations are untouched. Where two entries
-- share a code, the later product gets a deterministic suffix; where they
-- share a product, the earliest entry supplies the profile.
-- ---------------------------------------------------------------------------
with entries as (
  select e.*, lower(btrim(e.vendor)) || '|' || lower(btrim(e.product)) as product_key
  from public.catalogue_entries e
),
ranked as (
  select entries.*,
    row_number() over (partition by product_key order by created_at, id) as product_rank,
    row_number() over (partition by code order by created_at, id) as code_rank
  from entries
)
insert into public.catalogue_products (id, code, product, vendor, summary,
  edit_revision, created_by, updated_by, created_at, updated_at)
select gen_random_uuid(),
  case when code_rank = 1 then code
       else left(code, 52) || '-' || substr(md5(product_key), 1, 8) end,
  product, vendor, summary, 1,
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  created_at, created_at
from ranked
where product_rank = 1;

-- Only draft entries may be backfilled. The existing catalogue child
-- immutability trigger deliberately refuses any update to a published entry,
-- even an additive pointer. Published entries therefore keep product_id null;
-- the admin reader resolves their product by code, then vendor/product.
update public.catalogue_entries e
set product_id = p.id
from public.catalogue_products p, public.product_catalogues c
where c.id = e.catalogue_id
  and c.status = 'draft'
  and e.product_id is null
  and lower(btrim(e.vendor)) = lower(btrim(p.vendor))
  and lower(btrim(e.product)) = lower(btrim(p.product));

insert into public.catalogue_product_capabilities
  (product_id, capability_map_id, capability_code, capability_name, how_it_supports)
select distinct on (p.id, m.id, l.capability_code)
  p.id, m.id, l.capability_code, l.capability_name, l.how_it_supports
from public.catalogue_entries e
join public.catalogue_products p
  on lower(btrim(e.vendor)) = lower(btrim(p.vendor))
 and lower(btrim(e.product)) = lower(btrim(p.product))
join public.product_catalogues c on c.id = e.catalogue_id
join public.capability_maps m on m.sector = c.sector and m.version = c.capability_map_version
join public.catalogue_entry_capabilities l on l.entry_id = e.id
where exists (select 1 from public.capability_map_items i
    where i.map_id = m.id and i.code = l.capability_code and i.name = l.capability_name)
order by p.id, m.id, l.capability_code, c.created_at, e.created_at
on conflict do nothing;

with candidates as (
  select distinct on (p.id, q.kind, q.statement, q.source_url, q.source_date)
    p.id as product_id, q.kind, q.statement, q.source_url, q.source_date, q.reviewed_by, q.reviewed_at
  from public.catalogue_entries e
  join public.catalogue_products p
    on lower(btrim(e.vendor)) = lower(btrim(p.vendor))
   and lower(btrim(e.product)) = lower(btrim(p.product))
  join public.catalogue_claims q on q.entry_id = e.id
  order by p.id, q.kind, q.statement, q.source_url, q.source_date, q.reviewed_at desc, q.id
), numbered as (
  select candidates.*,
    row_number() over (partition by product_id order by source_date, source_url, kind, statement) as position
  from candidates
)
insert into public.catalogue_product_claims
  (product_id, position, kind, statement, source_url, source_date, reviewed_by, reviewed_at)
select product_id, position, kind, statement, source_url, source_date, reviewed_by, reviewed_at
from numbered;

-- ---------------------------------------------------------------------------
-- RLS: product content, no organisation. The library and its drafts are
-- platform-admin only; published sector catalogues keep their existing
-- world-readable policy.
-- ---------------------------------------------------------------------------
alter table public.catalogue_products enable row level security;
alter table public.catalogue_products force row level security;
alter table public.catalogue_product_capabilities enable row level security;
alter table public.catalogue_product_capabilities force row level security;
alter table public.catalogue_product_claims enable row level security;
alter table public.catalogue_product_claims force row level security;
alter table public.catalogue_drafts enable row level security;
alter table public.catalogue_drafts force row level security;
alter table public.catalogue_product_events enable row level security;
alter table public.catalogue_product_events force row level security;
alter table public.catalogue_draft_events enable row level security;
alter table public.catalogue_draft_events force row level security;

create policy catalogue_products_admin_read on public.catalogue_products
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_product_capabilities_admin_read on public.catalogue_product_capabilities
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_product_claims_admin_read on public.catalogue_product_claims
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_drafts_admin_read on public.catalogue_drafts
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_product_events_admin_read on public.catalogue_product_events
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_draft_events_admin_read on public.catalogue_draft_events
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));

revoke all on public.catalogue_products, public.catalogue_product_capabilities,
  public.catalogue_product_claims, public.catalogue_drafts,
  public.catalogue_product_events, public.catalogue_draft_events
  from public, anon, authenticated;
grant select on public.catalogue_products, public.catalogue_product_capabilities,
  public.catalogue_product_claims, public.catalogue_drafts,
  public.catalogue_product_events, public.catalogue_draft_events
  to authenticated;
grant select, insert, update, delete on public.catalogue_products,
  public.catalogue_product_capabilities, public.catalogue_product_claims,
  public.catalogue_drafts, public.catalogue_product_events, public.catalogue_draft_events
  to service_role;

-- Existing published-only policy remains; this additional permissive policy
-- lets the platform editor inspect draft versions too.
create policy product_catalogues_admin_read on public.product_catalogues
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_entries_admin_read on public.catalogue_entries
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_entry_capabilities_admin_read on public.catalogue_entry_capabilities
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));
create policy catalogue_claims_admin_read on public.catalogue_claims
  for select to authenticated using
    (exists (select 1 from public.platform_admins where user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Validation shared by the editor and by publication. The browser can never
-- bypass it: publication calls the same function inside its transaction.
-- ---------------------------------------------------------------------------
create function atlas.catalogue_product_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_item jsonb;
  v_map_id uuid;
  v_source_date date;
  v_reviewed_at date;
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
      v_reviewed_at := null;
      if coalesce((v_item ->> 'sourceDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) then
        v_source_date := (v_item ->> 'sourceDate')::date;
      end if;
      if coalesce((v_item ->> 'reviewedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) then
        v_reviewed_at := (v_item ->> 'reviewedAt')::date;
      end if;
      if jsonb_typeof(v_item) <> 'object'
        or coalesce((v_item ->> 'position') ~ '^[1-9][0-9]*$', false) is false
        or nullif(v_item ->> 'kind', '') is null
        or (v_item ->> 'kind') not in ('functional','deployment','licensing_model','support_end','integration')
        or nullif(btrim(v_item ->> 'statement'), '') is null or length(btrim(v_item ->> 'statement')) > 400
        or nullif(btrim(v_item ->> 'sourceUrl'), '') is null
        or coalesce((v_item ->> 'sourceUrl') ~ '^https://[^/@:\s?#]+(/[^\s]*)?$', false) is false
        or v_source_date is null
        or nullif(btrim(v_item ->> 'reviewedBy'), '') is null or length(btrim(v_item ->> 'reviewedBy')) > 120
        or v_reviewed_at is null
        or v_reviewed_at < v_source_date then
        v_issues := array_append(v_issues, 'Every claim needs a position, kind, statement, HTTPS source, source date and reviewer on or after the source date.');
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

create function atlas.catalogue_draft_issues(p_content jsonb)
returns text[] language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_issues text[] := '{}';
  v_product_id uuid;
  v_map_id uuid;
  v_map_version int;
  v_product public.catalogue_products%rowtype;
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
    if exists (select 1 from public.catalogue_product_claims c
      where c.product_id = v_product_id and c.reviewed_by ~* 'pending') then
      v_issues := array_append(v_issues, v_product.product || ' still has a claim marked pending review.');
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

-- ---------------------------------------------------------------------------
-- Product library write path. One transaction replaces the product's links
-- and claims, so a half-saved product can never be published.
-- ---------------------------------------------------------------------------
create function atlas.save_catalogue_product(p_id uuid, p_expected_revision int, p_content jsonb)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid := p_id;
  v_revision int;
  v_issues text[];
  v_item jsonb;
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
    insert into public.catalogue_product_claims(product_id, position, kind, statement,
      source_url, source_date, reviewed_by, reviewed_at)
    values (v_id, (v_item ->> 'position')::int, v_item ->> 'kind', v_item ->> 'statement',
      v_item ->> 'sourceUrl', (v_item ->> 'sourceDate')::date,
      v_item ->> 'reviewedBy', (v_item ->> 'reviewedAt')::date);
  end loop;
  return jsonb_build_object('productId', v_id, 'revision', v_revision);
end;
$$;
revoke all on function atlas.save_catalogue_product(uuid,int,jsonb) from public, anon;
grant execute on function atlas.save_catalogue_product(uuid,int,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Sector catalogue drafts. A draft is only a selection; product content stays
-- in the one canonical library row.
-- ---------------------------------------------------------------------------
create function atlas.create_catalogue_draft(p_sector text, p_version int, p_base_catalogue_id uuid, p_content jsonb)
returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_sector is null or btrim(p_sector) = '' or p_version is null or p_version < 1
    or exists (select 1 from public.product_catalogues where sector = p_sector and version = p_version)
    or exists (select 1 from public.catalogue_drafts where sector = p_sector and version = p_version) then
    raise exception 'Choose an unused positive version for this sector' using errcode = '22023';
  end if;
  if p_base_catalogue_id is not null and not exists (
    select 1 from public.product_catalogues where id = p_base_catalogue_id and sector = p_sector and status = 'published'
  ) then raise exception 'The starting catalogue must be a published version in this sector' using errcode = '22023'; end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Draft content must be an object' using errcode = '22023'; end if;
  if (p_content ->> 'sector') is distinct from p_sector
    or (p_content ->> 'version') is distinct from p_version::text then
    raise exception 'The draft sector and version must match its content' using errcode = '22023'; end if;
  insert into public.catalogue_drafts(base_catalogue_id, sector, version, content, created_by, updated_by)
  values (p_base_catalogue_id, p_sector, p_version, p_content, auth.uid(), auth.uid())
  returning id into v_id;
  insert into public.catalogue_draft_events(draft_id, action, actor_id, edit_revision)
  values (v_id, 'created', auth.uid(), 1);
  return v_id;
end;
$$;
revoke all on function atlas.create_catalogue_draft(text,int,uuid,jsonb) from public, anon;
grant execute on function atlas.create_catalogue_draft(text,int,uuid,jsonb) to authenticated;

create function atlas.save_catalogue_draft(p_id uuid, p_expected_revision int, p_content jsonb)
returns int language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_revision int; v_draft public.catalogue_drafts%rowtype; v_map_version int;
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'Draft content must be an object' using errcode = '22023'; end if;
  select * into v_draft from public.catalogue_drafts where id = p_id and status = 'draft' for update;
  if not found or v_draft.edit_revision <> p_expected_revision then
    raise exception 'The draft changed elsewhere. Reload it before saving.' using errcode = '40001'; end if;
  if coalesce((p_content ->> 'capabilityMapVersion') ~ '^[1-9][0-9]*$', false) then
    v_map_version := (p_content ->> 'capabilityMapVersion')::int;
  end if;
  if (p_content ->> 'sector') is distinct from v_draft.sector
    or (p_content ->> 'version') is distinct from v_draft.version::text
    or v_map_version is null
    or not exists (select 1 from public.capability_maps where sector = v_draft.sector
      and version = v_map_version) then
    raise exception 'The sector, version or capability set is not valid for this draft' using errcode = '22023'; end if;
  if coalesce(jsonb_typeof(p_content -> 'productIds'), 'null') <> 'array' then
    raise exception 'Products must be a list' using errcode = '22023'; end if;
  update public.catalogue_drafts set content = p_content, edit_revision = edit_revision + 1,
    updated_by = auth.uid(), updated_at = now()
    where id = p_id returning edit_revision into v_revision;
  insert into public.catalogue_draft_events(draft_id, action, actor_id, edit_revision)
  values (p_id, 'saved', auth.uid(), v_revision);
  return v_revision;
end;
$$;
revoke all on function atlas.save_catalogue_draft(uuid,int,jsonb) from public, anon;
grant execute on function atlas.save_catalogue_draft(uuid,int,jsonb) to authenticated;

-- Publication is one transaction: it creates the immutable entries and only
-- then publishes the parent row, so the existing database guard still runs.
create function atlas.publish_catalogue_draft(p_id uuid, p_expected_revision int)
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
      from public.catalogue_product_capabilities l
      where l.product_id = v_product.id and l.capability_map_id = v_map_id;
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

create function atlas.withdraw_catalogue(p_id uuid, p_reason text)
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.platform_admins where user_id = auth.uid()) is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 300 then
    raise exception 'Give a withdrawal reason (300 characters at most)' using errcode = '22023';
  end if;
  update public.product_catalogues set withdrawn_at = now(), withdrawn_reason = btrim(p_reason)
    where id = p_id and status = 'published' and withdrawn_at is null;
  if not found then raise exception 'Only a current published catalogue can be withdrawn' using errcode = '22023'; end if;
end;
$$;
revoke all on function atlas.withdraw_catalogue(uuid,text) from public, anon;
grant execute on function atlas.withdraw_catalogue(uuid,text) to authenticated;
