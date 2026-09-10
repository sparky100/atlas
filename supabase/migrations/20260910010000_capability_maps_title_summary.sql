-- Sprint U4-2a item 4: "title and summary fields in content (all eight
-- maps)". `capability_maps.source_description` (20260906110000) is
-- provenance — how the map was drafted, what was consulted, who reviewed
-- it — a paragraph long enough that showing it inline on every picker
-- card (CapabilityMapImportPanel.tsx, before this sprint) crowded out the
-- one thing a person picking a starter map actually needs first: what is
-- this map, in a few words, and what does it cover.
--
-- Nullable, not `not null`: unlike `source_description` (part of this
-- table's very first migration, before any row existed), this column is
-- added to a table `scripts/loadCapabilityMaps.ts` may already have
-- populated on a long-running project (the live "Architecture" project
-- among them) — a `not null` addition with no default would fail against
-- real existing rows. `src/contracts/capabilityMapContent.ts`'s Zod
-- schema is what actually requires every *new* content file to carry
-- both fields; a row loaded before this migration simply reads back
-- `null` here until `pnpm content:load-capability-maps` is next run
-- against it, which the UI (CapabilityMapImportPanel.tsx) falls back
-- from gracefully rather than assuming never happens.
alter table capability_maps add column title text;
alter table capability_maps add column summary text;

comment on column capability_maps.title is 'Short display name for the starter-map picker (Sprint U4-2a item 4) — e.g. "NHS Acute Trust", not the bare sector/version. Null until scripts/loadCapabilityMaps.ts has (re)loaded this row from content carrying it.';
comment on column capability_maps.summary is 'One or two plain-English sentences: what this map covers, for the picker card. Null until scripts/loadCapabilityMaps.ts has (re)loaded this row from content carrying it. Provenance (how it was drafted, who reviewed it) stays in source_description, shown behind an info affordance, not on the card face.';
