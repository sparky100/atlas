# Starter capability maps

Versioned, reviewed sector content (SPEC-data-model.md §3.10, ADR-012) —
never inline in application code (CLAUDE.md rule 7). Loaded into
`capability_maps` / `capability_map_items` / `capability_map_sources` by
`scripts/loadCapabilityMaps.ts` (`pnpm content:load-capability-maps`),
which reads every `content/capability-maps/<sector>/<version>.json` file,
validates it against `src/contracts/capabilityMapContent.ts`'s schema, and
upserts it as `service_role` — never as an authenticated session (these
tables have no `authenticated` write grant at all).

This directory ships empty (Sprint U2 step 2): the loader and the schema
are real and tested, but real sector maps are Prompt 9's work, not this
one's. Nothing reads or writes these tables until a real map exists here.

## File format

One file per `<sector>/<version>.json`, e.g.
`content/capability-maps/local_government/1.json`:

```json
{
  "sector": "local_government",
  "version": 1,
  "status": "draft",
  "sourceDescription": "One paragraph: what this map is, who reviewed it, how current it is.",
  "sources": [
    {
      "citation": "e.g. a named framework or standard",
      "url": "https://example.org/framework",
      "reviewedBy": "A person's name — reviewers are often external, not a user id",
      "reviewedAt": "2026-01-01"
    }
  ],
  "items": [
    { "code": "1", "name": "Revenues and Benefits", "level": 1, "parentCode": null },
    { "code": "1.1", "name": "Council Tax", "level": 2, "parentCode": "1", "description": "Optional." },
    { "code": "1.1.1", "name": "Council Tax Support", "level": 3, "parentCode": "1.1" }
  ]
}
```

Rules the loader enforces (matching `capability_map_items`'s own
`atlas.guard_capability_map_item_level` trigger, so a file that passes the
loader's validation can't fail the database's):

- `sector` must be one of `local_government` / `nhs` / `housing` / `hei` / `generic`, and `<sector>/<version>.json`'s path must match the file's own `sector`/`version` fields (the loader checks both, not just the path).
- `items` codes are unique within the file.
- A root item (`parentCode: null`) must have `level: 1`.
- A non-root item's `level` must be exactly one more than the item its `parentCode` points to (so at most three levels, L1–L3).
- `status: "published"` is what makes a map importable into a model (`capability_maps_select`'s RLS is open to every authenticated user regardless of status, but the tailoring flow's import picker only lists `published` maps) — leave new content at `"draft"` until it's actually reviewed.

Run `pnpm content:load-capability-maps` after adding or editing a file.
Re-running is safe: the loader upserts by `(sector, version)`, replacing
that map's `capability_map_items`/`capability_map_sources` wholesale
rather than accumulating duplicates.
