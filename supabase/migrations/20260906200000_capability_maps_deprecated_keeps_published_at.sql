-- capability_maps_check ((status = 'published') = (published_at is not
-- null)) never anticipated a map moving published -> deprecated, because
-- nothing did: scripts/publishCapabilityMap.ts is the first code path
-- that ever writes 'deprecated', when a sector's new version supersedes
-- an older published one. Deprecating a map should not erase when it was
-- actually published — that's real provenance ("this was the sector's
-- current map from X until superseded by v2 on Y"), the same reasoning
-- this repo applies everywhere else (ADR-007) — but the original CHECK
-- forced published_at back to null the moment status left 'published',
-- since deprecating without also nulling it violated the constraint
-- outright.
--
-- Corrected shape: published_at is null exactly while a map is still
-- draft, and set (and never cleared) from the moment it's first
-- published, through deprecation. A map only ever moves draft ->
-- published -> deprecated (never backward — nothing in this schema
-- re-drafts a published map), so "null iff draft" and the original
-- "null iff not published" agree everywhere except the one transition
-- this migration exists to fix.

alter table capability_maps drop constraint capability_maps_check;
alter table capability_maps add constraint capability_maps_check check ((status = 'draft') = (published_at is null));
