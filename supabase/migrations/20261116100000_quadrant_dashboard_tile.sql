-- Quadrant dashboard tile (Portfolio fit-against-technical-health quadrant).
--
-- Widens `dashboard_tiles.kind`'s check constraint (created in
-- 20261106010000_saved_reports.sql) with one new tile kind, `'quadrant'`: the
-- Portfolio quadrant (business fit against technical health, boxes named
-- Invest, Migrate, Tolerate and Eliminate) drawn from a Portfolio report's
-- own rows at the time the dashboard is opened, never stored. Same "drop and
-- recreate the whole check" shape the earlier widenings used. No table,
-- policy, function or grant changes (the tile's update grant already covers
-- `kind`), so no new advisor finding is possible from this migration.

alter table dashboard_tiles
  drop constraint if exists dashboard_tiles_kind_check;

alter table dashboard_tiles
  add constraint dashboard_tiles_kind_check
    check (kind in ('kpi', 'bar', 'stackedBar', 'donut', 'table', 'quadrant'));
