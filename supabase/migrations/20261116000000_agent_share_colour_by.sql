-- Agent share colour-by (AI agents across Atlas, ADR-001 amendment, PR #479).
--
-- Widens `user_preferences.capability_map_colour_by`'s check constraint (last
-- widened by 20261003010000) with one new mode, `'metric:aiAgentShare'` — the
-- capability map's "Agent share" colour-by: how many of a capability's
-- supporting systems are AI agents, worked out from the supports links and
-- each system's own `aiAutonomy` value (src/ui/capabilityMap/metrics.ts),
-- never stored. Same "drop and recreate the whole check" shape every prior
-- widening used. No table, policy, function or grant changes, so no new
-- advisor finding is possible from this migration.

alter table user_preferences
  drop constraint if exists user_preferences_capability_map_colour_by_check;

alter table user_preferences
  add constraint user_preferences_capability_map_colour_by_check
    check (capability_map_colour_by in ('none', 'metric:supportingSystemCount', 'metric:oldestLifecycleStage', 'metric:lifecycleExposure', 'metric:criticality', 'metric:otShare', 'metric:fitForPurpose', 'metric:disposition', 'metric:aiAgentShare'));
