-- Prompt 7k item 1: criticality and hosting.
--
-- Two changes, both to `user_preferences`:
--
-- 1. The capability map's colour-by mode (added Sprint U4-1 C4, migration
--    20260906310000) gains a new allowed value, `'metric:criticality'` —
--    the capability-level worst-of aggregate over a capability's
--    supporting systems' `criticality` attribute
--    (src/ui/capabilityMap/metrics.ts). The column's inline check
--    constraint has to be dropped and recreated with the wider set; there
--    is no `alter constraint` for a check's own expression.
--
-- 2. A new sibling column, `landscape_colour_by`, for the landscape's own
--    colour-by mode — a separate column, not a second value crammed into
--    the capability-map one, because the two canvases can show different
--    modes at once (src/contracts/userPreferences.ts's own module comment
--    explains why). Same nullable-no-default shape as
--    `capability_map_colour_by`: null means no explicit choice has ever
--    been saved.

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality'));

alter table user_preferences
  add column landscape_colour_by text
    check (landscape_colour_by in ('none', 'metric:criticality', 'metric:hostingModel'));

comment on column user_preferences.landscape_colour_by is 'Prompt 7k item 1: the landscape''s last-chosen colour-by mode. Null means no override saved yet — unlike the capability map, the landscape has no model-aware default to fall back to (src/ui/landscape/landscapeColour.ts), so null and ''none'' currently render the same way.';
