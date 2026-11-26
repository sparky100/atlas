# Platform administrator

Atlas's first cross-org role. Everything else in this product is scoped to
one organisation (owner/architect/contributor/viewer, `member_role` — see
`docs/SPEC-data-model.md` §9 and `docs/ADR-000-foundations.md`'s ADR-009).
A platform administrator is scoped to the whole deployment instead.

## What a platform admin can do today

These are reached from `/platform-admin`, each on its own route (the section
opens with a nav and every area has a URL that survives refresh). Nothing
else in this product checks platform-admin status.

1. **See every organisation and person** (read-only) at `/platform-admin`.
   The Organisations list shows created date, people, elements on main,
   changes and active people in the last 30 days, last sign-in and last
   change. The People list shows email, each organisation with role and join
   date, sign-up date, last sign-in and last change, with a search by email.
   Anything with no sign-in or change in 30 days gets a "Not used in 30+ days"
   marker. Counts and dates only; no element names or other model content.
   "Last signed in" comes from `auth.users.last_sign_in_at`; "last change" is
   the newest commit the person (or organisation) made, so a read-only user
   shows "Never" for changes. Both come from
   `atlas.platform_admin_organisations()` / `atlas.platform_admin_people()`
   (`20261114080000_platform_admin_overview.sql`), which raise unless
   `atlas.is_platform_admin()` is exactly true (written `is not true`, so a
   NULL cannot pass), never consult org roles, and so refuse an organisation
   Owner.
2. **View and change `llm-proxy`'s own application-level settings** at
   `/platform-admin/llm-proxy` (provider, model, per-org rate-limit cap,
   optionally the API key).
3. **Edit the platform capability sets and the product catalogue**:
   `/platform-admin/capability-sets` lists sectors and versions, a version has
   its own read-only page, and a draft has its own editor;
   `/platform-admin/catalogue` lists the product library, and
   `/platform-admin/catalogue/sectors` lists the sector catalogues and their
   drafts. Capability sets use a guarded draft workspace and publish one fixed
   `capability_maps` version (`docs/ADR-037-platform-capability-set-editor.md`).
   The product catalogue has one row per real product. A product links once to a
   shared capability (the general capabilities, the same in every sector) or to
   a sector capability, and a sector link carries over to that sector's newer
   capability sets by its code. The product files under `content/catalogue` were loaded into the library once (as claims waiting for review) and are history now: the loader scripts refuse to write to the live project. Sector catalogues are fixed
   publication snapshots that select products and pin one published set
   (`docs/ADR-038-product-catalogue-admin.md`). Both editors are
   platform-admin-only; ordinary organisation owners cannot reach them.
   `/platform-admin/catalogue/review` ("Waiting for review") lists every
   product claim that is drafted and not yet reviewed. A claim is drafted
   first (typed by a person, loaded from a file, or later found by the
   Researcher) and reviewed second. Anyone with platform admin rights can
   review, including the person who drafted the claim. The server records who
   drafted and who reviewed each claim, with dates, and who published a
   catalogue version, and a product cannot be published while any of its claims
   is waiting for review.
   The same screen has a **Source links** section: **Check source links**
   requests each distinct claim source link once (public https pages only, no
   AI) and saves the result, with the date and your name, as **Works**,
   **Moved**, **Gone** or **Could not check**. Links that are not working are
   listed with the product and claim that cite them, and the product editor says
   what was found for each claim's link. A check only records what was found: it
   never edits a claim or unpublishes a product. It needs the
   `catalogue-link-check` function deployed (`pnpm functions:deploy:catalogue-link-check`);
   until then the screen says the checker is not available.
4. **Withdraw or reinstate a published sample model** at
   `/platform-admin/sample-models`, with each sample's own page at
   `/platform-admin/sample-models/:slug`. A sample is withdrawn
   by its slug, which hides every version from ordinary users without editing
   or deleting the published rows. The reason, actor and time are recorded;
   existing organisation copies are untouched. See
   `docs/ADR-033-sample-models.md`.

Reviewer metadata is audit data. A catalogue claim's drafter and reviewer, and
a capability-set source's reviewer, are recorded by the server from the signed-in
platform admin; a browser cannot supply a name. The names are shown to platform
admins in the product editor and the review queue only, and never in any
catalogue reader view, an exported document or a decision pack.

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

## Publishing one product

On a product's page, **Publication** shows whether it is not published,
published (revision, who approved, when) or published with unpublished
changes. **Publish product** is offered when every claim is reviewed, the
product has 1 to 8 claims and at least one capability link. Publishing freezes a
revision; editing afterwards never changes it. **Withdraw from users** needs a
written reason and keeps the revision readable. The products list shows each
product's state and can show only those ready to publish. Until the reader
switch (step 4b) published products are not yet shown to users.

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
