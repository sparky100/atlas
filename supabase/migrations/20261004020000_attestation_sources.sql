-- ADR-025 (F12 step 3): let a member who can edit create an `attestation`
-- source — one per confirmation, like `merge_resolution` (no user_id: the
-- check `(kind = 'manual') = (user_id is not null)` keeps every non-manual
-- kind user-less, and the confirming person is already the commit's
-- author). Same body as 20260906162100's policy plus the new kind.

drop policy sources_insert on sources;

create policy sources_insert on sources
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and kind in ('document', 'spreadsheet', 'interview', 'manual', 'merge_resolution', 'attestation')
    and created_by = auth.uid()
    and (kind <> 'manual' or user_id = auth.uid())
    and (kind <> 'merge_resolution' or user_id is null)
    and (kind <> 'attestation' or user_id is null)
  );
