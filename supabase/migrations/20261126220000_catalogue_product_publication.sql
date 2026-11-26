-- Catalogue step 4a (proposals/WALKTHROUGH-catalogue-step-4-publish-each-product.md):
-- publish each product on its own. Publishing freezes a PRODUCT REVISION: the
-- product's name, vendor and summary, its claims (with who drafted and who
-- reviewed them) and its links (shared capabilities and sector links, by
-- sector and code). It records who approved it and when. Any platform admin
-- may publish. Editing never changes a published revision; a later publish
-- makes the next one. Withdrawing is recorded with a reason; the revision
-- stays readable for saved citations.
--
-- 4a adds the record and the admin action only. Readers (capability page,
-- decisions, Designer, packs) still read sector catalogues, so users see no
-- change until 4b. The tables are readable by platform admins only.
--
-- Publishing and withdrawing are folded into the existing guarded
-- atlas.save_catalogue_product (the editor sends content.publication), so no
-- new function is callable by signed-in users (build rule 9).

create table public.catalogue_product_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalogue_products(id) on delete restrict,
  revision int not null check (revision >= 1),
  product_edit_revision int not null,
  code text not null,
  product text not null,
  vendor text not null,
  summary text not null,
  published_by uuid not null,
  published_by_name text check (length(btrim(published_by_name)) between 1 and 120),
  published_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_by_name text,
  withdrawn_reason text check (length(btrim(withdrawn_reason)) between 1 and 500),
  unique (product_id, revision),
  check ((withdrawn_at is null) = (withdrawn_reason is null))
);

create table public.catalogue_product_revision_claims (
  revision_id uuid not null references public.catalogue_product_revisions(id) on delete restrict,
  position int not null check (position >= 1),
  kind text not null check (kind in ('functional','deployment','licensing_model','support_end','integration')),
  statement text not null check (length(btrim(statement)) between 1 and 400),
  source_url text not null,
  source_date date not null,
  origin text not null check (origin in ('person','researcher','imported')),
  drafted_by_name text,
  drafted_at timestamptz not null,
  reviewed_by text not null,
  reviewed_by_user uuid,
  reviewed_at date not null,
  primary key (revision_id, position)
);

create table public.catalogue_product_revision_links (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.catalogue_product_revisions(id) on delete restrict,
  kind text not null check (kind in ('shared','sector')),
  capability_id uuid references public.reference_capabilities(id) on delete restrict,
  sector text,
  capability_code text,
  capability_name text,
  how_it_supports text not null check (length(btrim(how_it_supports)) between 1 and 300),
  check ((kind = 'shared' and capability_id is not null and sector is null and capability_code is null and capability_name is null)
      or (kind = 'sector' and capability_id is null and sector is not null and capability_code is not null and capability_name is not null))
);
create unique index catalogue_product_revision_links_shared_key
  on public.catalogue_product_revision_links(revision_id, capability_id) where kind = 'shared';
create unique index catalogue_product_revision_links_sector_key
  on public.catalogue_product_revision_links(revision_id, sector, capability_code) where kind = 'sector';
create index catalogue_product_revision_links_capability_idx
  on public.catalogue_product_revision_links(capability_id) where capability_id is not null;

comment on table public.catalogue_product_revisions is
  'An immutable published revision of a library product, with who approved it and when. Only withdrawal (once) may change a row.';

-- Frozen like the sector catalogues: no update or delete, except one-time
-- withdrawal of a revision. Trigger-only helpers, not callable through the API.
create function atlas.guard_catalogue_product_revision()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a published product revision cannot be deleted' using errcode = '23514';
  end if;
  if old.withdrawn_at is not null
    or (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_by_name' - 'withdrawn_reason')
       is distinct from (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_by_name' - 'withdrawn_reason') then
    raise exception 'a published product revision is immutable; withdrawal is one-time' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function atlas.guard_catalogue_product_revision() from public, anon, authenticated;
create trigger catalogue_product_revisions_immutable
  before update or delete on public.catalogue_product_revisions
  for each row execute function atlas.guard_catalogue_product_revision();

create function atlas.guard_catalogue_product_revision_child()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'published product revision children are immutable' using errcode = '23514';
end;
$$;
revoke all on function atlas.guard_catalogue_product_revision_child() from public, anon, authenticated;
create trigger catalogue_product_revision_claims_immutable
  before update or delete on public.catalogue_product_revision_claims
  for each row execute function atlas.guard_catalogue_product_revision_child();
create trigger catalogue_product_revision_links_immutable
  before update or delete on public.catalogue_product_revision_links
  for each row execute function atlas.guard_catalogue_product_revision_child();

alter table public.catalogue_product_revisions enable row level security;
alter table public.catalogue_product_revisions force row level security;
alter table public.catalogue_product_revision_claims enable row level security;
alter table public.catalogue_product_revision_claims force row level security;
alter table public.catalogue_product_revision_links enable row level security;
alter table public.catalogue_product_revision_links force row level security;

create policy catalogue_product_revisions_admin_read on public.catalogue_product_revisions
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_product_revision_claims_admin_read on public.catalogue_product_revision_claims
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));
create policy catalogue_product_revision_links_admin_read on public.catalogue_product_revision_links
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())));

