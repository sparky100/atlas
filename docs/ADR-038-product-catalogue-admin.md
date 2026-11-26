# ADR-038 — A platform product library and sector catalogue publications

Status: implemented, 22 November 2026. Builds on ADR-036 (shared capability
identities) and ADR-037 (platform capability-set drafts).

## Decision

The same product appears once in `catalogue_products`, with its claims in
`catalogue_product_claims` and its capability links in
`catalogue_product_capabilities`. Product code is unique, and a second row
with the same vendor and product name (case-insensitive) is refused. A link
names one exact capability-set version (`capability_map_id`) and one item in
it. One product can therefore support capabilities in several sets and
sectors without being copied.

A sector catalogue remains a versioned publication. `catalogue_drafts` records
a title, a pinned published capability-set version and a selection of product
IDs. Publishing is one transaction: it writes the existing immutable
`catalogue_entries`, `catalogue_entry_capabilities` and `catalogue_claims`
rows, then publishes the parent `product_catalogues` row. Earlier published
versions and saved option citations are never rewritten.

The existing end-user reader and `{sector, version, entryCode}` citation
contract are unchanged. `catalogue_entries.product_id` is an additive pointer
to the canonical product; old entries were backfilled by normalised
vendor/product name. A future script load that does not know about the library
may still leave it null, and is not a publication path for the app-managed
editor.

## Editing and guardrails

`/platform-admin` gains a **Product catalogue** section beside **Capability
sets**. It can list and edit the product library, add links by choosing a
capability-set version and an item from it, edit dated claims, create a sector
draft from the current published catalogue, validate and publish, inspect a
published version, and withdraw a current version with a reason.

All writes are platform-admin-only `SECURITY DEFINER` operations. The browser
has no direct write grant. Saving a product or draft is optimistic on
`edit_revision`; an outdated editor must reload. Product claims may be kept
while incomplete, but publication requires 1-8 claims per product, no claim
marked pending review, and 1-10 capability links in the pinned set. The
reviewer is recorded automatically as the acting platform admin and retained
for audit; it is not displayed in the admin UI, the catalogue reader or an
exported pack. **Amended 23 November 2026:** list → detail routes (products,
sector catalogues, versions and drafts) replace the single long catalogue
section.

## Consequences

- Product identity, claims and cross-sector capability links no longer drift
  when the same vendor product appears in several sector catalogues.
- Sector fit remains explicit: a link is per capability-set version, not an
  implication that supporting one sector's capability supports another's.
- Published catalogue content stays immutable. Corrections are a new version.
  Existing published entries keep `product_id` null because the immutability
  trigger refuses updates to them; the editor resolves those rows by code,
  then normalised vendor/product. New public versions carry the pointer.
- The repository JSON loader remains the bulk content path; once a catalogue
  is app-managed, new versions should be published from the platform editor so
  the canonical product library stays authoritative.

## Amendment, 26 November 2026: drafted and reviewed are separate steps

Status: implemented (step 1 of `proposals/PROPOSAL-catalogue-maintenance.md`).

A product claim is **drafted** until someone **reviews** it. Typing a claim no
longer signs it. `catalogue_product_claims` gains `review_state`
(`drafted`/`reviewed`), `origin` (`person`/`researcher`/`imported`),
`drafted_by`, `drafted_by_name`, `drafted_at` and `reviewed_by_user`;
`reviewed_by` (a name) and `reviewed_at` are now empty until reviewed, and a
check keeps the two in step. The 20 claims already in the library were reviewed
before this change and stay reviewed (origin `imported`).

- **Any platform admin can review**, including the person who drafted the
  claim (Simon, 2026-11-26). There is no separate reviewer list and no
  second-person rule.
- **The server records the names.** The editor sends a claim without a
  reviewer. `review: true` on a claim asks `atlas.save_catalogue_product` to
  mark it reviewed by the signed-in admin; the function writes the name, the
  user id and the date. Reviewing is folded into the existing save function so
  no new function is callable by signed-in users (build rule 9).
