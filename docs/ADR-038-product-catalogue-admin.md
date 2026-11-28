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

## Amendment, 26 November 2026: sector catalogues become read-only history (step 4b-3)

No migration; screens only.

- **Read-only.** Platform admin > Sector catalogues lists versions and their
  products for reading. The create-draft button, the drafts list and the draft
  editor route are removed. The database functions for sector drafts stay
  (tests and loaders use them); removing them is a separate decision.
- **Withdrawing is checked.** A sector page names the products of its current
  version that no published product matches (vendor and product name, case
  ignored) and keeps "Withdraw current version" disabled until none are left,
  because users would lose them. If the check cannot be read, withdrawal stays
  disabled. The existing guarded `withdraw_catalogue` still records who, when
  and why; the check is on the screen only.
- **Citations unchanged.** Saved citations to a sector catalogue keep reading
  from the frozen sector tables, withdrawn or not.

## Amendment, 26 November 2026: source-link check (step 5a)

Migration `20261126250000_catalogue_source_checks.sql`; edge function
`catalogue-link-check`; walkthrough `proposals/WALKTHROUGH-catalogue-step-5a-link-check.md`.

- **Table keyed by link.** `catalogue_source_checks` holds the latest check of
  each distinct source URL: works, moved, gone or could not check, with the
  HTTP status, the final address when it moved, who ran it and when. It is
  keyed by URL because saving a product replaces its claim rows. It is a
  record only: it never edits a claim, flags a published revision or
  unpublishes anything.
- **Who can see and write.** Platform admins only, one policy per action. This
  is the one library table an admin writes directly rather than through a
  guarded function; the server stamps who and when (a signed-in person cannot
  name someone else). No new callable function: the stamping trigger and its
  helper are not executable through the API.
- **The function writes nothing.** It confirms the caller is a platform admin
  with the caller's own session, requests up to 25 links, reads no page body,
  and returns the results; the browser saves them. The service key is never
  involved. Only plain public https pages are requested (standard port, no
  credentials, no IP numbers or local names, the resolved address and every
  redirect target checked, three redirects at most, eight seconds each). The
  rules are in `src/tools/catalogueLinkCheck.ts` and tested.
- **Not here.** The AI claim check, turning failures into review items and the
  monthly schedule are step 5b.

## Amendment, 26 November 2026: AI claim check (step 5b-1)

Migration `20261126260000_catalogue_claim_checks.sql`; edge function
`catalogue-claim-check`; walkthrough `proposals/WALKTHROUGH-catalogue-step-5b-claim-check.md`.

- **Table keyed by product, link and statement.** `catalogue_claim_checks`
  holds the latest AI verdict (supported, changed, can't tell) with the quote,
  a short note, the model, token counts, and who/when. A "supported" verdict
  must carry a quote (check constraint). It is a record only: it never edits a
  claim or unpublishes a product.
- **Server-stamped people and dates.** A trigger stamps who and when. A
  dismissal ("I looked: it still stands") changes only the dismissal columns
  and cannot alter the AI's verdict; a new check clears the dismissal.
  Platform admins only, one policy per action; the trigger function is not
  executable through the API, so no new advisor finding.
- **Quote or "can't tell".** The page text is untrusted data. The AI must
  quote a sentence; the quote is verified against the page (case, spacing and
  quote marks flattened, at least 15 characters) or the verdict is downgraded.
- **Key and limit.** The function confirms the caller is a platform admin,
  reads the platform AI key through a service-role-only RPC, and stops at a
  daily token total of 1,000,000 counted from saved results (re-checks that
  overwrite a result are undercounted). It writes no catalogue data; the
  browser saves results under admin RLS.
- **Not here.** The monthly schedule and run record (5b-2) and finding new
  products (step 6).

## Amendment, 27 November 2026: monthly check and run record (step 5b-2)

Migration `20261127010000_catalogue_monthly_check.sql`; edge function
`catalogue-monthly-check`; walkthrough `proposals/WALKTHROUGH-catalogue-step-5b-2-monthly-check.md`.

- **A switch, off by default.** `catalogue_check_schedule` holds one row.
  Platform admins can change only `enabled`; the server stamps who and when.
- **A run record.** `catalogue_check_runs` has one row per run, manual or
  monthly: scope, status, counts, tokens, who started it. Browsers write only
  manual runs (column grants and policies); the monthly function writes its own.
  No cost figure is stored (M7).
- **The job.** pg_cron calls `atlas.run_monthly_catalogue_check()` on days 1 to
  3, every 30 minutes from 03:00 to 05:30 UTC. It does nothing while the switch
  is off or the function's address (Vault `catalogue:schedule_url`, set by
  hand, never in the repository) is unset. It posts through `pg_net`
  (installed in the `extensions` schema) with a secret the migration generates
  inside the database into Vault (`catalogue:schedule_secret`).
- **The function.** No Supabase sign-in (`verify_jwt = false`): the caller is
  the job, proved by the secret, compared without stopping at the first
  difference. Each call takes a batch of 20 claims with no check from the last
  25 days, checks their links, then reads the claims with the platform AI key
  (same quote rule, same daily limit as the buttons, shared with manual runs)
  and saves under "Monthly check (switched on by <name>)". A claim whose link
  is gone is saved as "can't tell" without reading it, so it counts as checked.
  A day with no key or no allowance leaves one run record, not one per call.
