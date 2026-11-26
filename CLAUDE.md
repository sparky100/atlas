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
8. **No unbounded `.in()` filter.** postgrest-js sends `.in(column, values)` as a GET query parameter — a caller-supplied id list that grows with model size (element/subject/source/branch/commit ids, never a small fixed enum like a status or type list) can eventually produce a URL a proxy or server rejects outright, not just a slow query (SPEC §6.7; found the hard way at 2,000-element scale, Sprint C1-H item 1). `src/db/inFilterLimit.ts`'s `assertInFilterSize` enforces the 50-value ceiling at the point of call — call it before any `.in()` whose list can grow with the model. A call site that needs more than 50 queries the commit/model scope alone and filters client-side instead (`src/db/landscape.ts`'s `listLandscapeEdges`/`listSupportsEdgesForSystems` are the reference shape), never a bigger limit or a raised ceiling to make the guard stop complaining.
9. **Security comes first.** When security conflicts with a feature, a deadline or convenience, security wins, and a known security gap stops the work until it is fixed or Simon explicitly accepts it in writing. Concretely:
   - Every `SECURITY DEFINER` function checks its caller inside the function, written fail-closed (`atlas.has_role(...) is not true`, never `if not atlas.has_role(...)`), and has `revoke execute ... from public, anon` unless it is a deliberate signed-out entry point. Trigger-only and helper functions are not callable through the API at all.
   - Every owner-only or role-gated function ships with an integration test that calls it as a signed-in user from a different organisation.
   - No secret is stored in plain text in a table, a migration, a config file or the repo. Secrets live in Supabase Vault or function secrets, and the UI shows only whether one is set.
   - **No change may introduce a Supabase advisor finding.** Run the Supabase security and performance advisors (`get_advisors`) before and after every migration, and again before release. The set of findings afterwards must be the same as or smaller than before: a new ERROR, WARN or INFO (for example a function callable by `anon`, a table without a policy, a mutable `search_path`, a `SECURITY DEFINER` view) blocks the change until it is fixed, never waived or left for later. Report the before and after counts in the sprint summary. New functions therefore set `search_path`, revoke `anon` and `public` execute, and new tables enable RLS with a policy in the same migration.
   - A feature that changes who can see or change data (RLS, grants, edge function auth, API keys, SSO) says so plainly in its PR, with the test that proves the boundary.

## Model rules

The short list of what the model holds and how people and AI work with it. Read it before any change to elements, change drafting, decisions, projects, AI or data sharing. Each rule has an id so a walkthrough or PR can say "touches M2, I1". The reasoning is in `docs/ADR-000-foundations.md` (and its amendments), `docs/VOCABULARY.md` and `docs/ADR-024-projects.md`. Where this list and an ADR disagree, raise it; don't pick one.

**What the model holds**

- **M1. Five element types only: Capability, System, Module, Actor, Value stream.** Goals, projects, decisions, changes and principles are records beside the model. There are no Services, data, process, technology-layer or document elements.
- **M2. A module is an element in its own right.** It sits inside one platform and can be supported, owned, retired, replaced, rated and linked like a system. Wherever code or AI looks for "a system", it looks at systems and modules, or a `// system-only: <reason>` comment says why only systems apply.
- **M3. A platform's modules support capabilities, not the platform itself.** A platform that supports a capability directly is a finding to fix.
- **M4. Every system and module supports a capability.** Where it doesn't yet, that is a visible gap, never hidden. Add-a-system asks first. It is a gap, not a hard block (Simon, 2026-11-26).
- **M5. A project names at least one capability.** Same: a visible gap with a prompt, not a hard block.
- **M6. Six relationship types, only between the types the rules table allows.** Ownership is an `owns` link with a role, never a field. Containment is the parent link. "External" is a setting, not a type.
- **M7. Cost is a band, never a figure. No maturity scores, no stored documents.**

**Identity and history**

- **I1. Search before you create.** Every place that can create an element first searches names, aliases and modules and offers what exists (ADR-019).
- **I2. Duplicates are merged reversibly, never deleted.**
- **H1–H4** are build rules 4, 5, 2–3 and 6 above: facts through deltas with a source, nothing deleted, diagrams are queries, no randomness in anything stored.

**People and decisions**

- **P1. Four roles: Viewer, Contributor, Architect, Owner.** A contributor can propose; they can't approve.
- **P2. Nobody accepts their own proposal unless they are the only owner or architect, and that is recorded with names and dates.**
- **P3. People approve decisions and live-model changes. Drafts stay editable.**
- **P4. States are truthful.** Suggested, saved, reviewed, chosen, approved and implemented are different things.
- **P5. Estate checks narrow options and show uncertainty. They never remove one.** Staying as we are is always an option.
- **P6. One step's output is the next step's input.** No copying or retyping between steps.

