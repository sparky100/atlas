-- Capability-map sectors move out of the database CHECK and into the
-- contract (src/contracts/capabilityMapContent.ts's SECTORS) — the same
-- taxonomy-in-code choice ADR-001 makes for element and relationship
-- types. The old constraint hard-coded five sectors
-- ('local_government', 'nhs', 'housing', 'hei', 'generic'); the starter
-- content now needs eight (Scottish and English local government are
-- different maps, not two versions of one; a regulated utility and an
-- electricity network operator have no home at all in the old five), and
-- a list that has to be repeated in two places — one of them a migration
-- — is exactly the drift this repo's constitution warns about.
--
-- `sector` stays `text not null`; `unique (sector, version)` stays, since
-- that is the map's actual identity (scripts/loadCapabilityMaps.ts upserts
-- by it). Only the enumeration moves: parseCapabilityMapContent is now the
-- single place a sector value is validated, and the loader is the only
-- writer of this table (no `authenticated` write grant — see
-- 20260906110000_capability_map_templates.sql), so nothing can reach the
-- column without going through that parser.
--
-- No data change: every existing row's sector is still a value the
-- contract accepts — `local_government` parses (via the deprecated-alias
-- map in the contract) as `local_government_scotland`, and the previous
-- 'generic' sector, renamed `public_body`, has never been loaded here from
-- content (content/capability-maps/ shipped empty until this sprint).

alter table capability_maps drop constraint capability_maps_sector_check;

comment on column capability_maps.sector is 'Sector this starter map is for. Validated by src/contracts/capabilityMapContent.ts (SECTORS), not by a CHECK — taxonomy in code, per ADR-001.';