- **What it cannot do.** It writes only the source-check, claim-check and run
  tables; it never edits a claim, flags a published revision or unpublishes.
- **No new callable function.** The stamping triggers, the secret reader (service
  role only) and the job's function are revoked from public, anon and
  authenticated.
- **Not here.** Finding new products and proposing links (step 6).

## Amendment, 27 November 2026: find new products (step 6a)

Migration `20261127020000_catalogue_find_products.sql`; edge function
`catalogue-find-products`; walkthrough `proposals/WALKTHROUGH-catalogue-step-6a-find-new-products.md`.

- **The function writes nothing.** A platform admin sends a capability's name and
  definition and the sector. The platform AI key (Vault, service role) is used with
  the provider's web search tool (at most 5 searches, 8 products). Every cited
  page is read under the link-check safety rules and a claim is kept only if its
  sentence is on the page (the 5b-1 quote rule). A product with no surviving
  claim is dropped.
- **The browser saves.** It checks the library by vendor and name (rule I1) and
  saves new products as drafts through the one guarded `save_catalogue_product`,
  linked to the capability they were found for. That function now accepts claim
  origin `researcher` for a claim that is new in the save; kept claims keep their
  origin. A platform admin could therefore label their own new claim as
  Researcher-found; that errs toward more scrutiny, and who saved it is always
  recorded by the server.
- **Run record.** `catalogue_check_runs` gains scope `find` and counters
  `searches` and `products_found`. A separate daily limit of 300,000 tokens is
  counted from these runs (a tab closed before the run is recorded is not counted).
- **Sent to the provider:** capability name and definition, sector, the word
  "product". No organisation data (A2).
- **Not here.** Proposing links from products already in the library, and running
  this across a set (step 6b).

## Amendment, 27 November 2026: find products for a set (step 6b)

Migration `20261127030000_catalogue_rejected_links.sql`; walkthrough
`proposals/WALKTHROUGH-catalogue-step-6b-find-for-set.md`.

- **Proposed links, by rules.** From the library's products and their links, a
  link to a capability of the chosen set is proposed when the product is linked
  to the same code in another version of the same sector's set, or to the same
  name (any case or spacing) in any set. General capabilities (codes 1 to 8) are
  never proposed; they link through their shared identity. No AI, no new function.
- **Accept** is an edit through `save_catalogue_product`; the server records who
  and when. **Reject** writes `catalogue_rejected_links` (product, set, code, name,
  reason, who, when). Platform admins only, one policy per action, who and when
  stamped by the server, no update or delete from a browser. A rejection holds for
  the same name in a later version.
- **Run over many capabilities.** The browser calls `catalogue-find-products`
  once per chosen capability (at most 10), recording one run with scope
  `find_set`. The function's daily limit now counts `find` and `find_set` runs;
  the browser also stops a run when the day's total would pass the limit.
- **Not here.** AI-assisted matching of products to capabilities (to be added only
  if the rules miss too much).

## Amendment, 27 November 2026: collapsed results, link actions and duplicate merge

Migration `20261127040000_catalogue_link_actions_and_merges.sql`; proposal
`proposals/PROPOSAL-catalogue-results-presentation.md`.

- **Kept links.** `catalogue_source_checks` gains `hidden_until`, `hidden_by`,
  `hidden_by_name`, `hidden_reason`. The stamping trigger sets who and when
  whenever the date changes, ignores a forged name, and lifts the hide when a new
  check finds a different result. Nothing about a claim or revision changes.
- **Use the new address / replace the address** edit the cited claims through
  `save_catalogue_product`, so the server records who and when, a published
  product shows "published, with changes", and the edited claims need review again.
- **Merges.** `catalogue_product_merges` (merged product, kept product, reason, who,
  when). Platform admins only, one policy per action (select, insert, delete),
  stamped by the server, no update. A product that others were merged into cannot be
  merged away and a merged product cannot be merged into. Merging adds the kept
  product's missing links and claims through the guarded save first (claims as new
  drafts), then records the merge; a published product to be merged must be
  withdrawn first. Merged products are left out of the product list, the review
  queue, the link and claim checks and the link proposals by the browser; they still
  count as "already in the library", under the product they were merged into, when
  products are found. Undo deletes the record; what was added stays.
- **Matching.** Find products and the set search treat a product name with or
  without the vendor's own name in front as the same product.
- **No new callable function**; both triggers are revoked from public, anon and
  authenticated.

## Amendment: platforms and components (2026-11-27)

(proposals/PROPOSAL-catalogue-platforms-and-components.md, step A.)

- **Part of.** `catalogue_products.part_of_product_id` points at another library
  product. One level only: a trigger refuses a product that is part of itself, a
  component of a component, and a platform that has components becoming a
  component. Delete is restricted. No new element type: a platform is a product in
  the library, and capability links stay on its components (model rule M3).
