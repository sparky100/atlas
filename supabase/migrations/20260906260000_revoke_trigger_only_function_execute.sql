-- Security hardening, found by the hosted project's advisor right after
-- Sprint M1a's migrations landed: atlas.ensure_profile() and
-- atlas.process_comment_mentions() are trigger-only functions (`after
-- insert on members` / `after insert on comments`, never meant to be
-- invoked directly) but were left on Postgres's default PUBLIC execute
-- grant, same gap 20260906165000_expose_atlas_schema.sql already closed
-- for atlas.is_member/has_role/member_role/branch_visible_to_viewer —
-- exposing the `atlas` schema to PostgREST makes every function in it a
-- potential RPC endpoint unless explicitly revoked.
--
-- That earlier migration's own module comment predicted trigger functions
-- were safe by construction ("returns trigger — PostgREST does not expose
-- trigger functions as API endpoints regardless of their execute grants,
-- so those needed no change"). The advisor disagrees in practice: both
-- functions below showed up flagged as callable via
-- /rest/v1/rpc/ensure_profile and /rest/v1/rpc/process_comment_mentions
-- for both `anon` and `authenticated`. Whether or not a call would
-- actually do anything useful from that path (both re-derive everything
-- they need from `new`/trigger context that a direct RPC call wouldn't
-- supply), leaving the grant in place is needless surface — belt and
-- suspenders, matching this schema's existing revoke-then-grant-narrowly
-- discipline everywhere else.

revoke all on function atlas.ensure_profile() from public, anon, authenticated;
revoke all on function atlas.process_comment_mentions() from public, anon, authenticated;
