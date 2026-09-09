# EA app — kick-start prompt set

Working name: **Atlas** (placeholder; rename freely).
Separate product, separate repo, separate Supabase project. Shares code with the simmodlr suite only through an extracted package.

---

## State — 9 September 2026, updated same day (read this first; supersedes the earlier reset)

**Done and on `main`:** F1, U1, U2, H1, C1, C1-H, U3a (creation), persistent model navigation, U3b (front doors, browse, mobile header), director door rebuilt to its handoff, architect door health findings, ADR-019, the add-a-system flow, M1a (comments backend: profiles, comments, mentions, notifications, realtime), eight starter maps published, **PR #18** (U4-1: search-pool refresh, commit titles, activity rows, lane roll-up and `supports.role`, relationship verb, health findings, capability map order/grid/tiles/colour-by/export, element header cleanup, mobile landscape actions, electricity map v2 draft), and **PR #19** (GitHub Actions reduced to the single `deploy-migrations.yml` workflow described below — `CLAUDE.md`'s "Verification (all local)" and `README.md`'s "What runs when" already document the result; nothing further to do on that front). Housekeeping item 2 below (this same day) additionally lands: this pack committed at its own named path, the `pnpm release` script, the ADR-000 preface fix, and the two SPEC §11 additions — see that item's own line for exactly which parts and which don't. **Open:** none of the above; next is the ordering below.

**How verification and deployment actually work:** all three suites run locally on the desktop before push and are reported in the sprint summary with the commands. GitHub Actions is reduced to nothing, or to one `supabase db push` job on push to `main` — done, not aspirational, as of PR #19. Migrations are applied with `supabase db push` from the desktop (`pnpm release`, added this same day: runs `supabase db push`, then a reminder that Cloudflare Workers Builds deploys the app itself automatically on push — nothing else to run); the GitHub Actions workflow does the same automatically on every push to `main`, as a backstop. "CI green" in the definition of done means "all three suites green locally on the final commit"; `main` has never had a green Actions run and that is no longer the gate.

**Paths:** handoff docs live at `docs/HANDOFF-*.md` (not `docs/design/`). This pack is committed at `docs/prompts/atlas-prompt-pack.md` — done. ADR numbering in this file follows the repo (`docs/ADR-000-foundations.md`, ADR-001–019; its preface now says so — fixed this same day, it used to say "through 014").

**Findings loop:** the GitHub issue list is the backlog. Every finding from use becomes an issue with a label (`bug`, `design`, `missing`) before it becomes a prompt. The `bug` label exists; **`design` and `missing` still need creating** — the tooling available when this pack was committed had no way to create a GitHub label (no `gh` CLI, no label-create call in the GitHub MCP server used), so this one sub-item of housekeeping item 2 is still open, not done. U4-n sprints take the top 8–12 issues.

**Definition of usable (unchanged):** an architect can sign up, seed or build a capability tree, add twenty systems with owners, lifecycle dates and verb-labelled relationships, see them on the landscape and capability map, make one change through a branch (retire a system, add its replacement) and merge it, tag before and after, and show a director the capability map with exposure colouring, on a phone and a desktop.

