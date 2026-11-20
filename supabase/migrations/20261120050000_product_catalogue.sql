-- Reviewed product content and immutable option citations. Additive only.
-- Public readers see published content; organisations never write the catalogue.
-- The save RPC is SECURITY INVOKER: ordinary caller RLS applies throughout.
-- No live-model facts, importer, or existing policies are changed.

create table public.product_catalogues (
  id uuid primary key,
  sector text not null check (length(btrim(sector)) between 1 and 60),
  version int not null check (version >= 1),
  capability_map_version int not null check (capability_map_version >= 1),
  status text not null default 'draft' check (status in ('draft','published')),
  title text not null check (length(btrim(title)) between 1 and 120),
  source_description text not null check (length(btrim(source_description)) between 1 and 1000),
  licence text not null default 'CC-BY-4.0' check (licence = 'CC-BY-4.0'),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_reason text check (withdrawn_reason is null or length(btrim(withdrawn_reason)) between 1 and 300),
  unique (sector, version),
  check ((status = 'draft') = (published_at is null)),
  check ((withdrawn_at is null) = (withdrawn_reason is null)),
  check (withdrawn_at is null or status = 'published')
);
create table public.catalogue_entries (
  id uuid primary key,
  catalogue_id uuid not null references public.product_catalogues(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  product text not null check (length(btrim(product)) between 1 and 120),
  vendor text not null check (length(btrim(vendor)) between 1 and 120),
  summary text not null check (length(btrim(summary)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (catalogue_id, code)
);
create table public.catalogue_entry_capabilities (
  entry_id uuid not null references public.catalogue_entries(id) on delete cascade,
  capability_code text not null check (length(btrim(capability_code)) between 1 and 40),
  capability_name text not null check (length(btrim(capability_name)) between 1 and 200),
  how_it_supports text not null check (length(btrim(how_it_supports)) between 1 and 300),
  primary key (entry_id, capability_code)
);
create table public.catalogue_claims (
  id uuid primary key,
  entry_id uuid not null references public.catalogue_entries(id) on delete cascade,
  position int not null check (position >= 1),
  statement text not null check (length(btrim(statement)) between 1 and 400),
  kind text not null check (kind in ('functional','deployment','licensing_model','support_end','integration')),
  source_url text not null check (length(source_url) <= 2000 and source_url ~ $url$^https://[^/@:\s?#]+(/[^\s]*)?$$url$),
  source_date date not null,
  reviewed_by text not null check (length(btrim(reviewed_by)) between 1 and 120),
  reviewed_at date not null check (reviewed_at >= source_date),
  created_at timestamptz not null default now(),
  unique (entry_id, position)
);
create table public.option_catalogue_sources (
  decision_id uuid not null references public.decisions(id),
  branch_id uuid not null,
  catalogue_sector text not null check (length(btrim(catalogue_sector)) between 1 and 60),
  catalogue_version int not null check (catalogue_version >= 1),
  entry_code text not null check (entry_code ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(snapshot) = 'object' and snapshot ? 'product' and pg_column_size(snapshot) <= 8000),
  cited_by uuid not null,
  cited_at timestamptz not null default now(),
  primary key (decision_id, branch_id, catalogue_sector, catalogue_version, entry_code)
);

-- Portable expression shared with productCatalogue.ts; tested in both engines.
alter table public.product_catalogues add constraint product_catalogues_sector_no_price check (sector !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.product_catalogues add constraint product_catalogues_title_no_price check (title !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.product_catalogues add constraint product_catalogues_source_description_no_price check (source_description !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.product_catalogues add constraint product_catalogues_withdrawn_reason_no_price check (withdrawn_reason !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entries add constraint catalogue_entries_code_no_price check (code !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entries add constraint catalogue_entries_product_no_price check (product !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entries add constraint catalogue_entries_vendor_no_price check (vendor !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entries add constraint catalogue_entries_summary_no_price check (summary !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entry_capabilities add constraint catalogue_entry_capabilities_capability_code_no_price check (capability_code !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entry_capabilities add constraint catalogue_entry_capabilities_capability_name_no_price check (capability_name !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_entry_capabilities add constraint catalogue_entry_capabilities_how_it_supports_no_price check (how_it_supports !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_claims add constraint catalogue_claims_statement_no_price check (statement !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_claims add constraint catalogue_claims_source_url_no_price check (source_url !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);
alter table public.catalogue_claims add constraint catalogue_claims_reviewed_by_no_price check (reviewed_by !~* $price$[£$€]|(^|[^a-z0-9_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk|pounds?|dollars?|euros?|price|prices|pricing|priced|cost|costs|costing|fees?|discount|budget|free[ \t]+of[ \t]+charge|per[ \t]+(user|seat|month|year|licence))([^a-z0-9_]|$)|(^|[^a-z_])(gbp|usd|eur|aud|cad|nzd|chf|jpy|cny|inr|zar|sek|nok|dkk)([^a-z_]|$)$price$);

-- A shared, invoker-only projection in the UNEXPOSED schema avoids two subtly
-- different snapshots for publication size validation and citation saving.
-- It adds no API endpoint and never bypasses RLS. Explicit fields only.
grant usage on schema atlas_private to service_role;
create function atlas_private.catalogue_entry_snapshot(p_entry uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'sector', c.sector, 'version', c.version, 'capabilityMapVersion', c.capability_map_version,
    'catalogueTitle', c.title, 'licence', c.licence, 'entryCode', e.code,
    'product', e.product, 'vendor', e.vendor, 'summary', e.summary,
    'capabilities', coalesce((select jsonb_agg(jsonb_build_object(
      'code', l.capability_code, 'name', l.capability_name, 'howItSupports', l.how_it_supports
    ) order by l.capability_code) from catalogue_entry_capabilities l where l.entry_id = e.id), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'position', q.position, 'kind', q.kind, 'statement', q.statement,
      'sourceUrl', q.source_url, 'sourceDate', q.source_date,
      'reviewedBy', q.reviewed_by, 'reviewedAt', q.reviewed_at
    ) order by q.position) from catalogue_claims q where q.entry_id = e.id), '[]'::jsonb)
  ) from catalogue_entries e join product_catalogues c on c.id = e.catalogue_id where e.id = p_entry;
$$;
revoke all on function atlas_private.catalogue_entry_snapshot(uuid) from public, anon, authenticated;
grant execute on function atlas_private.catalogue_entry_snapshot(uuid) to authenticated, service_role;

create function atlas.guard_product_catalogue_state()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_map uuid;
  v_entry record;
begin
  -- Serialise publication/version allocation within a sector, including inserts.
  perform pg_advisory_xact_lock(hashtextextended('product_catalogue:' || coalesce(new.sector, old.sector), 0));
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'catalogue must be inserted as draft' using errcode = '23514';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'published catalogue cannot be deleted' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.id <> old.id or new.sector <> old.sector or new.version <> old.version then
    raise exception 'catalogue identity cannot change' using errcode = '23514';
  end if;
  if old.status = 'published' then
    if (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_reason') is distinct from
       (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_reason')
       or old.withdrawn_at is not null or new.withdrawn_at is null then
      raise exception 'published catalogue is immutable; withdrawal is one-time' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status = 'published' then
    -- UPDATE already holds the parent row lock. Child writers hold FOR SHARE.
    select id into v_map from capability_maps
      where sector = new.sector and version = new.capability_map_version and status = 'published'
      for share;
    if v_map is null then
      raise exception 'catalogue requires a published starter map' using errcode = '23514';
    end if;
    if exists (select 1 from product_catalogues where sector = new.sector and id <> new.id and version >= new.version) then
      raise exception 'catalogue version must exceed every other version' using errcode = '23514';
    end if;
    if not exists (select 1 from catalogue_entries where catalogue_id = new.id) then
      raise exception 'catalogue needs an entry' using errcode = '23514';
    end if;
    for v_entry in select * from catalogue_entries where catalogue_id = new.id loop
      if (select count(*) from catalogue_claims where entry_id = v_entry.id) not between 1 and 8
         or (select count(*) from catalogue_entry_capabilities where entry_id = v_entry.id) not between 1 and 10 then
        raise exception 'entry % needs 1-8 claims and 1-10 capability links', v_entry.code using errcode = '23514';
      end if;
      if exists (select 1 from catalogue_entry_capabilities l where l.entry_id = v_entry.id and not exists (
        select 1 from capability_map_items m where m.map_id = v_map and m.code = l.capability_code and m.name = l.capability_name
      )) then
        raise exception 'entry % does not match the pinned starter map', v_entry.code using errcode = '23514';
      end if;
      -- Counts do NOT guarantee the byte limit (long URLs and multibyte text).
      if pg_column_size(atlas_private.catalogue_entry_snapshot(v_entry.id)) > 8000 then
        raise exception 'entry % snapshot exceeds 8000 bytes', v_entry.code using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function atlas.guard_product_catalogue_state() from public, anon, authenticated;
create trigger product_catalogues_guard_state before insert or update or delete on product_catalogues
for each row execute function atlas.guard_product_catalogue_state();

create function atlas.guard_catalogue_child_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_catalogue uuid; v_status text;
begin
  if tg_op = 'UPDATE' and (
    (tg_table_name = 'catalogue_entries' and (to_jsonb(new)->'catalogue_id' is distinct from to_jsonb(old)->'catalogue_id'
      or to_jsonb(new)->'id' is distinct from to_jsonb(old)->'id'))
    or (tg_table_name <> 'catalogue_entries' and to_jsonb(new)->'entry_id' is distinct from to_jsonb(old)->'entry_id')
  ) then
    raise exception 'catalogue child cannot be reparented' using errcode = '23514';
  end if;
  if tg_table_name = 'catalogue_entries' then
    v_catalogue := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'catalogue_id')::uuid;
  else
    select catalogue_id into v_catalogue from catalogue_entries
      where id = (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'entry_id')::uuid;
  end if;
  select status into v_status from product_catalogues where id = v_catalogue for share;
  -- Cascades can reach a child after its draft parent was removed.
  if tg_op = 'DELETE' and v_status is null then return old; end if;
  if (v_status = 'draft') is not true then
    raise exception 'published catalogue children are immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function atlas.guard_catalogue_child_immutable() from public, anon, authenticated;
create trigger catalogue_entries_immutable before insert or update or delete on catalogue_entries
for each row execute function atlas.guard_catalogue_child_immutable();
create trigger catalogue_entry_capabilities_immutable before insert or update or delete on catalogue_entry_capabilities
for each row execute function atlas.guard_catalogue_child_immutable();
create trigger catalogue_claims_immutable before insert or update or delete on catalogue_claims
for each row execute function atlas.guard_catalogue_child_immutable();

create function atlas.build_option_catalogue_snapshot()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_entry uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'option catalogue sources are insert-only' using errcode = '23514';
  end if;
  select e.id into v_entry from catalogue_entries e join product_catalogues c on c.id = e.catalogue_id
    where c.sector = new.catalogue_sector and c.version = new.catalogue_version
      and c.status = 'published' and e.code = new.entry_code;
  if v_entry is null then
    raise exception 'citation does not identify a published entry' using errcode = '23514';
  end if;
  new.snapshot := atlas_private.catalogue_entry_snapshot(v_entry);
  new.cited_at := now();
  return new;
end;
$$;
revoke all on function atlas.build_option_catalogue_snapshot() from public, anon, authenticated;
create trigger option_catalogue_sources_snapshot before insert or update or delete on option_catalogue_sources
for each row execute function atlas.build_option_catalogue_snapshot();

alter table public.product_catalogues enable row level security;
alter table public.product_catalogues force row level security;
revoke all on public.product_catalogues from public, anon, authenticated;
alter table public.catalogue_entries enable row level security;
alter table public.catalogue_entries force row level security;
revoke all on public.catalogue_entries from public, anon, authenticated;
alter table public.catalogue_entry_capabilities enable row level security;
alter table public.catalogue_entry_capabilities force row level security;
revoke all on public.catalogue_entry_capabilities from public, anon, authenticated;
alter table public.catalogue_claims enable row level security;
alter table public.catalogue_claims force row level security;
revoke all on public.catalogue_claims from public, anon, authenticated;
alter table public.option_catalogue_sources enable row level security;
alter table public.option_catalogue_sources force row level security;
revoke all on public.option_catalogue_sources from public, anon, authenticated;

grant select on product_catalogues, catalogue_entries, catalogue_entry_capabilities, catalogue_claims to authenticated;
grant select, insert, update, delete on product_catalogues, catalogue_entries, catalogue_entry_capabilities, catalogue_claims to service_role;
grant select, insert on option_catalogue_sources to authenticated, service_role;
create policy product_catalogues_select on product_catalogues for select to authenticated using (status = 'published');
create policy catalogue_entries_select on catalogue_entries for select to authenticated using (
  exists (select 1 from product_catalogues c where c.id = catalogue_id and c.status = 'published'));
create policy catalogue_entry_capabilities_select on catalogue_entry_capabilities for select to authenticated using (
  exists (select 1 from catalogue_entries e join product_catalogues c on c.id = e.catalogue_id
    where e.id = entry_id and c.status = 'published'));
create policy catalogue_claims_select on catalogue_claims for select to authenticated using (
  exists (select 1 from catalogue_entries e join product_catalogues c on c.id = e.catalogue_id
    where e.id = entry_id and c.status = 'published'));
create policy option_catalogue_sources_select on option_catalogue_sources for select to authenticated using (
  exists (select 1 from decisions d where d.id = decision_id and atlas.is_member(d.org_id)));
create policy option_catalogue_sources_insert on option_catalogue_sources for insert to authenticated with check (
  cited_by = (select auth.uid())
  and exists (select 1 from decisions d where d.id = decision_id and d.status = 'proposed'
    and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))
  and exists (select 1 from decision_links l where l.decision_id = option_catalogue_sources.decision_id
    and l.linked_type = 'branch' and l.linked_id = branch_id)
);

-- Contributors may add options to decisions they did not author, but existing
-- decision UPDATE RLS rightly denies them edits to those decisions. A row lock
-- also requires that UPDATE policy. Keep the public save RPC invoker-only and
-- put JUST the authorised lock in the unexposed schema, like commit_visible.
-- No row is returned or mutated; the same contributor gate is checked here.
create function atlas_private.lock_catalogue_option_decision(p_decision uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (exists (select 1 from decisions d where d.id = p_decision
      and atlas.has_role(d.org_id, 'owner', 'architect', 'contributor'))) is not true then
    raise exception 'decision unavailable for catalogue options' using errcode = '42501';
  end if;
  perform id from decisions where id = p_decision and status = 'proposed' for update;
  if not found then
    raise exception 'decision unavailable for catalogue options' using errcode = '42501';
  end if;
end;
$$;
revoke all on function atlas_private.lock_catalogue_option_decision(uuid) from public, anon, authenticated;
grant execute on function atlas_private.lock_catalogue_option_decision(uuid) to authenticated;

-- Caller supplies provenance and citation identifiers only. The server supplies
-- identity and source contents. Lock the decision to serialise duplicate saves
-- with each other and with choosing an option. No existing write path changes.
create function public.add_option_with_catalogue_sources(p_decision uuid, p_branch uuid, p_mark jsonb, p_sources jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_decision decisions;
  v_existing decision_option_marks;
  v_source jsonb;
  v_new_mark boolean;
  v_requested jsonb;
  v_saved jsonb;
begin
  perform atlas_private.lock_catalogue_option_decision(p_decision);
  select * into v_decision from decisions where id = p_decision;
  if (v_decision.status = 'proposed' and atlas.has_role(v_decision.org_id, 'owner', 'architect', 'contributor')) is not true then
    raise exception 'only a contributor or above may add an option to a proposed decision' using errcode = '42501';
  end if;
  if not exists (select 1 from branches b where b.id = p_branch and b.org_id = v_decision.org_id
      and b.model_id = v_decision.model_id and b.kind = 'change' and b.intent = 'explore' and b.status = 'draft') then
    raise exception 'option must be a draft explore branch in the decision model' using errcode = '42501';
  end if;
  if jsonb_typeof(p_mark) is distinct from 'object' or jsonb_typeof(p_sources) is distinct from 'array'
     or jsonb_array_length(p_sources) not between 1 and 10 then
    raise exception 'mark and 1-10 catalogue citations required' using errcode = '22023';
  end if;
  if (p_mark->>'agent' = 'designer') is not true then
    raise exception 'only Designer marks supported' using errcode = '22023';
  end if;
  if (p_mark->>'editedBy') is not null and (p_mark->>'editedBy')::uuid is distinct from auth.uid() then
    raise exception 'edit attribution must name the caller' using errcode = '42501';
  end if;
  if ((p_mark->>'editedBy') is null) <> ((p_mark->>'editedAt') is null) then
    raise exception 'edit identity and date must be supplied together' using errcode = '22023';
  end if;
  -- Normalise order, reject duplicate identifiers rather than hiding them.
  select jsonb_agg(jsonb_build_object('sector', x->>'sector', 'version', (x->>'version')::int, 'entryCode', x->>'entryCode')
    order by x->>'sector', (x->>'version')::int, x->>'entryCode') into v_requested from jsonb_array_elements(p_sources) x;
  if (select count(distinct x) from jsonb_array_elements(v_requested) x) <> jsonb_array_length(v_requested) then
    raise exception 'duplicate catalogue citation' using errcode = '22023';
  end if;
  select * into v_existing from decision_option_marks where decision_id = p_decision and branch_id = p_branch;
  v_new_mark := not found;
  if not v_new_mark then
    select coalesce(jsonb_agg(jsonb_build_object('sector', catalogue_sector, 'version', catalogue_version, 'entryCode', entry_code)
      order by catalogue_sector, catalogue_version, entry_code), '[]'::jsonb) into v_saved
      from option_catalogue_sources where decision_id = p_decision and branch_id = p_branch;
    if v_existing.agent is distinct from p_mark->>'agent'
      or v_existing.drafted_at is distinct from (p_mark->>'draftedAt')::timestamptz
      or v_existing.draft_run_id is distinct from (p_mark->>'draftRunId')::uuid
      or v_existing.suggested_title is distinct from p_mark->>'suggestedTitle'
      or v_existing.suggested_summary is distinct from p_mark->>'suggestedSummary'
      or v_saved is distinct from v_requested then
      raise exception 'option already saved with different provenance; use a new option' using errcode = '23514';
    end if;
    -- Do not reset a subsequent human edit on a retry.
    return;
  end if;
  if exists (select 1 from decision_links where decision_id = p_decision and linked_type = 'branch' and linked_id = p_branch) then
    raise exception 'option already exists without this catalogue provenance; use a new option' using errcode = '23514';
  end if;
  insert into decision_links(decision_id, linked_type, linked_id, created_by)
    values(p_decision, 'branch', p_branch, auth.uid());
  insert into decision_option_marks(decision_id, branch_id, agent, drafted_at, draft_run_id, suggested_title, suggested_summary, created_by)
    values(p_decision, p_branch, p_mark->>'agent', (p_mark->>'draftedAt')::timestamptz,
      (p_mark->>'draftRunId')::uuid, p_mark->>'suggestedTitle', p_mark->>'suggestedSummary', auth.uid());
  if (p_mark->>'editedBy') is not null then
    update decision_option_marks set edited_by = auth.uid(), edited_at = (p_mark->>'editedAt')::timestamptz
      where decision_id = p_decision and branch_id = p_branch;
  end if;
  for v_source in select value from jsonb_array_elements(v_requested) loop
    insert into option_catalogue_sources(decision_id, branch_id, catalogue_sector, catalogue_version, entry_code, cited_by)
      values(p_decision, p_branch, v_source->>'sector', (v_source->>'version')::int, v_source->>'entryCode', auth.uid());
  end loop;
end;
$$;
revoke all on function public.add_option_with_catalogue_sources(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_option_with_catalogue_sources(uuid, uuid, jsonb, jsonb) to authenticated;
