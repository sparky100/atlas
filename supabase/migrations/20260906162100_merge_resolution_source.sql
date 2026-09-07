-- Sprint C1 step 7: resolving a merge field-conflict (SPEC §7.4) writes a
-- resolution delta whose sourceId is "a merge_resolution source". The enum
-- value and the `deltas.source_id`/`aliases`-style FK already anticipated
-- this kind (20260906071100_enums.sql's `source_kind`, and `sources`'s own
-- `check ((kind = 'manual') = (user_id is not null))` already treats every
-- non-manual kind as user_id-less) — but `sources_insert`'s kind allowlist
-- (20260906071500_sources_and_aliases.sql) never included it, since nothing
-- wrote one until the review queue existed to need it. `create policy`
-- has no `or replace`, so this drops and recreates the same policy under
-- its original name with one more kind allowed; nothing else about it
-- changes.

drop policy sources_insert on sources;

create policy sources_insert on sources
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and kind in ('document', 'spreadsheet', 'interview', 'manual', 'merge_resolution')
    and created_by = auth.uid()
    and (kind <> 'manual' or user_id = auth.uid())
    and (kind <> 'merge_resolution' or user_id is null)
  );
