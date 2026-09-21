-- Fix (item-7 re-triage, Group 5/D3): atlas.trigram_similarity was only
-- granted EXECUTE to `authenticated` — but its only caller,
-- src/capture/trigram.integration.test.ts, calls it via the service-role
-- client (this function exists purely for a database-vs-TypeScript parity
-- check, never for app/RLS-scoped calls). `service_role` bypasses RLS but
-- does not get an implicit EXECUTE grant on a function scoped to
-- `authenticated` — same shape write_capture_draft's own grant already
-- gets right (20260921005000_write_capture_draft_confirm_default.sql).

grant execute on function atlas.trigram_similarity(text, text) to service_role;