**Order from here.**
1. Fix the failing Workers Builds check (not investigated by the session that committed this pack — status as of PR #18's own head is "failing", not re-checked since); `pnpm release`; use the DNO model for the human sentence. (Merging PR #18 is done — see above.)
2. Remaining housekeeping: **create the `design`/`missing` issue labels** (the one sub-item still open — needs a human or a session with real GitHub label-admin access, `gh label create` or the web UI; everything else this item named is done, see the State lines above).
3. **M1b** — comments UI, built to `docs/HANDOFF-M1b-comments.md` — **exists now, reviewed and corrected against the codebase (2026-09-09)**: one wrong token fixed, `describeDelta`'s real strings substituted for invented ones, and one real gap flagged rather than silently resolved (the comment marker and the landscape's existing "+N" extra-lane marker both want the same node corner — pick one before touching `LandscapeCanvas.tsx`, see the handoff's own closing decision row). Ready to build from.
4. Hour of use → issues → **U4-2** (drag-to-reorder is already queued there; expect the change flow, versions and the architect door's remaining §3.2 items to surface).
5. Repeat until the definition of usable holds.
6. Then C2 (split), K1 (capture), D1 (decisions), Q1 (duplicates), R1 (roadmap).

**Plumbing track (may run alongside the UI track; engine changes allowed; every item ends with integration tests against local Supabase):** delta-apply in SQL (SPEC §11 row 4, before K1) → capture design and pipeline backend (Prompts 10–11 without the queue UI) → C2 engine half (closure, `split_branch`) → D1 tables (decisions, assumptions, evidence, links) → duplicates job → LLM proxy edge function extracted and deployed. The two tracks never touch the same files in the same week.

**Rules that hold:** engine frozen on the UI track; use before summarise; one summary per sprint; stop mid-sprint only for ADR or schema decisions; gaps recorded in docs, never only in code comments; no sprint starts until the human has used the previous one on dev.

---

The ordering matters. Prompts 0–2 produce documents that every later prompt reads. Do not start Claude Code build work until 0–2 exist and you have edited them.

---

## Prompt 0 — Fable: product and architecture decision record

> You are helping design a new enterprise architecture product for mid-market and public-sector organisations (councils, NHS boards, housing associations, universities; 500–5,000 staff, one or two architects, currently on Sparx, Visio or spreadsheets). It is a separate product from an existing suite of modelling tools, but reuses that suite's philosophy: small taxonomies, no scope creep, AI-assisted capture with human review.
>
> The thesis: most EA tools are metamodel-first, diagram-as-data, decay within months, and never record why. This product is model-first with diagrams as derived views, C4-shaped (landscape → context → container → component) with one business layer above (capability), and its wedge is **capture with smart merging** plus **changes as branches** plus **decisions with arguments**.
>
> Requirements: multi-user with organisations and roles; versions (immutable tagged snapshots); changes (solution designs) as branches of deltas against the current landscape, with as-is / to-be views; merge of delivered changes into the landscape through a review queue; capture pipeline producing proposed deltas from spreadsheets, PDFs and text; provenance (source, date, confidence) on every fact; comments anchored to any element; decisions linked to changes, elements, assumptions and evidence; starter capability maps per sector.
>
> Produce `docs/ADR-000-foundations.md` as a set of numbered architecture decisions, each with context, decision, alternatives rejected, and consequences. Cover at minimum:
> 1. Taxonomy: element types (capability, system, container, component, person/team, external), relationship types (contains, supports, uses, owns, flows-to), attribute sets per type, and the explicit list of things that are *not* types.
> 2. Delta model: typed delta rows vs JSON patch; commit structure; branch and tag semantics; how the materialised head for main is rebuilt and validated.
> 3. To-be composition: single branch first; how "all approved branches" will be composed later and what conflict means.
> 4. Provenance: fact-level, not element-level; how a fact is superseded; how conflicts between sources are surfaced.
> 5. Identity and merging: stable ids, alias tables, matching strategy (exact id → alias → name + context), what a merge records.
> 6. Tenancy and access: organisation-scoped RLS, roles, what a viewer can and cannot see, model-level sharing.
> 7. Comments: anchor model, threading, resolution, survival across merges.
> 8. Diagrams as views: the rule that no view is hand-drawn; layout persistence (positions are per-view hints, never data).
> 9. Capability maps: sector starter maps as versioned content; tailoring; recording provenance of the map.
> 10. Package boundary with the existing suite: what is extracted into a shared package (graph editor primitives, schema validation, versioning helpers, LLM proxy) and what is not.
> 11. Documentation: the model holds facts and links, never documents. A `links` table anchored to an element, relationship, change or decision, with title, URL, owner, last-checked, optional content hash and optional AI summary with provenance. No file storage in v1, no link taxonomy. The test for what belongs in the model versus a linked document is "would you query or diff across it" (protocol and data classification yes; payload schema no).
> 12. Duplicate prevention: creation is search-first (no create button on views; the create option appears only after a search misses), near-matches shown with context (owner, relationship count) at creation; contributor creations go through a branch or the review queue before reaching main; element merge is one reversible action (re-point references, losing name becomes an alias, losing element tombstoned by delta); a nightly duplicates report by name similarity, shared owner and shared relationships surfaced on the architect home screen.
> 13. Lifecycle fields on system and container from v1: `introduced` and `planned_end` dates, so roadmap views in v2 have data to draw.
>
> Push back on anything in this brief that you think is wrong or under-specified. Be concrete: name tables and fields where a decision depends on them. Do not write code.

---

## Prompt 1 — Fable: data model and delta specification

> Read `docs/ADR-000-foundations.md`. Produce `docs/SPEC-data-model.md` containing:
> 1. Every Postgres table with columns, types, constraints, indexes and a one-line purpose. Include: organisations, members, models, commits, deltas, branches, tags, elements_head, relationships_head, sources, facts, aliases, decisions, comments, links, capability_maps.
> 2. The delta format as a TypeScript discriminated union in `src/contracts/delta.ts` (write the actual code), plus the invariants a valid commit must satisfy.
> 3. The head-rebuild algorithm in pseudocode, and the validation that proves head == fold(deltas).
> 4. The merge algorithm for a branch into main: per-element three-way comparison, conflict classification, what the review queue shows for each class.
> 5. RLS policies as actual SQL for organisations, models, commits and comments.
> 6. A list of round-trip and property tests that must exist before any UI is built.
>
> Where the ADR left a choice open, make it and record it in the spec. Do not write UI or engine code.

---

## Prompt 2 — Sonnet: repository constitution

> Read `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md`. Write `CLAUDE.md` for the new repository. It must state:
> - Stack: Vite + React + TypeScript, Supabase (Postgres, auth, realtime, edge functions), Vitest, Playwright for UI, pnpm.
> - Non-negotiable rules: every schema change ships with a migration, a contract type and a round-trip test; no hand-drawn diagrams; positions are view hints; no fact without provenance; no delete without a delta; no Math.random in anything deterministic; no demo shortcuts (no seeded data in code paths, no "TODO real implementation").
> - Code layout: `src/contracts`, `src/engine` (deltas, merge, head), `src/db`, `src/capture`, `src/ui`, `supabase/migrations`, `docs`.
> - Definition of done for a sprint: tests green, migration applied to a fresh project from zero, Playwright smoke passes, docs updated, no known data-loss path.
> - How to work with the human: stop at the end of each numbered step and summarise; ask when a decision isn't covered by the ADR or spec rather than inventing one.
>
> Also produce `docs/UI-principles.md` (see Prompt 3 input) as a placeholder heading only.

---

## Prompt 3 — Fable: UI principles and design system brief

> Read the ADR and spec. This product must have a materially better UI than Sparx, Ardoq, LeanIX and Structurizr for two audiences: an architect who lives in it, and a service owner or director who opens it twice a quarter. Produce `docs/UI-principles.md` covering:
> 1. Navigation model: capability map → landscape → system context → containers → components as one zoom gesture; breadcrumb; back/forward; deep links to any element at any level.
> 2. The two front doors: what the director sees on open (capability map, health, changes in flight) vs what the architect sees (recent activity, review queue, their branches). Same model, different first screen, switchable.
> 3. The element page: identity, attributes with provenance badges, relationships grouped by type, changes touching it, decisions about it, comments. This page is the product's unit of trust; specify it in detail.
> 4. The review queue: layout for accept / merge-into / reject / split; keyboard-first; showing source passage next to proposed fact.
> 5. Views: landscape, capability map, context, container; as-is / to-be selector; diff highlighting rules (added, removed, changed) that are colour-blind safe.
> 6. Comments: inline anchoring, side panel, unresolved count.
> 7. Design system constraints: typography scale, spacing, colour tokens including diff and status semantics, density modes (comfortable/compact), dark mode from day one, keyboard shortcuts list, 60 fps pan/zoom target on 2,000 elements.
> 8. What we will not build: freeform drawing, arbitrary shapes, per-diagram styling, arrow-head zoo.
>
> Then produce `docs/UI-first-screens.md`: written wireframes (ASCII or structured description) for the six screens above at desktop width.

---

## Prompt 4 — Claude Code: foundation sprint

> Read `CLAUDE.md`, `docs/ADR-000-foundations.md`, `docs/SPEC-data-model.md`. Read `/mnt/skills/public/frontend-design/SKILL.md` before any UI work in later sprints; not needed here.
>
> Sprint F1 — foundations, no UI. Stop and summarise after each step.
> 1. Initialise repo per CLAUDE.md. Supabase project wiring, env handling, CI running lint, typecheck, Vitest, and a fresh-database migration check.
> 2. Migrations for organisations, members, models, commits, deltas, branches, tags, elements_head, relationships_head, aliases. RLS as in the spec. Seed nothing.
> 3. `src/contracts`: taxonomy enums, element and relationship types, delta union, commit type. Round-trip tests.
> 4. `src/engine/deltas`: apply, invert, fold; `src/engine/head`: rebuild head from commits, validate head == fold. Property tests with generated delta sequences.
> 5. `src/engine/branch`: create branch at commit, list deltas, compute three-way diff vs main; `src/engine/merge`: classify conflicts per spec; unit tests for each conflict class.
> 6. `src/db`: repository layer for commits/branches/tags with optimistic concurrency; integration tests against a local Supabase.
>
> Definition of done per CLAUDE.md. No React yet.

---

## Prompt 5 — Claude Code: element page and landscape

> Read `CLAUDE.md`, the ADR, spec, `docs/UI-principles.md`, `docs/UI-first-screens.md`, and `/mnt/skills/public/frontend-design/SKILL.md`.
>
> Sprint U1 — the first two screens, built to the design system, not a placeholder.
> 1. Design tokens and base components (typography, spacing, colour incl. diff/status semantics, dark mode, density toggle). Storybook or equivalent for every primitive.
> 2. Auth, organisation switcher, model list. Roles enforced in UI and RLS.
> 2a. user_preferences table (user_id PK, home_mode, density, theme: light | dark | system), migration + contract + round-trip test. Theme and density are applied on load before first paint (no flash), switchable from the user menu, and saved on change. Default theme is "system". Colours must be CSS variables under a single root attribute (e.g. `data-theme`), never hard-coded in components, so the tokens can be shared with other apps later. Playwright: switch theme, reload, verify it persisted.
> 3. Element page exactly as specified: attributes with provenance badges (provenance may be "manual" for now), relationships grouped by type, empty states designed rather than blank.
> 4. Landscape view: systems, people/teams, externals, and relationships; auto layout (choose and justify: ELK or dagre); pan/zoom at 60 fps on a generated 2,000-element model (add a generator under `tests/perf`, never in app code); click-to-zoom into system context.
> 5. Editing: add/edit/remove elements and relationships from the UI produces commits on main via the engine; optimistic locking surfaces "changed by X" instead of overwriting. Adding is search-first per ADR-012: a search box over names, aliases and descriptions, near-matches shown with owner and relationship count, and a create option that appears only after the search misses. Merge-two-elements as one reversible action (references re-pointed, alias recorded, tombstone delta).
> 6. Playwright: create org, create model, add three systems and two relationships, reload, verify. Also: attempt to add a system whose name matches an existing alias and confirm the match is offered; merge two systems and undo.
>
> No capture, no branches in UI yet.

---

## Prompt 6 — Claude Code: capability map, versions and zoom

> Sprint U2.
> 1. Capability element type with containment; capability map view (nested boxes, two levels shown, third on expand); colour by attribute and by derived metrics (supporting-system count, oldest lifecycle stage).
> 2. Starter capability maps as versioned content under `content/capability-maps/<sector>/<version>.json` with a loader, tailoring flow (import, rename, delete, add), and provenance recorded on the model. Ship with an empty scaffold; real maps come from Prompt 9.
> 3. Zoom chain: capability → landscape filtered to supporting systems → context → containers → components. Breadcrumb and deep links.
> 4. Versions: tag main at a commit with name and note; version list; open any version read-only; diff two versions using the engine's three-way diff rendered with the diff highlighting rules.
> 5. Tests and Playwright for tagging, opening and diffing versions.

---

## Prompt 7 — Claude Code: changes as branches, as-is / to-be, merge

> Sprint C1. This is the core differentiator; build it fully.
> 1. Create change (branch) with name, description, target date, status.
> 2. Editing while a change is selected writes deltas to the branch; baseline greyed, delta highlighted per diff rules; switch between as-is and to-be on every view.
> 3. Change page: summary of deltas grouped by element, affected capabilities via `supports`, other open changes touching the same elements.
> 4. Merge flow: status → delivered opens the review queue per spec; per-element accept/skip; conflict classes rendered with the three-way context; partial merge leaves remainder on the branch.
> 5. Rebase branch on new main head with conflict surfacing.
> 6. Tests: engine merge classes end-to-end via UI; Playwright for the full create-edit-view-merge path.

---

## Prompt 7a — Claude Code: C1 hardening (from AUDIT-2026-09-C1)

> Sprint C1-H. Runs on the desktop with a local Supabase and Playwright; nothing counts as verified otherwise. One summary at the end. Nothing is "complete" until CI is green on the final commit.
>
> **Item 1 (done 2026-09-07):** CI root causes fixed (commit_deltas overload ambiguity, organisations_select RETURNING race, atlas schema exposed to PostgREST, service_role grants, merge_branch null-row bug, case-only path collision), landscape reads by commit_id with `assertInFilterSize`, `selectAll` pagination with exact-count check on all head-table reads, SPEC §6.7. Measured: p50 59.9 fps, p5 ~30 fps.
>
> **Item 1 closing:** (a) perf gate as a no-regression baseline (p50 ≥ 55, p5 ≥ 28); keep 45 as the target in UI-principles §8.6; add "landscape p5 fps 30→45, profile worst frames first" to SPEC §11, target R-perf. (b) Scope the landscape fixture's ids per run via a run seed. (c) Rewrite `listRelationshipsTouchingAny` to read by commit_id and filter client-side, under `assertInFilterSize`.
>
> **Item 2:** in `atlas.commit_deltas`, when `p_kind = 'merge'` on a change branch, set `branches.base_commit_id = p_merged_branch_head_commit_id` in the same transaction (ADR-005 amendment). Integration test: refresh after main moved; assert `base_commit_id` = main head and `resolveBranchModeProjection`'s As-is = main head fold. Note in SPEC §5.
>
> **Item 3:** enforce C8 in engine `apply()`: `element.retract` rejected unless every relationship referencing the element is retracted or re-pointed earlier in the same commit. Property test; keep the UI gate.
>
> **Item 4:** after the submit → approve → merge integration test, `rebuildHead` and assert head == fold byte-for-byte.
>
> **Item 7:** docs. Correct UI-principles §6.2 and §10 decision 8 (the As-is/To-be/Diff control is built); name `resubmit_merge_request` in ADR-006; every C1 deferral in SPEC §11 with a target (split/closure/structural actions → C2; identity-dismiss persistence and review-queue Playwright → C2; merge_elements → Q1; roadmap → R1; shortcuts and propose-change picker → M1; typed client → H2; p5 fps → R-perf).
>
> **Item 8:** CLAUDE.md verification, definition-of-done and working rules (see "Working rules" below); `docs/NEXT.md` with the current order.
>
> **Moved to C2 (do not build here):** item 5 (persist identity dismissals in `merge_requests.classification`, P-18 test) and item 6 (viewer visibility before/after `shared_for_review`; concurrent refresh with `Promise.all`; Playwright for BranchRebasePanel, `/review` list, and branch-ref visits to Context/Container/Component).
>
> All three suites locally, push, CI green, one summary. Then deploy to dev and use it before C2.

---

## Prompt 7b — Claude Code: partial delivery by split

> Sprint C2. Implements ADR-006 amendment rules 1–3 (split). Read ADR-005/006, SPEC §5–7 and the C1 audit §2.5, §4 items 3–4 first. Stop and summarise after each numbered step; the summary must list each ADR-006 rule as built / not built.
> 1. Engine: `computeSplitClosure(branchHead, mergeBase, acceptedSubjectIds)` → `{ accepted, pulledIn, blocked }`. Pulled in: relationships whose endpoints are accepted-or-pulled new elements; parents required by accepted new children; anything an accepted delta structurally depends on. Blocked: retracts that unaccepted deltas still depend on, with the dependent named. Property test: for any accepted subset, folding `accepted ∪ pulledIn` over the merge base yields a head that passes C8 and C9 with no dangling references.
> 2. `atlas.split_branch(p_branch_id, p_subject_ids uuid[], p_commit_id, p_message, p_deltas, ...)` security definer: creates a change branch with `split_from`, status approved, same target date; writes one fresh commit whose deltas are the closure's effect folded over the merge base (never copied delta rows); leaves the original branch unchanged; returns the new branch. Role: owner/architect. Test: original still folds cleanly afterward; split folds to exactly the closure.
> 3. Review queue: per-element accept/skip; closure preview ("accepting 4 pulls in 2; 1 retract blocked because X depends on it") before confirm; confirm → `split_branch` → `merge_branch` on the split, whole, in one user action. If everything is accepted, no split is created; the ordinary merge path runs.
> 4. Structural-conflict resolution actions deferred from C1: keep-retraction / keep-element cascade, duplicate-relationship survivor pick, cardinality primary pick, all expressed through the same closure machinery and recorded as `resolved_conflicts`.
> 5. Change page: "delivered / remaining" panel live from `resolveChangeLineage`; original and splits shown as one logical change. Roadmap treatment is R1.
> 6. Tests: closure property tests; split of a branch with conflicts; refresh of the remainder after a split; Playwright for accept-subset → preview → split → merge, and for a blocked retract.
> 7. Folded in from C1-H: persist identity dismissals in `merge_requests.classification` (P-18 test); integration tests for viewer visibility before/after `shared_for_review` and concurrent refresh with `Promise.all` (exactly one wins); Playwright for BranchRebasePanel, the `/review` list, and branch-ref visits to Context/Container/Component asserting the mode control renders.
> Out of scope: multi-branch to-be composition (ADR-005), `merge_elements` (Q1). One summary at the end, listing each ADR-006 rule as built / not built; deploy to dev and use the split flow before calling it done.

---

## Prompt 7c — Claude Code: U3a creation

> Sprint U3a. Blocking: the app cannot create elements or relationships from the UI. One summary at the end. Engine frozen except ADR-018.
> 1. ADR-018 — main always has a head: `commit_kind 'genesis'`; `on_model_created` inserts a genesis commit with no deltas and points main's base and head at it; genesis is the only kind allowed a null parent, only via that trigger; `seed_from_map` and `commit_deltas` always require a parent (template_seed becomes an ordinary kind); migration backfills genesis for models with a null head; delete the service-role genesis bootstraps in tests. SPEC §3/§5 updated.
> 2. Search-first "Add" (ADR-012) for systems and actors on the Landscape page, containers on a system's context page, components on a container page. Type a name → matches on names, aliases and descriptions with owner and relationship count → "Create <type> '<name>'" only when nothing matches. `element.create` via `commit_deltas` (main for owner/architect; the selected branch otherwise) with the user's manual source. On success open the element page. Landscape empty state says "Add a system" with the control in place.
> 3. Element page Relationships section: "+ Add" under each relationship-type group allowed for the element's type and direction (from `RELATIONSHIP_TYPE_RULES`), opening the search-first picker restricted to allowed target types; `relationship.create` via `commit_deltas`.
> 4. Capability map empty state: "Add a capability" creates the first level-1 tile and opens the map; "seed from a starter map" is primary when any map is published.
> 5. Playwright: from an empty model, add two systems and a `uses` relationship between them from an element page and confirm it renders on the landscape; add one capability by hand and a `supports` from a system to it. No seeding.

---

## Prompt 7d — Claude Code: U3b front doors and browse

> Sprint U3b, per UI-principles §3. One summary at the end. Engine frozen.
> 1. Replace ModelHome's placeholder with the two front doors, selected by `user_preferences.home_mode` and switchable in place. Director: capability map thumbnail with exposure tone, counts (capabilities, systems, open changes), changes in flight by status, last three versions. Architect: recent commits, review queue count with oldest item, your open branches, duplicates count wired to zero until Q1. Both: search box (search-first) that opens or creates an element.
> 2. Element browse: filterable, sortable table of elements by type with owner and lifecycle, reachable from both doors.
> 3. Every empty state in the app offers a next action; none says "not built yet".
> 4. Mobile: the header collapses email/theme/density/sign-out into a user menu; breadcrumb truncates sensibly.
> 5. Use only design-system components; audit every route for raw HTML lists/links and fix.
> 6. Playwright: both doors render for a seeded model, switching persists, search opens an element, table filters, mobile viewport shows the collapsed menu.

---

## Prompt 7e — Claude Code: U4 from findings (template)

> Sprint U4-n. Input is the GitHub issue list labelled bug / design / missing, in the order the human gave. Take the first eight to twelve. Fix screen by screen: for each screen touched, empty, populated, error and next-action states all read correctly before moving on. Engine frozen; if a finding needs a schema change, record it as a design finding in SPEC §11 and skip it. Playwright for each fixed finding. One summary listing each issue as fixed / not fixed with the reason, and the human's sentence about using it.

---

## Prompt 8 — Claude Code: comments (M1a backend, M1b UI)

> **Sprint M1a — comments backend.** Plumbing track; runs now. One summary at the end. No UI beyond what tests need.
> 1. `atlas.profiles` (user_id PK → auth.users, display_name, handle global/lowercase/unique with a default from the email local part, avatar_url, updated_at). Created by trigger on first membership; editable by the user only; readable by fellow org members via RLS. Email is never exposed to other members. Commit and comment author display reads profiles. Record in SPEC §3 and ADR-009.
> 2. Tables per ADR-010 and SPEC: `comments` (id, org_id, model_id, anchor_type: element|relationship|change|decision|version, anchor_id, branch_id nullable, view_kind nullable, parent_comment_id, body, author_id, status open|resolved, resolved_by, resolved_at, created_at, edited_at), `comment_mentions` (comment_id, user_id), `notifications` (id, user_id, kind, comment_id, read_at, created_at). RLS: visibility follows the anchor (main and tags visible to members; branch-anchored comments visible to whoever can see the branch, viewers only when shared_for_review); authors edit their own; owner/architect resolve any; contributors resolve their own threads. Contracts and round-trip tests.
> 3. Anchors are stable subject ids, never commit ids. Tests: comment on a branch element → merge → still listed on the element on main; comment → refresh/rebase → unchanged; comment on a retracted element → readable from history, flagged as anchored to a retracted subject.
> 4. Mentions: parse @handle at write time against profiles into `comment_mentions`, one notification per mentioned member. In-app only, no email.
> 5. Realtime: Supabase channels per model for presence (who is viewing which ref), commit notifications, comment inserts/updates; a client module with reconnect and re-sync on resume. Integration test: two clients see each other's comment on the channel.
> 6. `unresolved_comment_counts(model_id, anchor_ids[])` via POST for element cards and change pages.
> 7. Comments never block a merge (ADR-006); `merge_branch` ignores them.
> SPEC §3/§9 updated; member directory, invite UI and notification tray recorded in SPEC §11 with target U4.
>
> **Sprint M1b — comments UI.** Runs after the design pass, built to the Claude Design handoff. Side panel plus inline markers on views and the element page; thread, reply, resolve, @mention autocomplete from profiles; unresolved counts on element cards and change pages; notification tray. Playwright: comment on an element from a branch view, merge, see it on main; mention a member and see the notification.

---

## Prompt 9 — Fable: sector capability maps

> Produce eight capability maps as JSON validated by `src/contracts/capabilityMapContent.ts` (`parseCapabilityMapContent` is the schema; there is no schema.json): Scottish local authority, English local authority, NHS board/trust, housing association, university/college, a generic public body, a generic UK utility (regulated, asset-owning: water, gas or electricity, with shared capabilities such as asset management, network operations, customer and metering, regulatory compliance and price-control reporting, connections, emergency response), and an electricity network operator as a worked example (DNO/transmission: network planning, connections and DSO functions, outage and fault management, asset health and investment planning, smart metering data, flexibility markets, Ofgem reporting). The utility map and the electricity map should share level-1 wording where the capability is the same, with the electricity map adding sector-specific level-2 entries rather than restating the generic ones. Two levels: 8–12 level-1, 3–6 level-2 each. Use identical wording for shared capabilities (finance, HR, procurement, information management, customer contact, estates, digital & technology, governance & assurance). Each capability has a one-sentence definition. Include a `sources.md` naming the reference models consulted and confirming nothing is copied verbatim. Licence: CC BY 4.0.
>
> Review each map for process-shaped or org-unit-shaped entries and remove them.
>
> Run this in Claude Code against the repo. Read `src/contracts/capabilityMapContent.ts` and `content/capability-maps/README.md` first, and validate every map with `parseCapabilityMapContent` in a test before finishing. Do not change the contract; if a map needs something it lacks, list it and stop.
>
> Then generate `docs/review/capability-maps.md` from `content/capability-maps/`: per sector, the full tree with definitions; then a level-1 cross-sector matrix (rows = level-1 names, columns = sectors); then flagged items (process-shaped or org-unit names, duplicates across levels, level-2 groups outside 3–6, definitions under eight words). Don't change the maps in that step. Also produce `scripts/reviewCapabilityMaps.ts` that regenerates the document.

---

## Prompt 10 — Fable: capture pipeline design

> Read the ADR and spec. Produce `docs/SPEC-capture.md`: sources table and lifecycle; candidate extraction contract for spreadsheet/CSV, PDF and pasted text; the LLM prompts (system and user) that produce candidates in the taxonomy with confidence and source passage; the matching algorithm (exact id → alias → name+context) with thresholds; how a capture run becomes a branch; the re-import diff (new/changed/gone per source); what the review queue shows per candidate class; failure modes and how each is surfaced. Include evaluation: a fixture set of ten messy inventories with expected outcomes and a scoring script definition.

---

## Prompt 11 — Claude Code: capture pipeline

> Sprint K1, from `docs/SPEC-capture.md`. Build the fixture set and scoring script first; the pipeline is done when it passes the fixtures, not when the UI looks right. Edge function for LLM calls through the shared proxy. Review queue UI per `docs/UI-principles.md`, keyboard-first. Re-import diff. Aliases learned from merges.

---

## Prompt 12 — Claude Code: decisions

> Sprint D1. Decision node: title, context, options, choice, consequences, date, decided-by, status incl. superseded-by. Links: belongs-to change, affects element or capability, rests-on assumption/evidence (evidence reuses facts with provenance; assumptions are a light node with owner and confidence). Decision list, decision page, "why is this here" panel on the element page walking back through decisions. Export a decision as a standalone ADR markdown.

---

## Prompt 13 — Claude Code: duplicates report

> Sprint Q1. Nightly job (edge function on a schedule) producing duplicate candidates per model: name similarity over names and aliases, shared owner, overlapping relationship sets. Store results with a score and the evidence; surface a count on the architect home screen and a list page with merge / not-a-duplicate actions. "Not a duplicate" is remembered so the pair is not re-proposed. Tests on a fixture model with known duplicates.

---

## Prompt 14 — Claude Code: roadmap view (v2)

> Sprint R1. A roadmap view with rows by capability or by system, time on the horizontal, lifecycle bars from `introduced` and `planned_end`, markers where changes add or retire elements, and replacement arrows from the planned-replacement rule (system added in an approved or in-delivery change, supporting the same capability, where the same change retires the old system). Filters: capability, owner, contracts ending within the window, changes by status. As-is / to-be selector applies. Export to PNG and to a table. No editing on the roadmap; dates change on the element or change page.

---

---

## Decisions from use — September 2026

Recorded here so they land in the right sprint rather than only in conversation.

**Model (small engine change; one migration, one contract update, schedule before the landscape lanes get heavier use):**
- `supports` gains an attribute `role: primary | secondary`; a system has at most one primary (check constraint). Placement on the landscape uses the primary lane; other lanes show a linked reference, never a duplicate box. No primary → the Unassigned lane.
- `uses` and `flows_to` gain a required free-text `label` (the verb: "withdraws cash using"). Creation asks for it; the review checklist flags any relationship without one.
- Planned-replacement rule is per capability: replacing a system's finance function does not clear Housing's exposure.

**Creation (U3a/U3b):**
- "Add system" has a second, optional step: "supports which capability?" with the same search-first picker; default path links it.
- A system with no `supports`, a capability with no owner, and a capability with no supporting system are health findings shown on the architect front door with counts, and on the landscape as an "Unassigned" lane that reads as work to do.

**Views (UI-principles §6, U4 findings):**
- Context view in the C4 landscape style: description text inside the tile, verb label on every edge, dotted enterprise boundary with externals outside, actors drawn as people.
- Landscape keeps capability lanes at estate scale, adds the enterprise boundary and actors; the C4-style view is for one system's context.
- Keep the palette semantic (exposure, lifecycle); no per-box colour.
- Persistent model-level navigation (Home, Capability map, Landscape, Changes, Versions, Review queue) on every model route; left rail on desktop, bottom bar or menu on mobile.

**Capture (K1):** mapping an inventory row to a capability using the starter map's vocabulary is the pipeline's single most valuable inference; `supports` proposals are a first-class output.

**Business architecture (future ADR, after usable):** add value streams (value stream → stages, `enables` from capability to stage) as the one addition beyond capabilities. Organisation units stay as actor/team + `owns`; strategy stays in Lens and is cited from a change; processes and information objects stay out.

**Starter-map review loop (gap found 2026-09-09, schedule with U4-1):** reviewing a map is easier in the app than in markdown. Add `pnpm content:export-capability-map <org> <model> <sector> <version>` plus an owner-only "Export as starter map" action on the capability map page: walks the capability tree at main head, writes `content/capability-maps/<sector>/<version>.json` (names, definitions, order, parent structure; model-specific attributes dropped) and regenerates the review doc. Draft maps are seedable into a model for review (owner-only, flagged draft). Workflow: load draft → seed scratch model → edit in app → export as next version → publish. Content correction pending for the electricity map: add a level-1 "Network Delivery & Maintenance" (capital projects & construction, planned maintenance & inspection, field workforce scheduling & dispatch, streetworks & permits, land/wayleaves/consents, vegetation management, contractor management) at the front; check the utility map has the equivalent.

**Navigation of prompts:** ADR numbering in this file does not match the repo's; the repo's `docs/ADR-000-foundations.md` is authoritative. Duplicate prevention is ADR-019 in the repo.

---

## Working rules across all prompts

- Fable for anything that sets a boundary you'll live with (ADR, spec, UI principles, capture design, content). Sonnet for constitution, reviews and bounded design. Claude Code for build, always from the documents.
- Claude Code runs on the desktop with Docker, a local Supabase (`supabase start` + `db reset`) and Playwright installed. A test counts only if it ran against a real local Supabase or in CI; sandbox-only or in-memory runs are reported as "not run", never as passing.
- Definition of done for a sprint: all three suites green locally on the final commit (commands listed in the summary); `pnpm release` run (migrations pushed, Cloudflare deploys on push); the human has used the feature on dev. If it can't be used, it isn't done, whatever the tests say.
- Sprint summaries list every in-scope ADR rule as built / not built with file references, and every deferral with a target sprint added to SPEC §11. Gaps are recorded in docs, never only in code comments.
- One summary per sprint, not per step. Stop mid-sprint only for a decision that changes an ADR or the schema.
- Read paths are scoped by `commit_id` (or `model_id` plus a branch fold), never by enumerated subject ids; `.in()` with more than 50 values is an error; multi-row head-table reads go through `selectAll`. RPCs that signal an outcome return `jsonb` with an explicit status, never a row type.
- Audits only at milestones (before pilot, before capture), not after every sprint.
- Never let a sprint start from a screenshot of a competitor; start from `docs/UI-principles.md`.
- If a sprint's summary contains "for now" or "placeholder", the sprint isn't done.
- Keep this file in the repo at `docs/prompts/` so every sprint is citable by number in a fresh session.
- **Handoff-review checklist** (grows as real mistakes turn up — this is the first entry, added 2026-09-09 after `--color-accent-700` turned up invented in *two* handoffs, HANDOFF-U4-element-page.md then HANDOFF-M1b-comments.md, before either was caught in review):
  - **Every design token named must exist in `src/ui/styles/tokens.css`, spelled exactly.** Grep it before writing it into a handoff, not after — a token that reads as plausible (`--color-accent-700` looks exactly like a real one) is invented, not verified, until it's actually found in the file.
- Current order (also in `docs/NEXT.md`, if that file exists — it doesn't yet in this repository as of this pack's own commit): U4-1 merged → housekeeping (labels still open) → M1b → U4-2 (repeat until usable) → C2 → K1 → D1 → Q1 → R1, with the plumbing track alongside. See the State section at the top.
