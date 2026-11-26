-- Catalogue step 4b-1 (proposals/WALKTHROUGH-catalogue-step-4b-reader-switch.md):
-- signed-in users can read PUBLISHED product revisions, so that a later step
-- can show products on capability pages. Nothing in the app reads them yet.
--
-- Who can see what changes here, in plain terms:
--   * Any signed-in user can read the newest, not-withdrawn revision of a
--     product, with its claims and links. Withdrawn revisions, and revisions
--     that a newer one has replaced, stay admin-only (saved citations to them
--     are read through their own snapshot, in a later step).
--   * Any signed-in user can read which general capability a published map
--     item is aligned to (three columns only). The reviewer and the written
--     basis of the alignment stay admin-only. Published maps are already
--     readable by every signed-in user.
-- One policy per table and action (not an extra one) so the advisor's
-- multiple-permissive-policies count does not grow.

-- A revision is "replaced" once a newer one exists. That is recorded on the
-- older row, once, so the read policy needs no look-up of its own table (a
-- policy that reads its own table recurses).
alter table public.catalogue_product_revisions add column superseded_at timestamptz;

create or replace function atlas.guard_catalogue_product_revision()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a published product revision cannot be deleted' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_by_name' - 'withdrawn_reason' - 'superseded_at')
     is distinct from (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_by_name' - 'withdrawn_reason' - 'superseded_at')
    or (old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at)
    or (old.withdrawn_at is not null and new.withdrawn_reason is distinct from old.withdrawn_reason)
    or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'a published product revision is immutable; withdrawal and replacement are one-time' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function atlas.supersede_catalogue_product_revisions()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  update public.catalogue_product_revisions
  set superseded_at = now()
  where product_id = new.product_id and revision < new.revision and superseded_at is null;
  return null;
end;
$$;
revoke all on function atlas.supersede_catalogue_product_revisions() from public, anon, authenticated;
create trigger catalogue_product_revisions_supersede
  after insert on public.catalogue_product_revisions
  for each row execute function atlas.supersede_catalogue_product_revisions();

-- Revisions published before this migration: all but each product's newest are replaced.
alter table public.catalogue_product_revisions disable trigger catalogue_product_revisions_immutable;
update public.catalogue_product_revisions r set superseded_at = now()
where exists (select 1 from public.catalogue_product_revisions n where n.product_id = r.product_id and n.revision > r.revision);
alter table public.catalogue_product_revisions enable trigger catalogue_product_revisions_immutable;

drop policy catalogue_product_revisions_admin_read on public.catalogue_product_revisions;
create policy catalogue_product_revisions_read on public.catalogue_product_revisions
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    or (withdrawn_at is null and superseded_at is null)
  );

-- A claim or link is visible exactly when its revision is visible.
drop policy catalogue_product_revision_claims_admin_read on public.catalogue_product_revision_claims;
create policy catalogue_product_revision_claims_read on public.catalogue_product_revision_claims
  for select to authenticated using (
    exists (select 1 from public.catalogue_product_revisions r where r.id = catalogue_product_revision_claims.revision_id));
drop policy catalogue_product_revision_links_admin_read on public.catalogue_product_revision_links;
create policy catalogue_product_revision_links_read on public.catalogue_product_revision_links
  for select to authenticated using (
    exists (select 1 from public.catalogue_product_revisions r where r.id = catalogue_product_revision_links.revision_id));

drop policy reference_map_item_links_admin_read on public.reference_map_item_links;
create policy reference_map_item_links_read on public.reference_map_item_links
  for select to authenticated using (
    exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    or exists (
      select 1 from public.capability_map_items i join public.capability_maps m on m.id = i.map_id
      where i.id = reference_map_item_links.map_item_id and m.status = 'published')
  );
-- Browsers read only the alignment itself, never who made it or why.
revoke select on public.reference_map_item_links from authenticated;
grant select (map_item_id, capability_id, capability_revision) on public.reference_map_item_links to authenticated;

-- The product-revision claims and links carry a user id for who published or
-- reviewed; the name is shown, the id need not leave the server.
revoke select on public.catalogue_product_revisions from authenticated;
grant select (id, product_id, revision, product_edit_revision, code, product, vendor, summary,
              published_by_name, published_at, withdrawn_at, withdrawn_by_name, withdrawn_reason)
  on public.catalogue_product_revisions to authenticated;
revoke select on public.catalogue_product_revision_claims from authenticated;
grant select (revision_id, position, kind, statement, source_url, source_date, origin, drafted_by_name,
              drafted_at, reviewed_by, reviewed_at)
  on public.catalogue_product_revision_claims to authenticated;
