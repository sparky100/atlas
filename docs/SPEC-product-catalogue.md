# Reviewed product catalogue: storage and provenance

Status: storage, reader and platform-admin editor implemented; not yet released. The end-user Designer integration is unchanged.

A catalogue is versioned product content, separate from an organisation's estate. A saved citation records what the catalogue said when a person added an option. It does not approve procurement or change the live model. The reader contract is `src/contracts/productCatalogue.ts`; the foundations migration is `20261120050000_product_catalogue.sql`, and the platform editor is `20261122120000_catalogue_admin.sql`.

## Tables and access

| Table | Purpose | Signed-in access |
|---|---|---|
| `product_catalogues` | Sector/version, pinned starter-map version, publication and withdrawal | Read published versions only |
| `catalogue_entries` | Product, vendor and short description | Read entries of published versions only |
| `catalogue_entry_capabilities` | Exact capability code/name and how the product supports it | Read links of published versions only |
| `catalogue_claims` | Dated, sourced claims with a named editorial reviewer | Read claims of published versions only |
| `option_catalogue_sources` | Database-built evidence snapshot attached to a decision's option branch | Decision-organisation members read; contributor and above insert while proposed |

All five tables enable and force RLS. Anonymous access is revoked. Only the service role can write the four product-content tables. Each foreign key is covered by the leading column of a primary/unique index. No existing table, history, importer or policy changes.

Catalogue content contains no organisation data or prices. The portable no-price expression is shared verbatim by contract and SQL checks; tests exercise both regex engines. It applies to all model-visible text, identifiers and reviewer names as well as statements and URLs. Source URLs must use HTTPS, without credentials, ports or spaces. Content validation also refuses IP/localhost sources. A later editorial loader will validate reviewers against the maintained reviewer list; this migration does not invent a human review.

## Publication and withdrawal

Insert a draft, then publish by updating its status and publication timestamp. Direct insertion of a published row is refused. Publication requires:

- A published starter map for the pinned sector/version.
- A version higher than every other existing version in the sector.
- At least one entry, each with 1–8 claims and 1–10 capability links.
- Exact capability code and name matches in the pinned map.
- Every entry's actual database-built JSON snapshot at most 8,000 bytes. Counts alone cannot guarantee this limit.

A sector advisory lock serialises catalogue creation and publication checks. Child writes hold a share lock on the catalogue; publication holds its update lock. A write cannot cross the publication boundary. Children cannot be reparented. Draft deletion cascades; published content cannot be changed or deleted. Catalogue identity is fixed even in draft.

Withdrawal sets a timestamp and non-empty reason once. It changes no content. Replaced and withdrawn versions remain readable by citation; current-version selection is the highest published, non-withdrawn version. The later reader must show standing explicitly and must not present withdrawn content as current. Published version selection and UI are not part of this foundation PR.

## Saving an option with evidence

The application creates the explore branch first using its stable suggested-option ID. `public.add_option_with_catalogue_sources` then saves the decision link, Designer mark, optional human edit attribution and all catalogue citations in one transaction. A failure leaves no visible option, mark or sources; the existing unlinked branch can be reused on retry. Existing manual and Designer saving flows are unchanged until the integration step.

The public function is **security invoker**. All writes pass the caller's existing RLS. It checks that the branch is a draft explore branch in the decision's model and organisation. Caller identity is derived from `auth.uid()`. A viewer, another organisation's member, or a signed-out caller cannot save.

One narrow internal helper, `atlas_private.lock_catalogue_option_decision`, takes the decision row lock after an explicit contributor-or-above organisation check. It is security definer because the existing decision UPDATE policy deliberately prevents contributors editing another person's decision; PostgreSQL row locks also require that policy. This helper returns no data and changes no row. It lives in the unexposed schema, with public/anon execute revoked, and does not widen existing decision-update permissions. It serialises saves with choosing an option, while the public RPC remains subject to ordinary caller RLS for all writes.

The snapshot trigger discards any client-supplied snapshot and builds the evidence from published catalogue rows. It also sets the citation time. `atlas_private.catalogue_entry_snapshot` is an invoker-only, unexposed projection shared by publication size validation and citation saving, so the two cannot disagree. Trigger-only functions are not callable through the API.

A successful retry must carry the same original Designer provenance and the same set of citations. Different payloads under the same branch ID are refused rather than silently mixed. A retry never resets a subsequent human edit. These records are append-only, including for service-role updates/deletes. A later catalogue replacement or withdrawal never rewrites an option's saved evidence.

## Platform editor and canonical product identity

`/platform-admin/catalogue` keeps one row per real product in
`catalogue_products`, with its dated claims and capability links in
`catalogue_product_capabilities`. A link names one exact `capability_maps`
version and item, so one product can support capabilities in several sectors
without a duplicate product row. `catalogue_drafts` selects product IDs for a
sector version; publication writes the existing immutable entry snapshots and
then publishes the parent catalogue. The reviewer is recorded automatically
as the acting platform admin and retained for audit; it is not displayed in
the admin editor, the catalogue reader, an exported document or a decision
pack.

All writes are platform-admin-only security-definer RPCs with optimistic
`edit_revision` checks. Publication refuses fewer or more than 1-8 claims (a platform with components may have none, once one component is published),
fewer or more than 1-10 links in the pinned set, a claim marked pending review,
or a pinned set that is not published. Existing published versions and saved
option citations are not rewritten. `catalogue_entries.product_id` points at
the canonical product; it is additive and null on existing published snapshots
(the child-immutability trigger refuses updates to them) and for legacy script
loads. The platform editor resolves those rows by code, then vendor/product.
`20261122130000_catalogue_admin_backfill.sql` fills links and claims for the
published rows already present when the first migration was applied.
See [ADR-038](ADR-038-product-catalogue-admin.md).

## Verification and release

`productCatalogue.test.ts` covers contract/row round trips, validation and pattern drift. `productCatalogue.integration.test.ts` uses the real local Supabase for grants, tenant boundaries, publication guards, database-built snapshots, atomic rollback, idempotency, immutability and PostgreSQL regex parity. Its concurrency test runs two actual PostgreSQL sessions using `docker exec ... psql` inside the same local test stack.

Before applying to the hosted project, record both Supabase advisor sets (security and performance). After applying, and again before release, the finding set must be unchanged or smaller. A passing test suite does not substitute for those checks. No hosted migration has been applied by this change.
