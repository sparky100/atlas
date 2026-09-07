# CLAUDE.md — Atlas repository constitution

This file governs how work happens in this repository. It is binding on every contributor, human or AI. Where it conflicts with a request in conversation, this file wins unless the human explicitly overrides it for that one instance — and an override should be rare enough that it's worth asking about.

Read `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md` before writing anything that touches the data model, the delta format, merge, provenance, tenancy, or comments. They are the design authority. This file is about how to work, not what to build — it does not restate their content and should not drift from it.

## Stack

- **Vite + React + TypeScript** — the application shell and UI.
- **Supabase** — Postgres (with RLS as the tenancy enforcement point, per ADR-009), auth, realtime, edge functions. No parallel backend, no second database.
- **Vitest** — unit and property tests (engine, contracts, matching).
- **Playwright** — UI and end-to-end smoke tests.
- **pnpm** — the only package manager. No `npm install`, no `yarn.lock`. If a lockfile other than `pnpm-lock.yaml` appears, that's a bug, not a choice.

## Non-negotiable rules

These are not style preferences. Violating one is a defect, whatever else the change accomplishes.

1. **Every schema change ships with a migration, a contract type, and a round-trip test — together, in the same PR.** A migration with no corresponding `src/contracts` type update, or a type change with no migration, is incomplete. "I'll add the test later" is not an acceptable state for a merged change.
2. **No hand-drawn diagrams.** Every view is a query against the materialised head plus a layout algorithm (ADR-011, SPEC §3.9). If a feature needs a diagram, it needs a `views` row and a rendering query — never a canvas that stores its own node/edge list.
3. **Positions are view hints, never data.** `view_layouts` and `view_annotations` must be deletable in full, for any view, with zero loss of model information (ADR-011's litmus test). If a piece of state fails that test, it isn't a layout hint and doesn't belong in those tables.
4. **No fact without provenance.** Every delta carries `sourceId` and `confidence` (ADR-007, SPEC §4). There is no code path that writes an element, relationship, or attribute value without going through a delta. If you find yourself writing directly to `elements_head` or `relationships_head` from application code, stop — those tables are materialised projections, not something to hand-write.
5. **No delete without a delta.** Nothing in `deltas`, `commits`, `tags`, `element_merges`, or `resolved_conflicts` is ever updated or deleted by application code (SPEC §2, §9). Retiring something is a `retract` delta; undoing a retraction is a `restore` delta. If a table needs a hard delete to fix a bug, that's an incident, not a migration.
6. **No `Math.random` in anything deterministic.** Id generation, ordering, hashing, and merge classification must be reproducible given the same inputs (SPEC §6.6, P-1/P-3). Use a seeded generator explicitly injected for anything that must vary (e.g. UI transitions), and never for anything that touches `deltas`, `commits`, or the head hash.
7. **No demo shortcuts.** No seeded or fixture data reachable from a production code path — seed data lives in test setup or in `capability_maps` as versioned, provenance-carrying content (ADR-012), never inline in application logic. No `// TODO: real implementation`, no stubbed function left to silently do the wrong thing, no hard-coded response standing in for a real query. If something isn't built yet, the feature is absent (and said so, plainly), not faked.

## Code layout

```
src/contracts/   Wire and storage contracts: the delta union, commit envelope, invariants. No logic, no I/O.
src/engine/      Deltas, merge, head — fold/materialise, validation gates, three-way merge classification. Pure functions where possible; the thing SPEC §6-§7 describes.
src/db/          Supabase client, typed queries, RLS-aware access helpers. No business logic — a thin, typed layer over the database.
src/capture/     The capture pipeline: parsing spreadsheets/PDFs/text, matching (SPEC §8), producing capture_draft commits.
src/ui/          React components and views. Never writes deltas directly — always through src/engine and src/db.
supabase/migrations/   One migration per schema change, forward-only, matching SPEC-data-model.md table-for-table.
docs/            ADRs, specs, this file's companions. Kept current — see Definition of Done.
```

A change that needs to cross these boundaries in an unexpected direction (e.g. `src/ui` computing a merge classification itself instead of calling `src/engine`) is a sign the layering is being worked around, not a sign the layering is wrong — raise it rather than route around it.

## Definition of done for a sprint

A sprint is not done until all of the following are true, not merely attempted:

- **Tests green.** Unit, property (the RT-/P- suites named in `SPEC-data-model.md` §10 for anything they cover), and integration tests all pass. A skipped or `.only`'d test is not green.
- **Migration applied to a fresh project from zero.** `supabase/migrations` replayed against an empty database produces the schema this sprint's code expects, with no manual steps. If a migration only works against an already-running project, it's broken.
- **Playwright smoke passes, from the first UI sprint onward.** The core user path the sprint touched is exercised end-to-end, not just unit-tested. Not applicable to a sprint that ships no UI at all — a backend-only sprint has nothing a browser could smoke-test, and a Playwright test against an API-only backend would itself be the kind of demo shortcut rule 7 rules out. `docs/SPRINT-F1-STATUS.md` raised this as a genuinely open question after Sprint F1 (option (a): treat the bullet as not-yet-applicable until a UI sprint exists, and revisit it then; or (b): require some backend-appropriate substitute instead). Closed here, as option (a): the bullet is suspended, not replaced, for a sprint with no UI, and applies in full to every sprint from the first one that ships UI onward (Sprint U1 and every sprint since).
- **Docs updated.** If the sprint changed the data model, the delta format, merge behaviour, or an ADR-level decision, `docs/` reflects it before the sprint is called done — not as a follow-up ticket.
- **No known data-loss path.** Nobody on the team can name a sequence of actions that loses a fact, a comment, a decision, or history, without it either being fixed or explicitly written down as an accepted, reviewed risk.

If any of these is false, the sprint is not done — say so plainly rather than reporting partial progress as complete.

## How to work with the human

- **Stop at the end of each numbered step and summarise.** When a task is broken into numbered steps (in a prompt, a plan, or an issue), complete one step, then stop and give a short summary of what changed and what's next, before continuing. Don't chain multiple steps into one silent pass.
- **Ask when a decision isn't covered by the ADR or the spec.** `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md` are the design authority, and both explicitly name what they left open or deferred. When an implementation choice genuinely isn't answered by either — not "the answer takes a moment to find," but "the documents are silent or point two ways" — ask, using a concrete recommendation and the trade-off, rather than picking silently and moving on. Inventing an unrecorded decision and shipping it is the failure mode this whole document exists to prevent: an undocumented choice is exactly the kind of untracked fact this product is built to eliminate everywhere else.
- **When you do make a small, clearly-scoped judgment call** (naming, file layout, which existing pattern to follow), make it and say what you chose and why — don't ask about things a reasonable default already answers.
