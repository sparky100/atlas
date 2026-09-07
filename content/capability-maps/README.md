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
  "sourceDescription": "One paragraph: what this map is, who reviewed it, how current it is.",
  "sources": [
    {
      "citation": "A named framework or standard consulted (see sources.md)",
      "url": "https://example.org/framework",
      "reviewedBy": "A person's name — reviewers are often external, not a user id",
      "reviewedAt": "2026-01-01"
    }
  ],
  "items": [
    { "code": "1", "name": "Finance", "level": 1, "parentCode": null, "description": "Planning, controlling and accounting for the organisation's money." },
    { "code": "1.1", "name": "Financial Accounting", "level": 2, "parentCode": "1", "description": "Recording transactions and producing the statutory accounts." }
  ]
}
```

Rules the parser enforces (and `capability_map_items`'s own
`atlas.guard_capability_map_item_level` trigger mirrors, so a file that
passes the parser can't fail the database):

- `sector` is one of `local_government_scotland`, `local_government_england`,
  `nhs`, `housing`, `hei`, `public_body`, `utility`, `electricity_network`.
  The deprecated `local_government` still parses, as
  `local_government_scotland`, so old raw JSON isn't rejected — but a file
  must live under its **canonical** directory: the loader checks the path
  against the *parsed* sector, so `local_government/1.json` fails there.
  Write the canonical name.
- `<sector>/<version>.json`'s path must match the file's own
  `sector`/`version` fields (the loader checks both, not just the path).
- `items` codes are unique within the file.
- A root item (`parentCode: null`) must have `level: 1`; a non-root item's
  `level` is exactly one more than its parent's (so at most three levels).
- `status: "published"` is what makes a map importable into a model (the
  tailoring flow's import picker only lists `published` maps) — leave new
  content at `"draft"` until it's actually reviewed by a named person.

## Editorial conventions (not enforced by the parser — flagged by the review doc)

- Two levels: 8–12 level-1 capabilities, 3–6 level-2 under each.
- Every capability has a one-sentence definition (`description`).
- Names are capabilities — *what the organisation is able to do* — never
  a process (a verb phrase, a lifecycle step) or an org unit (a team, a
  department). `docs/review/capability-maps.md` lists the ones that look
  wrong.
- Shared capabilities use identical wording in every map: Finance, Human
  Resources, Procurement, Information Management, Customer Contact,
  Estates, Digital & Technology, Governance & Assurance.
- `sources.md` names the reference models consulted for every map and
  confirms nothing is copied verbatim. Licence for this content: CC BY 4.0.

Run `pnpm content:load-capability-maps` after adding or editing a file.
Re-running is safe **for a draft map**: the loader upserts by
`(sector, version)`, replacing that map's `capability_map_items`/
`capability_map_sources` wholesale rather than accumulating duplicates.
Once a map is published (below), re-running the loader against its
`(sector, version)` fails loudly instead — publish content by adding a
new version, not by editing a version that's already out.

## Publishing: draft → review doc → a human runs `content:publish-capability-map`

A map stays `draft` — real, loaded, queryable, but not offered by the
tailoring flow's import picker — until someone actually reviews it. The
workflow:

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