**AI and data**

- **A1. Anything an AI drafted is marked ("Drafted by the Designer, edited by <name>") for as long as it stands.**
- **A2. Cost is withheld from Ask Atlas, agents, the API and MCP unless an owner shares it.** New AI or API paths build their context through `createToolContext` (`src/tools/runCostExclusion.ts`).
- **A3. Secrets live in Vault or function secrets.** The UI only says whether one is set.
- **A4. Users never coordinate agents.**

**Security and words**

- **S1.** Build rule 9, in short: every new `SECURITY DEFINER` function checks the caller fail-closed, sets `search_path`, revokes `public` and `anon`, and has a cross-organisation test; new tables enable RLS with a policy in the same migration; no new advisor finding.
- **W1. Plain words from `docs/VOCABULARY.md`.** "Live model", not "main". No ArchiMate or TOGAF terms.

**Where these are checked.** The walkthrough names the rules the change touches (UX rule 3). The PR description says how each is respected and what proves it (`.github/pull_request_template.md`). A rule that only a reader can see will be missed, so where one can be a test, a lint rule or a database check, it should become one.

## Vision and UX expectations

Atlas is for business users as well as architects. Every feature must help a person complete an understandable task inside the existing journey. "Built but not reachable by a user" means it does not exist. This section is binding on every contributor, human or AI, including coding agents.

**The vision in short.** Atlas is a clear path from a business need to a decision people can explain. Capability is the organising unit, and outcome is the measure of value. The route is: need, estate check, a small set of options (staying as we are is always one), challenge, then a versioned proposal that people approve. Estate checks narrow options and show uncertainty; they never eliminate one automatically. People approve decisions and live-model changes, not every step, and drafts stay editable throughout. AI agents support the task and must be clearly marked (for example "Drafted by the Designer, edited by a person"); the user never coordinates agents. When data is shared with AI, an API or MCP, start from what must not be shared (cost first).

**Where it is written down.** The full vision and the delivery plan are kept outside this public repository (the vision stays private until Simon says otherwise). Ask Simon for them before work on a new phase. Keep the plan updated after each PR, and keep the vision current whenever a decision changes direction. A change that does not fit the vision is raised, not merged.

**The 12 UX and delivery rules (Simon, 2026-11-19).**

1. Define the user task before implementing: who, where they start, what they want, what success is, with a realistic example.
2. Inspect the existing journey: entry points, screens, permissions, actions, what comes before and after. Reuse existing patterns.
3. Describe the complete interaction before coding: what the user sees, does, what changes, where they go next. Make routine design choices without asking. The walkthrough ends with **Rules this change touches**: the Model rule ids (for example M2, I1), and for each one sentence on how the change respects it. If it touches none, say "none" and why. If it needs to break one, stop and ask.
4. Make every handoff work. One step's output must be usable by the next. "Draft options" must produce options the user can edit and compare, with no copying or reconstruction.
5. Keep the business question visible. Lead with need, outcome, options, evidence and decision, in plain task labels.
6. Maintain continuity: preserve work, explain what is saved, show progress, allow cancellation, make recovery easy.
7. Make states and permissions truthful. Distinguish suggested, saved, reviewed, chosen, approved and implemented, and say who can take a restricted action. Never imply completion because one component or one reviewer finished.
8. Keep complexity proportionate. Add a page, status, setting or concept only for a demonstrated problem. AI supports the task without the user coordinating agents.
9. Verify the whole journey before reporting completion: start from Home, use realistic data and the right permissions, check desktop and mobile, and include empty, unavailable, failed and interrupted states.
10. Separate functional evidence from usability evidence. Automated tests do not show discoverability or comprehension, and mocked AI tests do not show real AI quality.
11. Report completion against the task: what the user can now complete, what was tested, what is manual or missing. Say implemented, merged, deployed and accepted separately. Update the plan and user guide.
12. Treat repeated UX corrections as a signal to review the whole journey before adding another local fix.

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

## Verification (all local)

GitHub Actions runs exactly one workflow, `.github/workflows/deploy-migrations.yml`: on every push to `main`, it pushes `supabase/migrations` to the live project and does nothing else. There is no test CI — "CI green" is not a real signal, because CI does not run tests. Every check that used to run there now runs on the machine making the change, before every push, and its result is reported in the sprint summary alongside the exact command used:

