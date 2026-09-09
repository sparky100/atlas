-- Sprint U4-1 C1: capability map content gains an explicit order per item
-- (SPEC-data-model.md §3.10, ADR-012) — decoupled from `code` (a stable
-- reference id, used by `attributes.templateRef`/aliases; must not change
-- when an item's position does) and from the content file's own JSON array
-- position (fragile to rely on for anything other than authoring
-- convenience). A sector map's level-1 items use this to put its
-- sector-specific capabilities first and the eight shared back-office ones
-- last (content/capability-maps/README.md, scripts/loadCapabilityMaps.ts);
-- level-2 items use it to keep their existing position within their own
-- parent explicit rather than implicit. `src/ui/capabilityMap/layout.ts`'s
-- `compareCapabilities` reads the seeded copy of this (element
-- `attributes.order`, not this column — see 20260906120000_seed_from_map.sql's
-- own note on the divide between template content and seeded model data).
--
-- Required, not nullable: `src/contracts/capabilityMapContent.ts`'s content
-- schema requires `order` on every item, so nothing ever gets loaded here
-- without one.
alter table capability_map_items add column item_order int not null;

comment on column capability_map_items.item_order is 'Explicit display order among this item''s siblings (same parent_code), independent of `code` and of this table''s own row order (Sprint U4-1 C1). Named item_order, not order — order is a reserved SQL keyword.';
