-- V2b: the shared Inspector panel's own collapsed/expanded state, remembered
-- per user (the prompt's own "state remembered per user") — one boolean,
-- not per-view, matching this table's own "follows a person, not a
-- membership" scope (contracts/userPreferences.ts's own module comment).
-- Same simple `alter table ... add column ... not null default` shape as
-- notify_on_review_assigned (20260916010000_notify_on_review_assigned.sql)
-- — no RPC to redefine, just a preference column.

alter table user_preferences add column inspector_collapsed boolean not null default false;

comment on column user_preferences.inspector_collapsed is 'V2b: whether the shared Inspector panel (src/ui/components/Inspector) is collapsed to its icon strip by default, for this user. Overridden live whenever something is focused/selected on a view the Inspector appears in (the panel opens on focus regardless of this saved value) — this column only governs the resting state with nothing selected. Defaults to false (open) so a first-time user sees it expanded.';
