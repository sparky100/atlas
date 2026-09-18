-- F2-lite: spreadsheet import as reconciliation. A change page needs to show
-- "not in file" (elements in the model the file's rows never touched) at any
-- later time — a different reviewer, a different day, after a reload — not
-- just in the import dialog while the file is still in memory. That needs
-- something durable to diff the model against: the set of element ids the
-- import's own rows actually resolved to (matched or newly created).
--
-- One nullable column on the spreadsheet's own `sources` row (one row per
-- import run, `createSpreadsheetSource` — src/db/sources.ts) rather than a
-- new table: this is exactly the same "one row per run, everything that run
-- touched attaches to it" shape `capture_job_id`/`capability_map_id` already
-- use on this table, just for a `spreadsheet` row instead of a service-role
-- one. Required (not optional) for `kind = 'spreadsheet'`, mirroring the
-- table's existing `check ((kind = 'x') = (col is not null))` pattern for
-- `capture_job`/`template`/`manual`.
alter table sources add column import_touched_element_ids uuid[];

-- Backfill before the constraint lands: any `spreadsheet` source from before
-- this migration (F2 Phase 1/2) has no such record — an empty array is a
-- safe, honest under-approximation (nothing known-touched), not a fabricated
-- one, and lets the constraint below hold for old rows too.
update sources set import_touched_element_ids = '{}' where kind = 'spreadsheet' and import_touched_element_ids is null;

alter table sources add constraint sources_import_touched_element_ids_check
  check ((kind = 'spreadsheet') = (import_touched_element_ids is not null));

comment on column sources.import_touched_element_ids is 'F2-lite: every element id this spreadsheet import''s rows matched or created — lets a change page recompute "not in file" (this model''s systems/platforms/modules minus this set) at any later time, not just while the file is still in memory.';
