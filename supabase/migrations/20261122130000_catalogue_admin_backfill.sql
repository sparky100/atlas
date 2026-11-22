-- Follow-up to 20261122120000_catalogue_admin.sql.
--
-- That migration was applied to the live project before its backfill could
-- copy capability links and claims from published entries: published entries
-- keep product_id null because the catalogue child-immutability trigger
-- refuses updates to them. The first version of the backfill filtered on
-- e.product_id, so it saw no published entries and left the product library
-- with no links or claims.
--
-- This migration resolves the canonical product by its normalised vendor and
-- product name, so it works for published entries whose product_id is null.
-- It is idempotent: links use ON CONFLICT DO NOTHING, and claims are inserted
-- only for a product that has none. On a fresh database, the corrected first
-- migration already fills both, so this is a no-op.

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
  where not exists (select 1 from public.catalogue_product_claims existing where existing.product_id = p.id)
  order by p.id, q.kind, q.statement, q.source_url, q.source_date, q.reviewed_at desc, q.id
), numbered as (
  select candidates.*,
    row_number() over (partition by product_id order by source_date, source_url, kind, statement) as position
  from candidates
)
insert into public.catalogue_product_claims
  (product_id, position, kind, statement, source_url, source_date, reviewed_by, reviewed_at)
select product_id, position, kind, statement, source_url, source_date, reviewed_by, reviewed_at
from numbered
on conflict (product_id, position) do nothing;
