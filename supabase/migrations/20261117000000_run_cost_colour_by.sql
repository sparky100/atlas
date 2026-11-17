-- Run cost colour-by (Turbo EA-inspired item 3).
--
-- Widens `user_preferences.capability_map_colour_by`'s check constraint (last
-- widened by 20261116000000) with one new mode, `'metric:runCost'` — the
-- capability map's "Run cost" colour-by: the costliest annual run cost band
-- among a capability's supporting systems and modules, worked out from the
-- supports links and each element's own `annualRunCost` value
-- (src/ui/capabilityMap/metrics.ts), never stored and never summed (the field
-- is a band, not a figure). Same "drop and recreate the whole check" shape
-- every prior widening used. No table, policy, function or grant changes, so
-- no new advisor finding is possible from this migration.

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare', 'metric:fitForPurpose', 'metric:disposition', 'metric:aiAgentShare', 'metric:runCost'));
