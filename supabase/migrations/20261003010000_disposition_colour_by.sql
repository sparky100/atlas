-- Disposition colour-by (F11, ADR-001 "Amended (Disposition, TIME)").
--
-- Widens `user_preferences.capability_map_colour_by`'s check constraint
-- (last widened by 20260914050000) with one new mode, `'metric:disposition'`
-- — the capability map's own "Disposition" colour-by: the worst TIME
-- disposition among a capability's supporting systems and modules
-- (src/ui/capabilityMap/metrics.ts). Same "drop and recreate the whole
-- check" shape every prior widening used. `landscape_colour_by` is
-- untouched: the landscape already shows each system's own disposition on
-- its element page, and a worst-of roll-up is capability-level only.

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare', 'metric:fitForPurpose', 'metric:disposition'));
