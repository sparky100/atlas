# Atlas delivery plan: product, performance and UX

11 November 2026 · Source: [10 November assessment](AUDIT-2026-11-10-product-performance-ux.md)

**Status:** Working delivery plan. The assessment remains the evidence record. This plan orders implementation and states what is active, on hold, and deferred until a safer design is ready. Each work package should be a small reviewable PR; passing local checks is required before a PR is described as mergeable. No dates or measured speed improvements are promised before fresh end-to-end baselines.

**Delivery status as of 11 November 2026.** Three UX fixes have merged into `origin/main`. The notification wording has been confirmed in the live UI. Actionable reporting, portfolio calculation and the initial download improvements are in draft PRs. Full app and database checks on those drafts are pending.

**Next release in review.** Actionable reporting combines the direct record links in UX-04 with the relationship and finding report runners in REP-01. A user can run a report on critical applications without owners or on capability support, then open the affected records. The owner review cycle remains planned behind its design gate.

## Scope decisions

| Area | Decision | Boundary |
|---|---|---|
| Performance | **In: all findings in the assessment** | Low-risk changes first. History/checkpoint, cache authorization, and data-query changes get a separate design and regression plan before implementation. |
| UX/UI | **In: all assessment recommendations** | Ordered below. Major navigation redesign and state semantics follow task testing and a design decision. |
| Owner maintenance | **In** | Complete the loop around existing “Still accurate”, gaps, review assignments and assignment emails. |
| Decision-relevant reporting | **In** | Finish relationship/finding runners, links, dated comparisons and action-oriented presentation. |
| Outcome follow-through | **In** | Expected outcome, accountable owner, evidence and review date on decisions/projects; review outcome after delivery. |
| Application/delivery connectors | **On hold** | Revisit with a named customer system and a supported mapping/provenance contract. |
| Broader enterprise adoption | **On hold** | Validate SSO, account lifecycle and release/recovery needs with buyers. Existing security and recovery defects are not excused by this hold. |
| Selective interoperability | **On hold** | Revisit for a migration/exchange need with explicitly unsupported concepts. |
| Data architecture, infrastructure architecture, full strategy/KPI and financial planning models | **Outside product scope** | Do not turn these into modelling gaps. |

This ordering is a recommendation, not a claim that later work is unimportant. The high-risk work below remains planned and is to be taken up after the first safe PR, with its own design and verification stage.

## Immediate sequence: small PRs

