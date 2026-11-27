-- Platforms and components, step C1 (proposals/WALKTHROUGH-catalogue-platforms-step-C.md):
-- a published version records the platform it is part of, and the components a
-- platform had, by name, as they were when it was published.
--
-- * catalogue_product_revisions gains part_of_name and component_names. Only
--   products that are themselves published are named, so a draft product's name
--   is never shown to users. The columns are frozen with the rest of the
--   revision (the existing immutability trigger).
-- * Signed-in users may read the two columns, as they read the rest of a
--   published revision (names only, no user ids).
-- * atlas.catalogue_product_is_published: a trigger-only helper, not callable
--   through the API (build rule 9).
-- * save_catalogue_product records them when it publishes.
-- No new callable function.

alter table public.catalogue_product_revisions
  add column part_of_name text check (part_of_name is null or length(btrim(part_of_name)) between 1 and 120),
  add column component_names text[] not null default '{}'::text[];

grant select (part_of_name, component_names) on public.catalogue_product_revisions to authenticated;

create function atlas.catalogue_product_is_published(p_id uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.catalogue_product_revisions r
    where r.product_id = p_id and r.withdrawn_at is null
      and r.revision = (select max(r2.revision) from public.catalogue_product_revisions r2 where r2.product_id = p_id));
$$;
revoke all on function atlas.catalogue_product_is_published(uuid) from public, anon, authenticated;

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
    insert into public.catalogue_products(code, product, vendor, summary, part_of_product_id, created_by, updated_by)
    values (p_content ->> 'code', p_content ->> 'product', p_content ->> 'vendor',
      p_content ->> 'summary', nullif(p_content ->> 'partOfProductId', '')::uuid, auth.uid(), auth.uid())
    returning id, edit_revision into v_id, v_revision;
    insert into public.catalogue_product_events(product_id, action, actor_id, edit_revision)
    values (v_id, 'created', auth.uid(), v_revision);
  else
    update public.catalogue_products set
      code = p_content ->> 'code', product = p_content ->> 'product',
      vendor = p_content ->> 'vendor', summary = p_content ->> 'summary',
      -- A save that does not mention "part of" leaves it as it was; null clears it.
      part_of_product_id = case when p_content ? 'partOfProductId' then nullif(p_content ->> 'partOfProductId', '')::uuid else part_of_product_id end,
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
    -- A platform may be published with no links of its own: its components carry them (rule M3).
    if (select count(*) from public.catalogue_product_capabilities where product_id = v_id)
      + (select count(*) from public.catalogue_product_general_links where product_id = v_id) = 0
      and not exists (select 1 from public.catalogue_products c where c.part_of_product_id = v_id) then
      raise exception 'A published product needs at least one capability link, or components that have them.' using errcode = '22023';
    end if;
    select coalesce(max(revision), 0) + 1 into v_pub from public.catalogue_product_revisions where product_id = v_id;
    -- The platform and the components are recorded by name, and only those users can already see: a product that is not published is not named.
    insert into public.catalogue_product_revisions(product_id, revision, product_edit_revision, code, product, vendor, summary,
      published_by, published_by_name, part_of_name, component_names)
    select p.id, v_pub, p.edit_revision, p.code, p.product, p.vendor, p.summary, auth.uid(), v_name,
      (select pp.product from public.catalogue_products pp
        where pp.id = p.part_of_product_id and atlas.catalogue_product_is_published(pp.id)),
      coalesce((select array_agg(c.product order by c.product) from public.catalogue_products c
        where c.part_of_product_id = p.id and atlas.catalogue_product_is_published(c.id)), '{}'::text[])
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
