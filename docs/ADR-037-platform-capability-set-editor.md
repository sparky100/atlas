# ADR-037 — Platform capability-set drafts

Status: draft, 2026-11-22. Depends on ADR-036 and its reviewed live map alignment.

## Decision

Platform administrators edit a separate `reference_map_drafts` workspace. These rows are not `capability_maps` drafts: they cannot be offered in the starter-map picker or seeded into an organisation model. A guarded database operation validates the complete content and publishes one new immutable `capability_maps` version, with items, citations, value streams, stage links and an audit event in one transaction. The prior current version becomes deprecated. Existing seeded models and their `templateRef` values retain their original map and item IDs.

The editor copies an existing published version, uses the established capability-map content contract and exposes a focused capability tree, sources, stages, a comparison, canonical identity review, and server validation. A saved draft has an optimistic revision. An outdated editor must reload before saving or publishing. The platform role is checked inside each privileged operation; direct authenticated table writes are denied. Ordinary organisation owners get no platform editor access.

The inventory includes the number of distinct organisation models seeded from each version, aggregated by a platform-only operation. It does not expose individual organisation records.

## Identity and rollout boundary

Unchanged items carry an explicitly reviewed canonical identity link from their starting map. A renamed or new item needs a fresh choice in the editor. The administrator searches published canonical identities, explicitly selects a match with a reason, or defines a distinct identity with a stable key and definition. Publication refuses any item without a reviewed identity matching its current name and description. New identities and all map-item links are created atomically with the new published map. This operation does not infer a link from a matching name or code. The reviewed live alignment from ADR-036 remains a rollout prerequisite; without it, copying a large existing map requires reviewing every item again. The current D1–D4 catalogue reader and its sector/version citations are unchanged.

The published content remains readable via existing APIs. The repository JSON loader still skips an already published version; a later export/reconciliation step must make the repository content agree with the app-managed release. The importer is unchanged.

## Verification and operational gate

The migration, TypeScript contract and real database round-trip belong to the same PR. Before deployment, compare both security and performance advisor findings before and after migration and require the after count to be no larger. Run the admin and non-admin RLS tests and the Home-to-editor browser path at 1280 and 390; inspect screenshots on both. A missing local database is a blocked gate, not a passed one.
