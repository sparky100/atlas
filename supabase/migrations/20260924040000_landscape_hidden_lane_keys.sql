-- Landscape "hide lane" toggle: a fourth, independent lane-display column,
-- alongside the collapse/expand overrides and pin order added by
-- 20260913090000_landscape_lane_display.sql. Collapse hides a lane's own
-- member tiles but always leaves its header line (and any "+N" reference
-- chips from systems elsewhere that secondarily support it) on the canvas —
-- hide goes one step further: the lane is dropped from layout entirely, no
-- header, no reference chips, its space reclaimed by the lanes below it.
-- A single array, not a two-directional override pair like collapse/expand
-- — there is no "empty defaults to X" ambiguity for hide the way there is
-- for collapse, so one "hidden set" is sufficient.
alter table user_preferences
  add column landscape_hidden_lane_keys text[];

comment on column user_preferences.landscape_hidden_lane_keys is 'Lane keys the user explicitly hid — dropped from layout entirely (no header, no reference chips), unlike a collapsed lane which still shows its header line. Null/absent means nothing hidden.';
