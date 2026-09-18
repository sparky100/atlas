-- Import close-out: "aliases from same-as picks are written on merge, not at
-- import; cancel/reject leaves no alias." A confirmed same-as pick can no
-- longer write its alias immediately at commit time (F2-lite's own original
-- choice) — it has to wait until the change actually merges, and never
-- happen at all if the change is cancelled or rejected.
--
-- One nullable-turned-default jsonb column on the spreadsheet's own
-- `sources` row (the same "one row per run, everything that run produced
-- attaches to it" shape `import_touched_element_ids` already uses) rather
-- than a new table: an array of `{elementId, aliasValue}` pairs, applied
-- (real `aliases` rows written, this array cleared) by `mergeApprovedRequest`
-- once a merge actually lands — never touched by a cancel or reject, which
-- simply never reaches that code path, so the pending list just sits here,
-- unapplied, forever.
alter table sources add column pending_aliases jsonb not null default '[]'::jsonb;

comment on column sources.pending_aliases is 'F2-lite import close-out: confirmed same-as picks awaiting this change''s own merge — [{"elementId": uuid, "aliasValue": text}, ...]. Applied as real aliases rows, then cleared, by mergeApprovedRequest once the branch carrying this source''s deltas actually merges; never applied on cancel/reject.';
