-- Prompt 7k item 3: IT/OT domain.
--
-- Widens both `user_preferences` colour-by check constraints
-- (20260906310000/20260911080000) with this item's two new modes:
-- `capability_map_colour_by` gains `'metric:otShare'` (the capability
-- map's own "OT share" colour-by, src/ui/capabilityMap/metrics.ts);
-- `landscape_colour_by` gains `'metric:domain'` (the landscape's own
-- IT/OT colour-by, src/ui/landscape/landscapeColour.ts). Same "drop and
-- recreate the whole check" shape 20260911080000 already used — there is
-- no `alter constraint` for a check's own expression.

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare'));

alter table user_preferences
  drop constraint if exists user_preferences_landscape_colour_by_check;

alter table user_preferences
  add constraint user_preferences_landscape_colour_by_check
    check (landscape_colour_by in ('none', 'metric:criticality', 'metric:hostingModel', 'metric:domain'));
