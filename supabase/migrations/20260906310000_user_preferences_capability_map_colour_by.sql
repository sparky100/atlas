-- Sprint U4-1 C4: "remember last choice per user" for the capability
-- map's colour-by mode.
--
-- Unlike home_mode/density/theme (each `not null default 'X'`), this
-- column is nullable with no default: null means "no explicit choice
-- ever saved", and the application computes the right default from
-- context this table alone doesn't have (director vs architect home
-- mode, whether the model has any systems at all) — a fixed column
-- default can't express that, and shouldn't try to.

alter table user_preferences
  add column capability_map_colour_by text
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure'));

comment on column user_preferences.capability_map_colour_by is 'Sprint U4-1 C4: the capability map''s last-chosen colour-by mode. Null means no override saved yet — the app defaults it from home_mode and whether the model has systems (src/ui/capabilityMap/metrics.ts''s resolveDefaultColourBy), not from a fixed value here.';