- `pnpm lint` / `pnpm typecheck`
- `pnpm test` — unit and property tests
- `pnpm db:start`, then `pnpm test:integration` — real Supabase, real RLS, no shortcuts
- `pnpm build`, then `pnpm exec playwright test` — the full Playwright suite, the required perf tests included
- `pnpm check:case-collisions` — case-only path collisions; a local pre-push script (`scripts/checkCaseCollisions.ts`), not a workflow — there is no git hook enforcing it, so run it and say so

**Tests also run in GitHub Actions** (`.github/workflows/tests.yml`, on every pull request and on demand; added 2026-11-17 because a contributor's machine can't always run local Supabase in Docker). The workflow needs no secrets and runs the same commands as above on a clean Linux runner. A green run of it counts as the "run locally" evidence for the integration and Playwright suites; say so in the sprint summary and link the run. Two specs are excluded from that run and must still pass locally: the capture spec that needs a live language model, and the 300 ms `route-timing-acceptance` budget spec (Simon, 2026-11-17).

**Coverage** (docs/prompts/atlas-prompt-pack.md §2, added by Sprint S2): a flow is covered only by a click-only golden-path spec from Home at 1280 and 390 (`e2e/golden-path-*.spec.ts`). Deep-linking specs are named `*.engine.spec.ts` and do not count as user coverage — they exercise the engine/UI at a specific state reached by URL, not the click path a real user would take to get there.

## Definition of done for a sprint

A sprint is not done until all of the following are true, not merely attempted:

- **All three suites green, locally, on the final commit.** Unit, property (the RT-/P- suites named in `SPEC-data-model.md` §10 for anything they cover), integration, and Playwright tests all pass — run locally per "Verification" above, not "green last time" or green on an earlier commit. A skipped or `.only`'d test is not green. The sprint summary states which commands were run and that they passed.
- **Migration applied to a fresh project from zero.** `pnpm db:reset` — `supabase/migrations` replayed against an empty database — produces the schema this sprint's code expects, with no manual steps. If a migration only works against an already-running project, it's broken.
- **Released, not just verified.** Verifying locally and releasing to the live project are two different steps — passing the suites above doesn't put anything on `main`. `pnpm release` (`supabase db push`) is the manual way to push a migration to the live "Architecture" project (`README.md` "Environments"); `.github/workflows/deploy-migrations.yml` does the same automatically on every push to `main`, as a backstop, not a replacement for running it yourself when a sprint's migration needs to be live sooner. The app itself deploys separately and automatically — Cloudflare Workers Builds, triggered by the push, not by anything in this repository — so nothing here needs to trigger that half.
- **Playwright smoke passes, from the first UI sprint onward.** The core user path the sprint touched is exercised end-to-end, not just unit-tested. Not applicable to a sprint that ships no UI at all — a backend-only sprint has nothing a browser could smoke-test, and a Playwright test against an API-only backend would itself be the kind of demo shortcut rule 7 rules out. `docs/SPRINT-F1-STATUS.md` raised this as a genuinely open question after Sprint F1 (option (a): treat the bullet as not-yet-applicable until a UI sprint exists, and revisit it then; or (b): require some backend-appropriate substitute instead). Closed here, as option (a): the bullet is suspended, not replaced, for a sprint with no UI, and applies in full to every sprint from the first one that ships UI onward (Sprint U1 and every sprint since).
- **Docs updated.** If the sprint changed the data model, the delta format, merge behaviour, or an ADR-level decision, `docs/` reflects it before the sprint is called done — not as a follow-up ticket.
- **No known data-loss path.** Nobody on the team can name a sequence of actions that loses a fact, a comment, a decision, or history, without it either being fixed or explicitly written down as an accepted, reviewed risk.

If any of these is false, the sprint is not done — say so plainly rather than reporting partial progress as complete.

## How to work with the human

- **Stop at the end of each numbered step and summarise.** When a task is broken into numbered steps (in a prompt, a plan, or an issue), complete one step, then stop and give a short summary of what changed and what's next, before continuing. Don't chain multiple steps into one silent pass.
- **Ask when a decision isn't covered by the ADR or the spec.** `docs/ADR-000-foundations.md` and `docs/SPEC-data-model.md` are the design authority, and both explicitly name what they left open or deferred. When an implementation choice genuinely isn't answered by either — not "the answer takes a moment to find," but "the documents are silent or point two ways" — ask, using a concrete recommendation and the trade-off, rather than picking silently and moving on. Inventing an unrecorded decision and shipping it is the failure mode this whole document exists to prevent: an undocumented choice is exactly the kind of untracked fact this product is built to eliminate everywhere else.
- **When you do make a small, clearly-scoped judgment call** (naming, file layout, which existing pattern to follow), make it and say what you chose and why — don't ask about things a reasonable default already answers.
