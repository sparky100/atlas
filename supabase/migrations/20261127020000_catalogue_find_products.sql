-- Catalogue step 6a (proposals/WALKTHROUGH-catalogue-step-6a-find-new-products.md):
-- "Find new products for a capability".
--
-- * The run record gains a "find" scope and two counters (searches made,
--   products found). Browsers can write the new columns on their own manual
--   runs, exactly as for the other counters.
-- * save_catalogue_product accepts claim origin "researcher" for a claim that is
--   new in the save, so a product the Researcher found is marked as such for as
--   long as it stands (rule A1). Every other new claim is still "person". A kept
--   claim keeps its origin. Only a platform admin can call it, as before.
-- No new table, no new callable function, no new grant on existing functions.

do $$
declare v_name text;
begin
  select c.conname into v_name from pg_constraint c
    where c.conrelid = 'public.catalogue_check_runs'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%scope%' limit 1;
  if v_name is not null then
    execute format('alter table public.catalogue_check_runs drop constraint %I', v_name);
  end if;
end;
$$;
alter table public.catalogue_check_runs
  add constraint catalogue_check_runs_scope_check check (scope in ('links', 'claims', 'both', 'find'));
alter table public.catalogue_check_runs
  add column searches int not null default 0 check (searches >= 0),
  add column products_found int not null default 0 check (products_found >= 0);
grant update (searches, products_found) on public.catalogue_check_runs to authenticated;

-- manual runs may now also be "find"; the existing insert grant already covers (kind, scope).

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
      v_state := 'drafted'; v_origin := case when v_item ->> 'origin' = 'researcher' then 'researcher' else 'person' end; v_drafted_by := auth.uid();
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
