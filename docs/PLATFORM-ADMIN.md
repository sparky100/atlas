# Platform administrator

Atlas's first cross-org role. Everything else in this product is scoped to
one organisation (owner/architect/contributor/viewer, `member_role` — see
`docs/SPEC-data-model.md` §9 and `docs/ADR-000-foundations.md`'s ADR-009).
A platform administrator is scoped to the whole deployment instead.

## What a platform admin can do today

Four things, all at `/platform-admin`, reachable from the account menu once granted. Nothing else in this product checks platform-admin status.

1. **See every organisation and person** (read-only). The Organisations list shows created date, people, elements on main, changes and active people in the last 30 days, last sign-in and last change. The People list shows email, each organisation with role and join date, sign-up date, last sign-in and last change, with a search by email. Anything with no sign-in or change in 30 days gets a "Not used in 30+ days" marker. Counts and dates only; no element names or other model content. "Last signed in" comes from `auth.users.last_sign_in_at`; "last change" is the newest commit the person (or organisation) made, so a read-only user shows "Never" for changes. Both come from `atlas.platform_admin_organisations()` / `atlas.platform_admin_people()` (`20261114080000_platform_admin_overview.sql`), which raise unless `atlas.is_platform_admin()` is exactly true (written `is not true`, so a NULL cannot pass), never consult org roles, and so refuse an organisation Owner.
2. **View and change `llm-proxy`'s own application-level
settings** (provider, model, per-org rate-limit cap, optionally the API key).
3. **Edit the platform capability sets and the product catalogue**.
   Capability sets use a guarded draft workspace and publish one fixed
   `capability_maps` version (`docs/ADR-037-platform-capability-set-editor.md`).
   The product catalogue has one row per real product, with capability links
   into any number of capability-set versions. Sector catalogues are fixed
   publication snapshots that select products and pin one published set
   (`docs/ADR-038-product-catalogue-admin.md`). Both editors are
   platform-admin-only; ordinary organisation owners cannot reach them.
4. **Withdraw or reinstate a published sample model**. A sample is withdrawn
   by its slug, which hides every version from ordinary users without editing
   or deleting the published rows. The reason, actor and time are recorded;
   existing organisation copies are untouched. See
   `docs/ADR-033-sample-models.md`.

Provider is a real picker, not a label — `LLM_PROXY_PROVIDER_OPTIONS`
(`src/ui/admin/useLlmProxyConfig.ts`) holds one entry today ("Anthropic"),
matching what `llm-proxy` actually routes to, but it's the same
data-driven shape as the Model picker beside it. This is deliberate: the
config schema and this form shouldn't need to change the day a second
provider's routing is actually built — only the option list and
`llm-proxy`'s own routing would. See `docs/ADR-000-foundations.md`'s
ADR-014 amendment.

There is deliberately no UI to grant or revoke *other* platform admins —
that's a real, named gap (CLAUDE.md rule 7), not silently implied to exist.
A natural follow-up if it's ever needed: list `platform_admins`, grant/revoke
via a new admin-gated RPC, the same shape as the two `llm-proxy` RPCs below.

## Viewing a capability set before copying

In **Platform admin → Capability sets**, choose a sector and select **View current set** before creating the next draft. The read-only view shows the published version, summary, searchable capability hierarchy and definitions, value-stream stages and their capability links, sources and origin. **Versions for [sector]** also lets you inspect older versions. An older version cannot be copied as a new draft; **Create draft from current** always uses the current published version. Viewing a set changes neither published content nor models previously seeded from it. On a narrow screen, the capability list and selected definition stack as cards.

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
- The key is stored in Supabase Vault (secret `platform:llm_api_key`), never
  in `platform_config`, from `20261114090000_security_hardening.sql`.
  `llm-proxy` reads it through `atlas.platform_llm_api_key()`, which only the
  service role can call.
- `atlas.set_platform_llm_config` also rejects any `p_provider` other than
  `'anthropic'` — the config shape has room for a second provider, but
  nothing routes to one yet, and storing an id `llm-proxy` would silently
  ignore is worse than refusing it outright.

See `supabase/migrations/20260917030000_platform_admin.sql` and
`20260921020000_platform_llm_provider.sql`'s own module comments for the
full SQL and reasoning.
