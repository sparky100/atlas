# Starter capability maps

Versioned, reviewed sector content (SPEC-data-model.md §3.10, ADR-012) —
never inline in application code (CLAUDE.md rule 7). Loaded into
`capability_maps` / `capability_map_items` / `capability_map_sources` by
`scripts/loadCapabilityMaps.ts` (`pnpm content:load-capability-maps`),
which reads every `content/capability-maps/<sector>/<version>.json` file,
validates it, and upserts it as `service_role` — never as an authenticated
session (these tables have no `authenticated` write grant at all).

## The contract is the schema

**`src/contracts/capabilityMapContent.ts` (`parseCapabilityMapContent`) is
the single source of truth for what a map file may contain.** There is
deliberately no `schema.json` in this directory: a second, hand-written
copy of the rules would only ever drift from the one the loader actually
enforces. Three things read every map through that same parser, so they
cannot disagree with each other:

- `scripts/loadCapabilityMaps.ts` — loads maps into the database.
- `src/contracts/capabilityMaps.content.test.ts` — validates every file in
  this directory on every `pnpm test` run.
- `scripts/reviewCapabilityMaps.ts` — regenerates
  `docs/review/capability-maps.md` (`pnpm content:review-capability-maps`).

The sector list (`SECTORS`) also lives only in that contract — taxonomy
in code, per ADR-001 — not in a database CHECK (dropped in
`supabase/migrations/20260906180000_capability_maps_sector_taxonomy_in_code.sql`).
Adding a sector is one edit there plus its tests, not a migration.

## Minimal valid example

`content/capability-maps/nhs/1.json`:

```json
{
  "sector": "nhs",
  "version": 1,
  "status": "draft",
  "title": "NHS Acute Trust",
  "summary": "One or two plain-English sentences: what this map covers, for the starter-map picker's card face.",
  "sourceDescription": "One paragraph: what this map is, who reviewed it, how current it is — provenance, shown behind the picker card's info affordance, not on its face.",
  "sources": [
    {
      "citation": "A named framework or standard consulted (see sources.md)",
      "url": "https://example.org/framework",
      "reviewedBy": "A person's name — reviewers are often external, not a user id",
      "reviewedAt": "2026-01-01"
    }
  ],
  "items": [
    { "code": "1", "name": "Finance", "level": 1, "parentCode": null, "description": "Planning, controlling and accounting for the organisation's money.", "order": 10 },
    { "code": "1.1", "name": "Financial Accounting", "level": 2, "parentCode": "1", "description": "Recording transactions and producing the statutory accounts.", "order": 10 }
  ]
}
```

## Value streams (F6)

A map may also carry a `valueStreams` array (`[]` when absent, so every
pre-F6 map stays valid). Each stream is one outcome, grouped into stages;
each stage names the capabilities that deliver it by capability **name**
(not code) — the loader resolves those names to `capability_map_items.code`:

```json
"valueStreams": [
  { "code": "vs1", "name": "Getting Connected", "order": 10, "stages": [
    { "code": "vs1.1", "name": "Apply & Quote", "order": 10, "enables": ["Connection Quotations"] }
  ] }
]
```

