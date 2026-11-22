# ADR-036: A capability identity shared across starter maps

**Status:** Proposed, 22 November 2026. This is the first additive schema slice of the platform reference-content plan. Publication and editing in the app, product identity, and a reader switch are separate steps.

## Context

ADR-012 gives each sector map a version and each item a map-local ID, code, wording and provenance. An organisation capability seeded from it keeps `templateRef`. A product catalogue currently cites a sector map and code. The same business ability can occur in several sectors and versions, so that address cannot be the permanent identity for a product-support claim. A name or equal code by itself does not prove the two items mean the same thing.

## Decision

`reference_capabilities` gives one stable platform ID and key to a business ability, independent of a sector. `reference_capability_revisions` records its versioned wording; a published revision is immutable. `reference_map_item_links` aligns an existing map item to one **published** revision, with a named mapper and a written review basis. One map item has at most one alignment; one identity may be used by several map items, sectors and versions. A published map's alignment is immutable once recorded. Draft map alignments may be revised.

The schema begins **empty**. No migration guesses matches from a common name, code, description or sector. The repository's `shared-capabilities.json` is a strong editorial candidate list, not an automatic database backfill. The existing live published content is correct and remains authoritative; its exact map-item IDs and citations must be inventoried before a reviewed mapping manifest is applied. Published versions and saved citations are not rewritten. A different business meaning receives a new identity, even if two maps use the same label.

These tables have no organisation ID because they are Simmodlr reference content, not model facts. For now only platform admins can read them, and authenticated sessions cannot write them. A later, narrow platform-admin operation will validate and write drafts; its own authorization and audit design is a separate step. No browser credential bypasses RLS.

## Consequences and boundary

- Existing `capability_maps`, `capability_map_items`, `sources`, organisation elements, deltas, seeding and the importer retain their meaning and code paths.
- The D1–D4 tool `find_catalogue_products` and old `{sector,version,entryCode}` option citations keep their existing contract. A future adapter can use the new alignment only after an explicit rollout and compatibility tests.
- An unmapped map item remains valid and usable. Neither a product nor a model capability gains a canonical identity by inference.
- A published revision cannot be edited or removed; a material correction creates a new revision. The identity key can be corrected while everything is still draft, then becomes fixed on first publication. A linked draft map item cannot be deleted by the legacy loader until the link is removed. This slice inserts no draft links, so existing loading behaviour is unchanged.
- `retired_at` and the UI for retiring an identity are deferred until a real lifecycle is specified. No product publication unit is changed by this ADR.

## Alternatives

Copying products per sector preserves the current duplicate and makes cross-sector evidence drift. Linking products directly to `capability_map_items.id` ties their identity to a particular map version. Name-based matching makes plausible but false equivalences and could alter a live published reference without review. All three were rejected.
