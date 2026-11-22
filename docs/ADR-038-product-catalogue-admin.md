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
marked pending review, and 1-10 capability links in the pinned set. Reviewer
names stay internal to this admin view and are not shown to catalogue readers.

## Consequences

- Product identity, claims and cross-sector capability links no longer drift
  when the same vendor product appears in several sector catalogues.
- Sector fit remains explicit: a link is per capability-set version, not an
  implication that supporting one sector's capability supports another's.
- Published catalogue content stays immutable. Corrections are a new version.
- The repository JSON loader remains the bulk content path; once a catalogue
  is app-managed, new versions should be published from the platform editor so
  the canonical product library stays authoritative.