- **A review lasts only while the claim says the same thing.** On save, a claim
  with an unchanged kind, statement, source and source date keeps its state; a
  new or changed claim is a new draft by the person saving.
- **Publication needs every claim reviewed.** `atlas.catalogue_draft_issues`
  refuses a product with a claim that is not reviewed. The free-text
  `Pending review` marker is no longer used for products.
- **Who approved a publication** is the actor on the existing `published`
  draft event. Product and draft events now carry `actor_name`, filled by a
  database trigger from the actor's profile (else the email's local part).
- Names are shown to platform admins only (product editor, `Waiting for
  review` at `/platform-admin/catalogue/review`). Reader views, exports and
  packs still never read them (`src/ui/reviewerPrivacy.test.ts`).
- Published `catalogue_entries`, `catalogue_claims` and saved citations are not
  touched.


## Amendment, 26 November 2026: link a product to a capability's meaning

Step 2 of `proposals/PROPOSAL-catalogue-maintenance.md`. Migration
`20261126200000_catalogue_link_by_meaning.sql`.

- **Shared capability links.** `catalogue_product_general_links(product_id,
  capability_id, how_it_supports)` links a product once to a reference
  capability identity (ADR-036). It is written only by
  `atlas.save_catalogue_product` (the editor sends `generalCapabilities`),
  readable by platform admins, with no browser write grant.
- **One-off alignment.** The migration creates one published identity for each
  general capability (codes 1 to 8) and aligns every published set's item to
  it, only for a code that appears in every published set with one name and
  one definition. The recorded basis says so and says Simon approved the bulk
  alignment on 26 November 2026. It is idempotent and never aligns a draft or
  deprecated set.
- **Resolution into a pinned set.** `atlas.catalogue_product_links_in_map`
  (invoker only, revoked from public, anon and authenticated, so no new
  callable function) returns a product's own links in any version of that
  sector's set, matched by code and worded as the pinned set words them, plus
  its shared links resolved through the alignment. A sector link wins over a
  shared link on the same code.
- **Validation and publication** (`catalogue_draft_issues`,
  `publish_catalogue_draft`) use that resolution, so the 1 to 10 rule counts
  both kinds of link and publication freezes both into the entry. The reader
  and earlier frozen catalogues are unchanged.
- **Editor.** The product page offers "Shared capability (every sector)" and
  "Sector capability". A sector capability whose code is a general one is not
  added twice: the page says to link it as shared.
- Existing links to codes 1 to 8 stay sector links; converting them belongs to
  the import in step 3. A sector still publishes a new catalogue version to
  show new links until per-product publication (step 4).

## Amendment, 26 November 2026: the files are loaded once, then no longer a source

Step 3 of `proposals/PROPOSAL-catalogue-maintenance.md`. Migration
`20261126210000_catalogue_import_from_files.sql`, generated by
`pnpm content:build-catalogue-import` from `content/catalogue` and never
hand-edited (a unit test fails if it drifts from the files).

- **One product per vendor and product name.** Each sector's newest file is used.
  Links are kept per sector set; claims are the union, the same statement and
  source counted once. A link to a general capability becomes one shared link;
  any other link is a sector link, worded as its pinned set words it.
- **Every claim is loaded as drafted** (origin `imported`, no reviewer), whatever
  the file said. A claim whose statement a library product already has is not
  added again; reviewed claims are never changed.
- **A product none of whose links resolve is skipped**, so a database without
  the real capability sets (every test database) loads nothing. No test data is
  seeded.
- **Idempotent and additive.** Existing products, claims and reviews are never
  changed or removed. Published catalogues are untouched.
- **Files are no longer a source for the live project.** `content:load-catalogue`
  and `content:publish-catalogue` refuse to run against anything but a local
  Supabase (`scripts/catalogueFilesGuard.ts`). Changes are made in
  Platform admin > Products.

