# Platform administrator

Atlas's first cross-org role. Everything else in this product is scoped to
one organisation (owner/architect/contributor/viewer, `member_role` — see
`docs/SPEC-data-model.md` §9 and `docs/ADR-000-foundations.md`'s ADR-009).
A platform administrator is scoped to the whole deployment instead.

## What a platform admin can do today

Exactly one thing: view and change `llm-proxy`'s own application-level
settings (model, per-org rate-limit cap, optionally the Anthropic API key)
at `/platform-admin`, reachable from the account menu once granted. Nothing
else in this product checks platform-admin status yet.

There is deliberately no UI to grant or revoke *other* platform admins —
that's a real, named gap (CLAUDE.md rule 7), not silently implied to exist.
A natural follow-up if it's ever needed: list `platform_admins`, grant/revoke
via a new admin-gated RPC, the same shape as the two `llm-proxy` RPCs below.

## Granting the first (and only, for now) platform admin

No self-serve path exists — granting platform-admin status is a one-off
SQL statement run as the service role (the Supabase SQL editor, or `psql`),
the same convention already established for `platform_config` itself
(`docs/EDGE-FUNCTIONS.md`):

```sql
insert into platform_admins (user_id, granted_by)
values ((select id from auth.users where email = 'you@example.com'), null);
```

To revoke it:

```sql
delete from platform_admins where user_id = (select id from auth.users where email = 'you@example.com');
```

## Why a dedicated table, not a flag on `atlas.profiles`

`atlas.profiles` is the one existing table with no `org_id` — a person's
identity follows them across every org they belong to — so it looked like
a natural home for a global admin flag. It isn't: `profiles_select`'s own
RLS makes a profile visible to *any* fellow org member, so a boolean there
would leak "who's a platform admin" to every org-mate of every admin.
`platform_admins` is a dedicated table instead, matching this schema's own
existing idiom — presence in a table is the fact (the same shape `members`
already uses for org membership) — with a self-row-only select policy, so
the only thing a client can ever learn from it is its own status, never
anyone else's.

## RLS shape

- `platform_admins`: select policy `user_id = auth.uid()` only; no
  insert/update/delete grant to `authenticated` at all.
- `platform_config` itself gets **no** new RLS policy — it stays exactly as
  locked down as `docs/EDGE-FUNCTIONS.md` already describes (no client
  access at all, since a row may hold a live secret). `atlas.get_platform_llm_config`/
  `atlas.set_platform_llm_config` (both `security definer`, both re-derive
  `atlas.is_platform_admin()` themselves) are the only client-reachable
  path into it, alongside the `llm-proxy` edge function's own service-role
  client.
- `atlas.get_platform_llm_config` never returns the raw API key — only
  `has_api_key`. `atlas.set_platform_llm_config` leaves an existing key
  untouched unless a new one is supplied or `p_clear_api_key` is explicitly
  passed, so the UI never needs to display or round-trip a live secret.

See `supabase/migrations/20260917030000_platform_admin.sql`'s own module
comment for the full SQL and reasoning.
