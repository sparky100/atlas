-- V2 "landscape focus and filters": per-lane collapse overrides and pin
-- order, both remembered per user (docs/UI-principles.md §10 decision 12).
--
-- Collapse is a two-directional override, not a single "collapsed set": a
-- lane with no members defaults to collapsed, a lane with any members
-- defaults to expanded (src/ui/landscape/layout.ts's own isLaneCollapsed) —
-- a user can override either default in either direction, and whichever
-- direction they last chose wins and persists regardless of whether it
-- still matches or now fights that lane's own default. Two arrays (not one
-- signed set, not a jsonb map) keep each column a plain typed list, in
-- this table's existing one-column-per-preference style
-- (capability_map_colour_by, landscape_colour_by). "Force collapsed" and
-- "force expanded" are never written for the same key by the app, but
-- nothing at the DB level stops it — isLaneCollapsed resolves collapsed-
-- wins if a key somehow ends up in both, the safer default for stale
-- state (less screen space, not more).
--
-- Pin order is a third, independent column: array order is display order
-- among pinned lanes; every unpinned lane keeps layout.ts's own existing
-- laneSortKey order, appended after every pinned one.
alter table user_preferences
  add column landscape_collapsed_lane_keys text[],
  add column landscape_expanded_lane_keys text[],
  add column landscape_pinned_lane_keys text[];

comment on column user_preferences.landscape_collapsed_lane_keys is 'V2: lane keys the user explicitly collapsed, regardless of that lane''s own emptiness-based default. Null/absent means no explicit collapse overrides saved.';
comment on column user_preferences.landscape_expanded_lane_keys is 'V2: lane keys the user explicitly expanded, regardless of that lane''s own emptiness-based default. Null/absent means no explicit expand overrides saved.';
comment on column user_preferences.landscape_pinned_lane_keys is 'V2: pinned lane keys, in the user''s own chosen display order (array order = display order among pinned lanes). Null/absent means nothing pinned — every lane keeps layout.ts''s own existing laneSortKey order.';