## Amendment, 26 November 2026: a product is published on its own (step 4a)

Step 4 of `proposals/PROPOSAL-catalogue-maintenance.md`, first half. Migration
`20261126220000_catalogue_product_publication.sql`.

- **A revision is a frozen copy of one product**: name, vendor, summary, claims
  (with origin, drafter, reviewer and review date) and links (shared and
  sector). Tables `catalogue_product_revisions`, `_revision_claims` and
  `_revision_links`; immutable apart from one-time withdrawal columns.
- **Who and when.** `published_by`, its name and `published_at` are recorded
  from the signed-in platform admin; any platform admin can publish (Simon).
- **Published** = the newest revision is not withdrawn. **Unpublished
  changes** = the product was edited after that revision. Editing never
  changes a revision.
- **Withdraw** needs a written reason (1-500 characters) and applies once to
  the newest revision, which stays readable.
- **Rules to publish:** every claim reviewed, 1 to 8 claims, at least one
  capability or shared link. A failed publish saves nothing.
- **No new callable function.** Publish and withdraw are `publication` in the
  existing `save_catalogue_product`, so the advisor count is unchanged.
- **Users see no change in 4a.** Readers, option citations, Designer and packs
  still use sector catalogues. Step 4b switches them, with its own walkthrough.

## Amendment, 26 November 2026: users can read published products (step 4b-1)

Step 4b of `proposals/WALKTHROUGH-catalogue-step-4b-reader-switch.md`, first PR.
Migration `20261126230000_catalogue_published_products_readable.sql`.

- **Who can see what changes.** Any signed-in user can read a product's newest,
  not-withdrawn revision with its claims and links. Withdrawn revisions and
  revisions a newer one replaced stay admin-only. Any signed-in user can read
  which general capability a published map item is aligned to, with the written
  basis and who aligned it; alignments of unpublished maps stay admin-only. User
  ids of publishers and reviewers on product revisions are not readable by
  browsers; the names are.
- **Replaced is recorded once** on the older revision (`superseded_at`, set by a
  trigger when a newer revision is inserted), so the read policy does not read
  its own table.
- **One policy per table and action**, replacing the admin-only ones, so the
  advisor's multiple-permissive-policy count does not grow. No new callable
  function.
- **One reader**, `listPublishedProductsForCapability` (`src/db/publishedProducts.ts`),
  matches a capability's shared identity or its sector code. No screen uses it
  yet (step 4b-2).

## Amendment, 26 November 2026: screens and citations switch to published products (step 4b-2)

Migration `20261126240000_catalogue_cite_product_revisions.sql`.

- **What users see.** The capability page and the decision products panel list
  published products first. A product that exists only in a sector catalogue
  (electricity v1) keeps showing from it, so nothing disappears. When both
  exist, the product wins, matched on vendor and product name (case ignored).
  The Designer's product list uses the same reader.
- **Citation convention (changes the walkthrough).** The walkthrough proposed a
  new product-revision column on `option_catalogue_sources`. Instead a citation
  to a product revision reuses the existing columns: `sector = 'product'`,
  `version` = the revision number, `entry_code` = the product's stable code.
  This keeps the two guarded functions, the Designer's `catalogueRefs` shape,
  the pack and the ADR export working for old and new citations alike, and old
  citations are untouched.
- **Snapshot.** The existing snapshot trigger builds the snapshot of a product
  revision (claims with reviewer, links, publisher and approver) through a
  helper that is not callable through the API. Only a product's currently
  published revision can be newly cited.
- **Standing.** Computed from the cited revision: current, replaced by a newer
  revision, or withdrawn (with its reason). A saved citation stays readable
  after withdrawal.
- **Who can see what.** A revision that is withdrawn or replaced becomes
  readable to a user only if one of their organisation's options cites it. No
  new callable function; no change to the guarded functions' checks.