Rules the parser enforces for value streams (mirrored by
`capability_map_value_stream_items`'s own triggers):

- `valueStreams` codes are unique across the whole map — streams and
  stages share one code space, matching `capability_map_value_stream_items`'s
  `(map_id, code)` uniqueness.
- A stage is exactly one level below its stream (a stream has `stages`,
  never a `parentCode` of its own; a stage never has stages).
- `order` is unique among sibling streams and among a stream's own stages.
- Every `enables` name must match exactly one capability `name` in
  `items` — the parser refuses zero or ambiguous matches (a miss is
  reported with its near-matches).

Rules the parser enforces (and `capability_map_items`'s own
`atlas.guard_capability_map_item_level` trigger mirrors, so a file that
passes the parser can't fail the database):

- `sector` is one of `local_government_scotland`, `local_government_england`,
  `nhs`, `housing`, `hei`, `public_body`, `utility`, `electricity_network`,
  `retail_energy`, `water_wastewater`, `retail_ecommerce`, `financial_services`,
  `manufacturing`, `rail_transport`, `any_organisation`, `police`, `fire_rescue`.
  The deprecated `local_government` still parses, as
  `local_government_scotland`, so old raw JSON isn't rejected — but a file
  must live under its **canonical** directory: the loader checks the path
  against the *parsed* sector, so `local_government/1.json` fails there.
  Write the canonical name.
- `<sector>/<version>.json`'s path must match the file's own
  `sector`/`version` fields (the loader checks both, not just the path).
- `title` (a short display name, e.g. "NHS Acute Trust" — not a
  restatement of `sector`/`version`) and `summary` (one or two
  plain-English sentences on what the map covers) are both required
  (Sprint U4-2a item 4) — the starter-map picker's card shows these on
  its face; `sourceDescription` (how the map was drafted, who reviewed
  it) stays behind the card's info affordance.
- `items` codes are unique within the file.
- A root item (`parentCode: null`) must have `level: 1`; a non-root item's
  `level` is exactly one more than its parent's (so at most three levels).
- `status: "published"` is what makes a map importable into a model (the
  tailoring flow's import picker only lists `published` maps) — leave new
  content at `"draft"` until it's actually reviewed by a named person.
- Every item carries an `order` (integer). It only has to be unique among
  siblings (same `parentCode`) — the parser rejects two siblings sharing
  one. It does not have to be contiguous or start at 1 (see "multiples of
  ten" below), and it's unrelated to `code`, which stays the stable
  identifier deltas and seeded elements reference.

## Editorial conventions (not enforced by the parser — flagged by the review doc)

- Two levels: 8–12 level-1 capabilities, 3–6 level-2 under each.
- Every capability has a one-sentence definition (`description`).
- Names are capabilities — *what the organisation is able to do* — never
  a process (a verb phrase, a lifecycle step) or an org unit (a team, a
  department). `docs/review/capability-maps.md` lists the ones that look
  wrong.
- Definitions are enforced by `capabilityMaps.content.test.ts`: every
  capability, at every level, has a one-sentence definition ending in a full
  stop. Write what the capability is able to do, starting with an -ing verb
  where natural ("Setting prices…"), about 8–18 words.
- Value streams are end-to-end journeys seen from the person or party they
  serve (a customer, patient, tenant, the regulator), named as a verb phrase
  ("Look After Customers", "Pay the council") or "X to Y" ("Meter to Cash") —
  never a group of capabilities ("Data", "DSO"). Stages are short verb or
  verb–noun labels in the order work happens. Every stream carries a
  description in the form "Starts when …. Ends when/with ….", also enforced
  by the test.
- Shared capabilities use identical wording in every map: Finance, Human
  Resources, Procurement, Information Management, Customer Contact,
  Estates, Digital & Technology, Governance & Assurance.
- `sources.md` names the reference models consulted for every map and
  confirms nothing is copied verbatim. Licence for this content: CC BY 4.0.
- Sector maps put their own core capabilities first and the shared
  back-office ones last (Sprint U4-1 C1). Order values within one map are
  multiples of ten (`10, 20, 30, …`) in each item's own sibling group, so a
  later manual insertion between two existing items doesn't force
  renumbering every sibling that follows it — give the new item the
  midpoint value (e.g. `15` between `10` and `20`) instead. The eight
  shared capabilities use the fixed values `1000`–`1070` (in the order
  listed above) in every sector map, deliberately outside any sector's own
  `10`-`90`-ish range, so they always sort after a sector's core
  capabilities regardless of how many that sector has.

Run `pnpm content:load-capability-maps` after adding or editing a file.
Re-running is safe **for a draft map**: the loader upserts by
`(sector, version)`, replacing that map's `capability_map_items`/
`capability_map_sources` wholesale rather than accumulating duplicates.
Once a map is published (below), re-running the loader against its
`(sector, version)` skips it (a published map is fixed history) —
publish content by adding a new version, not by editing a version that's
already out.

## Starting a map from a real model (`content:export-capability-map`)

A file under this directory doesn't have to start from a blank page: Sprint
U4-1 C6's `pnpm content:export-capability-map <org> <model> <sector>
<version>` walks a model's own tailored capability tree at main head and
writes `content/capability-maps/<sector>/<version>.json` for you — names,
definitions, order and parent structure carried over; every model-specific
attribute (an element id, `attributes.code`/`templateRef` from whatever
originally seeded it) dropped, and fresh, sequential codes generated purely
from the tree's own structure and display order. It regenerates
`docs/review/capability-maps.md` afterwards, same as running
`content:review-capability-maps` by hand.

The written file is a `draft` with the same drafting placeholder every
hand-authored map starts with ("Pending human review — exported from model
\"...\""), and this script only writes the file — it does not load it: run
`pnpm content:load-capability-maps` next, exactly as if you'd hand-authored
it, then follow the same review/publish workflow below. Refuses to
overwrite a file that already exists, so re-exporting an in-progress review
never silently discards a human's edits to it.

The owner-only "Export as starter map" action on the capability map page
does the same underlying export, but for a browser session — which has no
filesystem to write a content file to — it writes the result straight into
`capability_maps`/`capability_map_items`/`capability_map_sources` as a new
draft, via a privileged database function rather than this script's file.
Both paths produce the same content from the same model at the same
commit; only where the result lands differs.

## Seeding a draft for review

A `draft` map is real, loaded, queryable, **and seedable** — Sprint U4-1
C6 relaxed the tailoring flow's import picker (and `atlas.seed_from_map`
itself, which enforces this regardless of what the picker shows) to offer
draft maps alongside published ones, flagged "Draft" in the list, so an
owner or architect can seed one into a real model to see how it actually
reads before deciding whether to publish it. A `deprecated` map is never
offered either way.

## Publishing: draft → review doc → a human runs `content:publish-capability-map`

A map stays `draft` — real, loaded, queryable and seedable for review, but
flagged as such everywhere it appears, not indistinguishable from a
reviewed, published map — until someone actually reviews it. The workflow:

1. Load the map (`pnpm content:load-capability-maps`) and regenerate the
   review document (`pnpm content:review-capability-maps`); read
   `docs/review/capability-maps.md` for that sector.
2. A human reviews the map (against the review document's flags, the
   editorial conventions above, and their own domain knowledge) and edits
   at least one of the map's `sources[].reviewedBy` entries in the JSON
   file to their own name, replacing the drafting placeholder
   ("Pending human review — drafted by Claude Code"). Re-run
   `content:load-capability-maps` to pick up that edit — it's still a
   draft map at this point, so the loader's normal wholesale-replace
   still applies.
3. That same human runs `pnpm content:publish-capability-map <sector> <version>`
   (`scripts/publishCapabilityMap.ts`). It refuses to publish a map whose
   sources are all still the placeholder, sets `status: published` and
   `published_at`, and deprecates any earlier `published` version of the
   same sector (a sector has at most one current published map).

After that, `capability_map_items_guard_immutable`
(`supabase/migrations/20260906190000_...sql`) rejects any further
insert/update/delete against that map's items — a published map is fixed;
a needed change is a new version (`<sector>/<version+1>.json`), reviewed
and published the same way.
