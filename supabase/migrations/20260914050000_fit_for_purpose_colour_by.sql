-- Fit-for-purpose colour-by.
--
-- Widens `user_preferences.capability_map_colour_by`'s check constraint
-- (20260906310000, then 20260911080000/20260911090000) with one new mode,
-- `'metric:fitForPurpose'` — the capability map's own "Fit" colour-by
-- (src/ui/capabilityMap/metrics.ts, `FitForPurpose` on the `supports`
-- relationship edge). Same "drop and recreate the whole check" shape the
-- two prior widenings used — there is no `alter constraint` for a check's
-- own expression. `landscape_colour_by` is untouched: fit-for-purpose is a
-- capability-level worst-of over `supports` edges, and the landscape's own
-- tiles are systems, not capabilities (same reasoning criticality's
-- capability-map-only placement already gives — see metrics.ts's module
-- comment).

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare', 'metric:fitForPurpose'));