revoke all on public.catalogue_product_revisions, public.catalogue_product_revision_claims,
  public.catalogue_product_revision_links from public, anon, authenticated;
grant select on public.catalogue_product_revisions, public.catalogue_product_revision_claims,
  public.catalogue_product_revision_links to authenticated;
grant select, insert, update, delete on public.catalogue_product_revisions, public.catalogue_product_revision_claims,
  public.catalogue_product_revision_links to service_role;

-- Product events also record publishing and withdrawing, with the actor's name.
alter table public.catalogue_product_events drop constraint catalogue_product_events_action_check;
alter table public.catalogue_product_events
  add constraint catalogue_product_events_action_check
  check (action in ('created', 'saved', 'reviewed', 'published', 'withdrawn'));

-- Product validation accepts content.publication.
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
  if p_content ? 'publication' then
    if jsonb_typeof(p_content -> 'publication') <> 'object'
      or (p_content #>> '{publication,action}') not in ('publish', 'withdraw') then
      v_issues := array_append(v_issues, 'Publication must be publish or withdraw.');
    elsif (p_content #>> '{publication,action}') = 'withdraw'
      and (nullif(btrim(p_content #>> '{publication,reason}'), '') is null
        or length(btrim(p_content #>> '{publication,reason}')) > 500) then
      v_issues := array_append(v_issues, 'Withdrawing a product needs a reason (500 characters at most).');
    end if;
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

-- Save, review, publish and withdraw in one guarded function.
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
  v_action text := p_content #>> '{publication,action}';
  v_pub int;
  v_rev_id uuid;
  v_count int;
  v_waiting int;
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
  if v_action = 'publish' then
    select count(*) into v_count from public.catalogue_product_claims where product_id = v_id;
    if v_count not between 1 and 8 then
      raise exception 'A published product needs 1-8 claims; this one has %.', v_count using errcode = '22023';
    end if;
    select count(*) into v_waiting from public.catalogue_product_claims
      where product_id = v_id and review_state <> 'reviewed';
    if v_waiting > 0 then
      raise exception '% claim(s) are waiting for review. Review them before publishing.', v_waiting using errcode = '22023';
    end if;
    if (select count(*) from public.catalogue_product_capabilities where product_id = v_id)
      + (select count(*) from public.catalogue_product_general_links where product_id = v_id) = 0 then
      raise exception 'A published product needs at least one capability link.' using errcode = '22023';
    end if;
    select coalesce(max(revision), 0) + 1 into v_pub from public.catalogue_product_revisions where product_id = v_id;
    insert into public.catalogue_product_revisions(product_id, revision, product_edit_revision, code, product, vendor, summary,
      published_by, published_by_name)
    select p.id, v_pub, p.edit_revision, p.code, p.product, p.vendor, p.summary, auth.uid(), v_name
      from public.catalogue_products p where p.id = v_id
    returning id into v_rev_id;
    insert into public.catalogue_product_revision_claims(revision_id, position, kind, statement, source_url, source_date,
      origin, drafted_by_name, drafted_at, reviewed_by, reviewed_by_user, reviewed_at)
    select v_rev_id, c.position, c.kind, c.statement, c.source_url, c.source_date,
      c.origin, c.drafted_by_name, c.drafted_at, c.reviewed_by, c.reviewed_by_user, c.reviewed_at
      from public.catalogue_product_claims c where c.product_id = v_id;
    insert into public.catalogue_product_revision_links(revision_id, kind, capability_id, how_it_supports)
    select v_rev_id, 'shared', g.capability_id, g.how_it_supports
      from public.catalogue_product_general_links g where g.product_id = v_id;
    insert into public.catalogue_product_revision_links(revision_id, kind, sector, capability_code, capability_name, how_it_supports)
    select distinct on (m.sector, l.capability_code) v_rev_id, 'sector', m.sector, l.capability_code, l.capability_name, l.how_it_supports
      from public.catalogue_product_capabilities l
      join public.capability_maps m on m.id = l.capability_map_id
      where l.product_id = v_id
      order by m.sector, l.capability_code, m.version desc;
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (v_id, 'published', auth.uid(), v_revision);
  elsif v_action = 'withdraw' then
    update public.catalogue_product_revisions
      set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_by_name = v_name,
          withdrawn_reason = btrim(p_content #>> '{publication,reason}')
      where id = (select r.id from public.catalogue_product_revisions r where r.product_id = v_id order by r.revision desc limit 1)
        and withdrawn_at is null;
    if not found then
      raise exception 'This product is not published, so there is nothing to withdraw.' using errcode = '22023';
    end if;
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (v_id, 'withdrawn', auth.uid(), v_revision);
  end if;
  return jsonb_build_object('productId', v_id, 'revision', v_revision, 'reviewed', v_reviewed_now,
    'published', v_pub, 'withdrawn', v_action = 'withdraw');
end;
$$;
revoke all on function atlas.save_catalogue_product(uuid,int,jsonb) from public, anon;
grant execute on function atlas.save_catalogue_product(uuid,int,jsonb) to authenticated;