| Order | Package | Status | Concrete work | Done when |
|---|---|---|---|---|
| 1 | **UX-01: readable, truthful basics** | **Merged** [#419](https://github.com/sparky100/atlas/pull/419). Notification wording confirmed live. | Raise contrast of informative secondary text in both themes; correct notification empty-state wording so review assignments are not implied to be absent. Check 200% zoom, 390/1280 layouts and focus. | Ordinary text meets 4.5:1 against its actual surface; existing notifications remain visible; local checks and affected golden paths pass. |
| 2 | **UX-02: honest asynchronous states** | **Merged** [#420](https://github.com/sparky100/atlas/pull/420). Full browser checks pending. | Make dashboard/report loading, empty, partial and failed states distinct; retry failed parts; prevent incomplete export from looking complete. | Slow or failed requests never show a false “empty” result or complete export. |
| 3 | **UX-03: evidence access** | **Merged** [#421](https://github.com/sparky100/atlas/pull/421). Chrome component checks passed at 1280 and 390. Full app checks pending. | Make the provenance control explicit for touch and keyboard, with Escape dismissal, placement, retry and a separate history-unavailable state. Reset its cached chain when the fact changes. | A user can open, read and dismiss evidence with keyboard/touch, and can distinguish missing history from failed retrieval. |
| 4 | **UX-04: reports lead to records** | **Draft PR** [#422](https://github.com/sparky100/atlas/pull/422). Chrome component checks passed. Full app verification pending. | Preserve stable row IDs separately from display cells; link report rows to the correct accessible record and state. Add owner/action links where the source supports them. | Every actionable result opens its underlying application, relationship or finding; links respect access and snapshot meaning. |
| 5 | **UX-05: first useful task** | **Planned** | Add explicit “Add application” and “Import inventory” entry points that retain the search-first duplicate check. Guide capability → application → assessment. | A first-time user completes the journey from Home at 1280 and 390 without being told to create via search. |
| 6 | **UX-06: business language and briefing** | **Planned**. State labels have a design gate (H6). | Replace generic report/chart labels with subject, conclusion, denominator, unknowns, as-of date and next action. Make source, verification date and owner legible together. Present existing dashboards as evidence-led briefings while retaining dense architect tools. | Occasional readers answer what matters, who owns it and what happens next; no invented savings or certainty claims. |
| 7 | **UX-07: dashboard composition** | **Planned** | Offer compatible chart choices and inline grouping/preview using the saved-report definition. | A user builds a chart without leaving the dashboard; saved definition and preview agree. |
| 8 | **UX-08: task-tested navigation** | **Design pending** (H6). | Test labels and journeys with architects and occasional owners. Reduce the 15-destination default rail only after task evidence; retain discoverability of advanced destinations. Clarify project, decision and proposed change. | Task completion improves at 1280/390 without losing a current workflow. |

The UX work above covers the assessment’s specific issues. Additional visual review is required on rendered screens for whitespace, alignment, diagram readability and responsive clipping; source inspection did not establish those outcomes. Validate representative tasks: understand capability exposure, add/link an application, verify a fact, compare options, approve a proposal and follow a dashboard finding to its owner. Record time, mistakes and assistance separately for architects and occasional users.

## Performance sequence

**Baseline status.** The assessment recorded bundle size and synthetic engine measurements. Browser and database baselines remain pending.

First record fresh browser and database baselines on a representative laptop/network: 200, 2,000 and 10,000 systems; short, 5,000 and 20,000-commit histories; sparse/dense relationships; cold/warm navigation; and concurrent use. Capture first useful content, save-to-confirmed-display, request counts/bytes, query time, JS parse, long tasks, p95 input delay, memory and diagram frame times. Keep synthetic engine times separate. September timings are warnings to rerun, not current results. Put reproducible budgets into the existing local verification process; any change to deployment/CI policy needs its own recorded decision.

| Order | Package | Status | Change and verification |
|---|---|---|---|
| P-01 | Initial download | **Draft PR** [#424](https://github.com/sparky100/atlas/pull/424). Gzipped startup JavaScript fell from 602.7 kB to 217.5 kB. Representative page timings pending. | Split eager routes and load XLSX export on demand; measure main bundle, route chunks, first useful content and navigation, with targeted prefetch. |
| P-02 | Portfolio computation | **Draft PR** [#423](https://github.com/sparky100/atlas/pull/423). The 10,000-system fixture went from 49.6 s to 186 ms for row calculation. End-to-end timings pending. | Index edges by source/target/owner once; compute supporter groups once; defer expanded alternative lists. Compare result/hash semantics with the old implementation and benchmark 200/2,000/10,000 systems. Consider a worker only after reducing computation. |
| P-03 | Large result presentation | **Planned** | Paginate or window browse, mobile cards and report rows accessibly; defer expensive filter/sort; keep full exports complete and separate. Check keyboard/screen-reader context. |
| P-04 | Complete bounded reads | **Planned**. Broader query changes have a design gate (H2). | Stop `selectAll` at the known count; evaluate keyset pagination/aggregation and query plans for large datasets. Preserve completeness and the 50-ID safety limit. |
| P-05 | AI first-answer latency | **Planned** | Replace whole-model tool-context reads with bounded authorised, commit-stamped queries for common tasks; measure provider and tool time separately and verify answer coverage. |
| P-06 | Diagram input smoothness | **Planned** | Profile pointer updates, hit testing and visible-edge work on a real browser; coalesce to animation frames where justified. Preserve worker layout/culling. Align the actual low-tail gate with the intended 45 fps target after measurement. |
| P-07 | Save feedback | **Planned** | Use existing result-cache seeding to show a confirmed save promptly; show pending/conflict states honestly and roll back on failure. Measure save-to-confirmed-display. |
| P-08 | Shared read/cache work | **Design pending** (H2). | Deduplicate repeated model reads and cold base/head history loads with authorized keys and invalidation. This is gated by the access design below. |
| P-09 | Deep-history reliability and save cost | **Design pending** (H1). | Replace recursive replay; then design verified immutable-head reuse/checkpoints so ordinary saves do not fetch/replay all history. This is gated by the history design below. |

## Product sequence

1. **OWN-01: owner work list and review cycle.** **Design pending** (H3). Reuse “Still accurate”, the 12-month stale rule, gap types, owner/member bridge, assignment notifications/email and My work. Define an explicit due date and accountable reviewer for owner review, a single inbox across owned items, completed/overdue tracking and a durable completion record. Make unowned items visible to architects. Start from the previously approved F15 in-app weekly digest design; add reminders without duplicate sends, a preference and one-click links. Opening a reminder must not attest facts. Do not claim review email or gap progress is a complete owner cycle. Advanced campaigns, escalations and per-item schedule configuration await observed need.
2. **REP-01: finish existing report sources.** **Draft PR** [#422](https://github.com/sparky100/atlas/pull/422). Reports can create four starter reports over relationships and current-model element findings. Live rows link to their records. The retirement-change check remains in the health workflow because it depends on open changes. Focused tests passed. Full app and database verification pending.
3. **REP-02: current-state and frozen comparison.** **Design pending** (H4). Compare stable row identities, added/removed/changed/unknown and coverage. Stored snapshots remain immutable; refuse incompatible definitions and state clearly when data is current, frozen or unavailable. Scenario comparison follows the branch-access decision below; ADR-027 currently limits snapshots to main.
4. **OUT-01: outcome follow-through.** **Design pending** (H5). Attach an expected outcome, owner, evidence link and review date to decisions/projects. Reuse existing ownership and evidence conventions; record each review’s actual result, reviewer, date and supporting evidence, with rescheduling history. Permit a post-closure review without silently reopening a closed project or rewriting an accepted decision. Surface due reviews in My work and link them from the record/briefing. No full KPI model or made-up quantified savings.

## Important work requiring a design stage before code

**Status: design pending for H1–H7.** These packages remain in the plan. Each design stage produces a short ADR/plan amendment, a failure-mode test list and a small first PR. Resume in the order shown, unless the baseline reveals a more urgent production incident.

| Priority | Item | Why high risk | Gate before implementation |
|---|---|---|---|
| H1 | Iterative replay and incremental save/checkpoints (P-09) | Merge order, restores, retracted facts and canonical hashes could change or history could be lost. | Read ADR-000 and SPEC §6; prove identical heads/hashes for long linear/merge/restore histories and server concurrency; checkpoint includes history needed by restore. |
| H2 | Shared authorised cache and query changes (P-04/P-08) | A stale or overbroad cache can leak one user's model or show an obsolete result; pagination can omit rows. | Key by user/org/model/commit/dataset, clear on logout/share change, test RLS/revocation and complete paging; EXPLAIN before indexes. |
| H3 | Owner review persistence and reminders (OWN-01) | Due dates, recipients and scheduled delivery affect access and can generate false trust/completion. | Decide authoritative review record and due-date semantics; migration + contract + round-trip test; idempotent scheduler, scoped RLS, revoked-access tests. |
| H4 | Snapshot/scenario reporting (REP-02) | Mixing a selected proposal with main or a frozen snapshot can present the wrong architecture and leak branch facts. | Amend ADR-027 for selected-state and access semantics, preserve immutable snapshots and commit/evaluation-time stamps; historical-access tests. |
| H5 | Outcome reviews after closure (OUT-01) | Current decision/project write guards intentionally freeze approved/closed records. | Decide append-only review versus mutable schedule/history; document permissions and migration/contract/round-trip tests; prove prior decisions/projects remain intact. |
| H6 | Major navigation/state vocabulary changes (UX-08 and part of UX-06) | A global relabel can hide technical distinctions and strand experienced users. | Task-test two audiences, define current/proposed/frozen labels with exact state/date, inventory every entry point and golden path. |
| H7 | Save Ask Atlas answer as shared briefing | Citations, private answers, model access and retention need a policy; the current product discards chats by default. | Decide explicit opt-in, sharing/retention, citation freeze and revocation behavior; then implement as a separate PR. |

UX confidence language belongs in UX-06: distinguish a human assertion, owner confirmation, template seed and extraction confidence. Never present a manually entered fact as “100% true”. Any change to stored confidence or provenance is high risk and requires the data-model design authorities first.

## PR and release gates

Use a `codex/` branch per work package. Every PR states the specific before/after behavior, acceptance evidence, relevant local commands and any remaining limit. UI changes need click-only Home golden paths at 1280 and 390; schema changes need migration, contract and round-trip/integration test together. Follow the repository's local lint, typecheck, unit/property, integration, build, Playwright and case-collision checks before claiming a PR ready to merge. Keep the assessment and this plan updated when measurements change the order.

## P-04 database benchmark

**Draft implementation.** [PR #426](https://github.com/sparky100/atlas/pull/426) stops paging at the first exact count. A unit test confirms that 2,000 rows take two requests instead of three. Each requested page still asks for an exact count. Database plans and timings are pending because the local Docker engine is unavailable.

1. Start local Supabase with `pnpm db:start`. Use the authenticated fixture setup in `e2e/landscape-perf.engine.spec.ts` and its existing 2,000-system fixture as the first baseline. Repeat at 200 and 10,000 systems with sparse and dense relationships. Include multiple materialised commits so the database contains rows outside the selected commit. Run reads as an authenticated model member so row-level access policies apply.
2. Begin with `listAllLandscapeEdgeRows` in `src/db/landscape.ts`. It filters by commit and relationship type and orders by relationship ID. Compare the first, middle and last offset pages against pages selected after the last relationship ID, preserving the same filters and columns. The existing `(commit_id, relationship_id)` primary key supports this order. Record `EXPLAIN (ANALYZE, BUFFERS)` for the page and exact-count work, plus request count, transferred bytes and median/p95 elapsed time for the complete authenticated read. Check the plans before proposing any index.
3. Compare ordered IDs and payloads against the baseline for empty results, exactly one page, an exact multiple, and a partial last page. Include distinct models and commits, shared-model access, and access revoked during paging. Preserve the 50-ID ceiling. If repeated exact counts dominate, measure a first-page count followed by cursor pages as a separate candidate. Keep completeness checks and verify that access changes cannot produce a successful partial result.
4. Measure `listAllElements` in `src/db/elementBrowse.ts` separately. Its order uses type, name and ID, so a cursor must preserve that full order. Measure aggregation on the landscape's count-only reads separately from full-list consumers such as Elements and exports. Keep query and index changes on hold until the measurements and correctness checks support a specific change.
