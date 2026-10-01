-- Stabilisation sprint S4: two column-only UPDATE grants that never took
-- effect. `grant update (cols)` only *adds* a column privilege; Supabase's
-- default privileges already give `authenticated` UPDATE on every column of
-- every new public table, so without a preceding `revoke update` the column
-- list restricts nothing. Every other column-granted table in this schema
-- (branches, comments, decisions, members, models, notifications,
-- organisations) already has that revoke; these two were missed:
--
--   * invites (20260914030000_invites_last_sent_at.sql) — documented as
--     "this is the only column on this table any client write ever
--     reaches", but an org owner could rewrite email, role, org_id or
--     consumed_at directly.
--   * attribute_definitions (20260914020000_attribute_definitions.sql) —
--     `key` is documented as immutable once created (deltas reference a
--     definition by key), but an owner could rename it, and could rewrite
--     org_id/created_by/created_at.
--
-- The RLS policies are unchanged; this only makes the intended column
-- lists the real ones. Nothing in src/ writes any of the revoked columns.

revoke update on invites from authenticated;
grant update (last_sent_at) on invites to authenticated;

revoke update on attribute_definitions from authenticated;
grant update (label, kind, options, applies_to, required, description, order_index, deprecated_at) on attribute_definitions to authenticated;
