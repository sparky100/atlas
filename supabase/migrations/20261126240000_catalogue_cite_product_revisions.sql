-- Catalogue step 4b-2 (proposals/WALKTHROUGH-catalogue-step-4b-reader-switch.md):
-- an option can cite a published PRODUCT revision, saved with a snapshot, in the
-- same table and through the same two save functions as a sector catalogue
-- entry. A citation to a product revision is
--   catalogue_sector = 'product', catalogue_version = the revision number,
--   entry_code = the product's stable code.
-- 'product' is not a sector, so it cannot collide with a sector catalogue, and
-- every existing citation reads exactly as before. No new function is callable
-- by signed-in users; the snapshot trigger function is replaced in place.

create function atlas_private.product_revision_snapshot(p_revision uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'sector', 'product', 'version', r.revision,
    'catalogueTitle', 'Product library', 'licence', 'Atlas product library',
    'entryCode', r.code, 'product', r.product, 'vendor', r.vendor, 'summary', r.summary,
    'approvedByName', r.published_by_name, 'approvedAt', r.published_at,
    'capabilities', '[]'::jsonb,
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'position', q.position, 'kind', q.kind, 'statement', q.statement,
      'sourceUrl', q.source_url, 'sourceDate', q.source_date,
      'reviewedBy', q.reviewed_by, 'reviewedAt', q.reviewed_at
    ) order by q.position) from catalogue_product_revision_claims q where q.revision_id = r.id), '[]'::jsonb)
  ) from catalogue_product_revisions r where r.id = p_revision;
$$;
revoke all on function atlas_private.product_revision_snapshot(uuid) from public, anon, authenticated;
grant execute on function atlas_private.product_revision_snapshot(uuid) to authenticated, service_role;

create or replace function atlas.build_option_catalogue_snapshot()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_entry uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'option catalogue sources are insert-only' using errcode = '23514';
  end if;
  if new.catalogue_sector = 'product' then
    -- Only a product that is published now (newest revision, not withdrawn) can
    -- be newly cited. The signed-in user's own read access decides what exists.
    select r.id into v_entry from catalogue_product_revisions r
      where r.code = new.entry_code and r.revision = new.catalogue_version
        and r.withdrawn_at is null and r.superseded_at is null;
    if v_entry is null then
      raise exception 'citation does not identify a published product revision' using errcode = '23514';
    end if;
    new.snapshot := atlas_private.product_revision_snapshot(v_entry);
    if pg_column_size(new.snapshot) > 8000 then
      raise exception 'product revision snapshot exceeds 8000 bytes' using errcode = '23514';
    end if;
  else
    select e.id into v_entry from catalogue_entries e join product_catalogues c on c.id = e.catalogue_id
      where c.sector = new.catalogue_sector and c.version = new.catalogue_version
        and c.status = 'published' and e.code = new.entry_code;
    if v_entry is null then
      raise exception 'citation does not identify a published entry' using errcode = '23514';
    end if;
    new.snapshot := atlas_private.catalogue_entry_snapshot(v_entry);
  end if;
  new.cited_at := now();
  return new;
end;
$$;

-- A saved citation can always read the revision it cites (to say whether it is
-- still current or was withdrawn, and why), but only through a decision the
-- reader may see. One policy still, so the advisor's count does not grow.
drop policy catalogue_product_revisions_read on public.catalogue_product_revisions;
create policy catalogue_product_revisions_read on public.catalogue_product_revisions
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    or (withdrawn_at is null and superseded_at is null)
    or exists (select 1 from public.option_catalogue_sources s
      where s.catalogue_sector = 'product' and s.entry_code = catalogue_product_revisions.code
        and s.catalogue_version = catalogue_product_revisions.revision)
  );
create index option_catalogue_sources_product_idx
  on public.option_catalogue_sources (entry_code, catalogue_version) where catalogue_sector = 'product';

-- A saved citation's standing is worked out from the cited revision's own
-- withdrawn and replaced marks, so browsers may read the replaced mark too.
grant select (superseded_at) on public.catalogue_product_revisions to authenticated;
