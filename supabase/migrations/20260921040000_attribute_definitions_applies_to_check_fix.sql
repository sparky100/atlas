-- Fix (item-7 re-triage, Group 3): attribute_definitions.applies_to's own
-- CHECK used `array_length(applies_to, 1) > 0` to require a non-empty
-- array — but in Postgres, `array_length('{}'::text[], 1)` returns `NULL`,
-- not `0`, for an empty array. `NULL > 0` evaluates to `NULL`, and a CHECK
-- constraint only fails on an explicit `false`; `NULL` is treated as
-- satisfied. An insert with `applies_to: []` was passing the constraint
-- instead of being rejected.
--
-- `cardinality(applies_to) > 0` returns `0`, not `NULL`, for an empty
-- array, so this correctly evaluates to `false` and the constraint fails
-- as intended.

alter table attribute_definitions drop constraint attribute_definitions_applies_to_check;

alter table attribute_definitions add constraint attribute_definitions_applies_to_check check (
  cardinality(applies_to) > 0
  and applies_to <@ array['capability', 'system', 'container', 'actor']::text[]
);