- **Saving.** `save_catalogue_product` sets it. A save that does not mention
  `partOfProductId` leaves it as it was; null clears it, so older callers cannot
  clear it by accident.
- **Publishing.** A platform with at least one component may be published with no
  capability links of its own. It still needs its own sourced, reviewed claims.
  Published revisions do not yet record the component list (step C).
- **Duplicates.** A platform and one of its own components are not offered as a
  possible duplicate pair.
- **No new callable function**; the trigger function is revoked from public, anon
  and authenticated.

## Amendment: suggested platforms (2026-11-27)

(proposals/PROPOSAL-catalogue-platforms-and-components.md, step B.)

- **Suggestions are computed, not stored.** `suggestPlatforms` groups a vendor's
  products by the first word of their name once the vendor's own name is dropped,
  and names the platform by the words they all share. A group needs two or more
  products. Products already a component, products that are platforms, and the
  same product under two names (a duplicate) are left out. Nothing is written until
  a person confirms.
- **Confirming** adds a missing platform as a draft with no links and no claims
  (so it cannot be published until it has a sourced, reviewed description), then
  sets "part of" on each chosen product through the guarded save. The server
  records who and when as for any save.
- **Turning one down** writes `catalogue_rejected_platform_pairs` (product, the
  words the platform would be named by, who, when). Platform admins only, one
  policy per action, server-stamped, no update or delete from the browser.
- **No new callable function**; the stamping trigger is revoked from public, anon
  and authenticated.

## Amendment: published versions record the platform (2026-11-27)

(proposals/WALKTHROUGH-catalogue-platforms-step-C.md, step C1.)

- `catalogue_product_revisions.part_of_name` and `component_names` are written
  when a version is published, and frozen with it. A component's version names
  its platform, and a platform's version names its components, as they were at
  that moment.
- Only products that are themselves published (newest version, not withdrawn)
  are named, so a draft product's name is never visible to users. The result is
  that publication order matters: publish the platform after its components, or
  publish the component again after the platform, for the names to appear.
- Signed-in users read the two columns like the rest of a published version
  (names only). `atlas.catalogue_product_is_published` is a helper that is not
  callable through the API.
- Capability pages and decision product lists show "Part of X" and "Components:
  ...". The Designer's context is unchanged in this step.

## Amendment: Find and the set search propose a platform (2026-11-27)

Step C2 of platforms and components.

- The Researcher may name, for a found product, the larger platform it is a
  module of. The name is kept only when a page the product's claims cite
  contains it, and never when it is the product's own name. Otherwise it is
  dropped, so the search never guesses a platform.
- Saving a found product reuses the library product of that vendor and name as
  its platform, or makes a draft platform with no links and no claims (as in
  suggested platforms) once per run. The platform's description is a person's
  to write and source; it cannot be published until then.
- Products already in the library are never changed by a search. If the named
  platform is itself a component, or is one of the same run's new products, the
  product is saved on its own.
- No schema change. The function only adds an optional `platform` field to its
  answer; the browser accepts answers without it.

## Amendment: find the components of a platform (2026-11-27)

- A saved product that is not itself a component has a "Find components"
  button. It sends only the platform's name and vendor to the same function
  (`catalogue-find-products`), as a second kind of request.
- The Researcher is asked for the vendor's own list of the platform's modules.
  Every answer is treated as being about the given platform; a module is kept
  only when a cited page has a quoted sentence and names the platform.
- Each kept module that is not already in the library is saved as a draft
  component of the platform, with no capability links (a visible gap, M4) and
  claims marked as found by the Researcher. Modules already in the library are
  shown and left as they are.
- No schema change. The run is recorded like any other find run.

## Amendment, 28 November 2026: a failed check is not a check

A first real claim run saved 143 results as "Can't tell, the AI could not be
reached" and showed them as "Checked by the AI". The page had been read; every
call to the AI had failed, and the reason was thrown away.

- A failed call to the AI now returns `aiError` with a plain reason (key
  refused, model unknown, rate limit, provider problem). It is not saved, so the
  claim stays unchecked, and a batch that all fails stops the run (on demand
  and monthly) instead of sending the rest into the same fault.
- A claim whose page could not be read is saved with no model and a note
  starting "Not checked." and is shown as "Not checked", still waiting for a
  check. "Can't tell" now means only that the AI read the page and it does not
  say enough, or its quote could not be confirmed.
- Early rows with the note "The AI could not be reached." are ignored when
  listing and when choosing monthly work, so those claims count as unchecked
  and a re-run replaces them. No schema change and no data was deleted.

## Amendment, 28 November 2026: Waiting for review split in two

Waiting for review had grown to seven panels, mixing tools that run (buttons,
progress, results) with lists a person decides on, with the review queue itself
last and a different collapse pattern in each panel. It is now two pages with
one pattern (`ReviewSection`): Waiting for review holds five decision blocks
(claims to review, claims to look at, source links to look at, possible
duplicates, suggested platforms) with a count each; Find and check holds the
tools (monthly check, check links and claims, find products, find products for
a set). The first block with something waiting opens, and an empty block is
dimmed and still opens, so a result message or the merged-products record stays
reachable. No schema, function or permission change.
