# Atlas — prompt pack v2 (12 September 2026)

Supersedes `docs/prompts/atlas-prompt-pack.md` (v1). v1 stays in the repo as history only; nothing in it is scheduled. This file is committed at `docs/prompts/atlas-prompt-pack.md` and is the single source for what is next. Facts here come from `docs/AUDIT-2026-09-12.md`.

---

## 1. State

**Works on main (engine-path evidence, not golden-path):** orgs, models, archive/delete, members, invites, roles; capability map (seed, tailor, reorder mode, colour-by, export, mobile accordion); landscape (lanes, bands, zoom, auto-layout, mobile list); context as a C4-style diagram, container as a DOM list (component removed from the taxonomy entirely — ADR-001, S1 item 18); element page with provenance; search-first create; rename; retire with replacement; remove from model; relationships create/edit/remove with roles and verb; changes create/enter/leave/submit/review/approve/merge/split/refresh; C19 fast-forward fold rule (ADR-021 §2.1); reviewer read-only view of a change; "Submit for review" on the banner; sixteen golden-path specs at 1280 and 390; versions tag/diff; comments backend and UI (markers, panel, tray, counts, incl. the mobile landscape list and the capability-scoped list); front doors; browse; health findings incl. Assurance; 7k attributes (criticality, hosting, owner roles, IT/OT, integration platforms with `via`, regulatory fields, platforms and modules); eight starter maps published, incl. the electricity map's "Network Delivery & Maintenance" domain; C2b structural-conflict resolution (deferred Playwright coverage still open — register, issue #76); custom attributes; decisions (D1); F2-lite capture/import (deterministic spreadsheet/CSV/JSON reconciliation) **and F2 full K1** (LLM-driven capture — spreadsheet/CSV, PDF, pasted text; three-level matching; capture-draft branch; re-import lineage; per-class review queue with keyboard shortcuts; capture-specific aliases; the ten-fixture scoring harness — `docs/SPEC-capture.md`, PR1–PR16), shipped alongside F2-lite rather than replacing it — F2-lite's own upload dialog is untouched, and retiring it is a follow-on decision, not part of PR1–16; roadmap (F5 — lifecycle bars, add/retire/replace markers, filters, as-is/to-be, CSV/PNG export; split-branch rollup and version-upgrade markers/tray anchors still deferred — SPEC §11).

**Not built:** duplicates (Q1); value streams (F6).

**Environment:** dev at atlas.simmodlr.app; Supabase project `xakqcssapdiatwrmnjop`. Deploy workflow has failed 59/59 runs at `supabase link` with a token-privilege error; all releases so far were manual. Migrations local = remote as of 12 September (applied by hand).

**Process facts:** the pack in the repo was stale (7m and 7k item 6 never committed); `docs/NEXT.md`, `docs/CHECK-U4-2a.md`, `docs/CHECK-console.md` were referenced but never created; 14 issues exist against 16 register rows; SPEC §11 and the register disagree on two targets; C19 was marked "first" and skipped by four sprints.

**Definition of usable (unchanged):** an architect can sign up, seed or build a capability tree, add twenty systems with owners, lifecycle dates and verb-labelled relationships, see them on the landscape and capability map, make one change through a branch (retire a system, add its replacement) and merge it, tag before and after, and show a director the capability map with exposure colouring, on a phone and a desktop — **by clicking, from Home, with a golden-path spec proving it at both widths.**

---

## 2. Rules

Applied by every session, cloud or desktop. Put into CLAUDE.md by prompt P1.

- **Prerequisites.** A prompt names its prerequisites; the session checks them in the repo before its first commit and stops if one is missing.
- **Language.** UI strings use change, live estate/main, version, edit; never branch, head, commit, tag, delta, fold, ref, RPC, SPEC, sprint. Lint fails the build on these in `src/ui` strings (allow-list for the versions page's technical detail).
- **Errors.** Users see one plain sentence naming what failed; guard and stack detail go to the console.
- **Time.** One helper for all user-facing times (just now / N min / N h / yesterday / date). The staleness bucket appears only on the inline provenance badge.
- **Coverage.** A flow is covered only by a click-only golden-path spec from Home at 1280 and 390. Deep-linking specs are `*.engine.spec.ts` and do not count as user coverage.
- **Verification.** Integration and Playwright run on the desktop against local Supabase. Cloud-session PRs carry `needs-local-verify` and do not merge until a desktop run is recorded in the PR.
- **Done.** A sprint is done when its golden paths pass, `docs/screens/<sprint>/` is committed, `pnpm release` has run (or the workflow succeeded), and the human has used it on dev. Summaries list every item as done / not done with evidence; "done" without evidence is wrong, not optimistic.
- **Signal.** When the human asks how a feature works more than once, reproduce on dev before explaining.
- **Deferrals.** Anything deferred gets a register row here, a SPEC §11 row, and an issue, in the same PR.
- **Data migrations are commits**, never row rewrites; `head_hash` is never left stale.
- **Naming.** Engine sprints E1, E2…; stabilisation sprints from use S1, S2…; feature sprints F1, F2…; process P1. No lettered sub-prompts.
- **This file** is updated in the same PR as the work it describes.

---

## 3. Order from here

1. **P1** — process: CLAUDE.md rules, deploy pipeline fixed, screen record, walkthrough intake, pack committed. Half a day.
2. **E1** — C19. Desktop. Before any other engine or UI change.
3. **S1** — stabilisation from the 11–12 September walkthrough and the audit's gaps. UI only.
3a. **V1** — the context diagram (platform modules inside the tile, actors as people, verb edges, boundary). Desktop and mobile.
4. **S2** — golden paths: write the eight click-only specs (flow 2 covers V1), fix what they expose, ship nothing else.
5. **Human walkthrough**, findings filed via the intake → **S3**.
6. Repeat 4–5 until the definition of usable holds by golden path.
**Gate before any feature sprint:** S2's eight golden paths green at 1280 and 390; E8's targets met (route < 300 ms, action < 500 ms on the DNO model); the context view built as a diagram (platform modules inside the tile); E1 merged; the deploy workflow has one green run or has been removed with `pnpm release` documented as the only path; one post-S2 walkthrough filed through the intake with its S3 (if any) closed.

7. Then features, in order: **F0 + F3 as one sprint — decisions and options** (intent, decisions, explore changes as high-level options, the comparison view; the product's centre: which capabilities are changing or weak → options → a documented decision → a change) → **F3a** multiple reviewers and sign-up shape → **F7** accounts and access → **F1** custom attributes → **F8** export → **E2** C2b → **E7** merge_elements → **F2** capture (K1) *(done — PR1–PR16)* → **F4** duplicates report → **F5** roadmap → **F6** value streams. E2 and E7 must precede F2: capture review is where structural conflicts and merge-into-X become daily events.
8. Plumbing alongside, desktop only, never the same files as the active S/F sprint, each with its own prompt below: **E3** delta-apply in SQL and **E4** LLM proxy edge function (both before F2); **E5** typed Supabase client (any time after S2); **E6** landscape p5 fps profile (after S2); **E8** performance (after S2, before features).

---

## 4. Prompts



### P1 — process (first)

```
P1. No feature work. One PR.
1. CLAUDE.md: replace the verification, definition-of-done and working-with-the-human sections with the Rules in docs/prompts/atlas-prompt-pack.md §2, verbatim.
2. Deploy pipeline: the workflow fails at `supabase link` with "does not have the necessary privileges". Diagnose: confirm SUPABASE_ACCESS_TOKEN was generated by an account that is a member (owner/admin) of the org owning project xakqcssapdiatwrmnjop; if not, the human regenerates it from the right account and replaces the secret. Then run the workflow by hand and paste the first successful run URL into README. If it still fails, the workflow is removed and README documents `pnpm release` as the only path, so the repo stops claiming a pipeline it doesn't have.
3. Screen record: scripts/screens.ts — sign in, seed the standard demo model (DNO, electricity_network v2, 20 systems, one open change with a conflict, two comments), screenshot every route and state (empty, populated, in-change, viewing-change, review, error) at 1280 and 390, light and dark, into docs/screens/<sprint>/. Run it now for "baseline".
4. Walkthrough intake: issue template "finding" (route, device, expected, happened, screenshot; labels bug/design/missing); `pnpm s-sprint` collects open findings since the last S tag, groups by screen, writes docs/prompts/S<n>.md.
5. Register reconciliation: for every §7 register row create the missing issue and SPEC §11 row; align the two target mismatches (drag reorder → S-track; tray deep links → F3/F5); add SPEC §11's untracked rows to the register. docs/NEXT.md = §3 of this file. Delete dangling references to docs/CHECK-U4-2a.md and docs/CHECK-console.md or create the files from docs/AUDIT-2026-09-12.md.
6. Commit this file as docs/prompts/atlas-prompt-pack.md; move v1 to docs/prompts/archive/.
```

### E1 — C19 fast-forward fold rule (ADR-021 §2.1)

Prerequisite: none. Desktop only. Do this before S1 merges.

```
E1. Read docs/ADR-021-structural-conflict-resolution.md §1.2, §2.1, §5 item 1, §6 (C19), §7 (P-30, P-2 extension), §8; src/engine/head.ts (foldFromGenesis); src/engine/head.property.test.ts; src/contracts/delta.ts (COMMIT_INVARIANTS).
1. foldFromGenesis: if node.parent_commit_id is in the ancestry of node.merged_branch_head_commit_id, head = foldFromGenesis(merged_branch_head_commit_id) then the commit's own deltas; else the existing replay. Ancestry via the topo walk exclusive() already performs.
2. COMMIT_INVARIANTS gains C19 in the ADR's wording.
3. Tests: graph generator produces main-merge commits (mergeBase == main.head, merged whole); P-30: headHash(fold(mainMergeCommit)) == headHash(fold(branch.head)) for every generated case, and refresh commits with no structural findings fold bit-for-bit as before; P-2 asserts head == fold for both merge shapes.
4. After deploy, run rebuildHead and the head==fold comparison for every model on dev; report per model.
5. SPEC §6.2, §6.6 updated; ADR-021 §2.1 status Accepted; ADR-000 index line.
Three suites locally; pnpm release; summary states any dev mismatch.
```

### S1 — stabilisation from the 11–12 September walkthrough

Prerequisites: P1 merged. UI only; engine frozen. One PR per numbered group; three suites on each; `pnpm release`; screen record diffed in the summary; every item filed as an issue first.

```
S1.
Change flow
1. Banner while in a change: change name, To-be / Diff shortcuts, "Back to main" (leave; Draft kept; ref → main) and "Submit for review" (finish; Proposed; ref → main). Never one button for both.
2. Reviewer view: review request and change pages get "View this change": Landscape (To-be/Diff), Capability map (To-be/Diff), each affected element at the change's ref, opening a read-only viewing ref with banner "Viewing change: <name> (read-only)", edit controls hidden, navigation keeps it, "Back to main" exits. Distinct from "Work in this change".
3. Review request page: requester by display name; deltas grouped by subject with both ends named; counts of things, not facts; comment count only when non-zero; content before actions; split as the reviewer's partial-accept mode, showing closure (pulled in / blocked), not four flat checkboxes.
4. Cancel a change: proposer or owner/architect, Draft or Proposed; status cancelled; read-only; hidden from My changes and the queue; listed under a collapsed "Cancelled" section with reason; resets the active ref; duplicable into a new draft.
5. Changes page and everywhere: "branch" → "change" (lint rule from P1 enforced).
Home and lists
6. Architect door order: review queue, health findings (boundary crossings and Assurance inside), my changes, recent activity. Recent activity: five items, others' activity preferred, runs on one subject collapsed ("3 edits to Dynamics"), "view all".
7. Zero-count findings collapse to one line ("N checks clear") with expand.
8. Review queue and every other user-facing time use the one time helper.
Element, diff, errors
9. Error banners show one plain sentence; detail to console; editing hooks (useEditingBranch etc.) never run for commit or tag refs.
10. Diff page: attribute labels not keys; tag-to-tag diffs titled by tag names; describeEnvelope truncates values at ~40 chars.
11. `version: text` on system and container, shown by lifecycle in the header, editable, in diffs and history.
11a. Actors: `isExternal` (default false) and `externalOrganisation` (text); subtype gains `organisation`. Landscape and context render external actors outside the enterprise boundary; `owns` from an external actor only with role service; Assurance finding: flows to/from external organisations without data classification. Contract, schema, round-trip tests, ADR-001 amendment.
12. Comments: markers and panel on the mobile landscape list and the capability-scoped list.
Capability map remainders (from the audit)
13. Reorder: order assigned on the fly when missing; "Backfill capability order" owner action in the overflow menu, then removed once run everywhere; L3 reorder controls; explicit shared L1 header height; picker cards alphabetical by title.
14. Content: electricity_network v3 adds level-1 "Network Delivery & Maintenance" at the front (capital projects & construction; planned maintenance & inspection; field workforce scheduling & dispatch; streetworks & permits; land, wayleaves & consents; vegetation management; contractor management); utility v2 gets the equivalent; review doc regenerated; publish after human review.
Taxonomy
18. Remove the component level: ADR-001 amendment; remove the component route, view, create path, breadcrumb step, nav references, ELEMENT_TYPES and RELATIONSHIP_TYPE_RULES entries; migration refuses if component elements exist on dev (retract test ones first via a commit); delete component specs and screen-record states; UI-principles zoom chain becomes capability → system → container.
19. Health finding "systems not linked to a capability": a platform counts as linked if any of its modules supports a capability; a platform with no modules is judged on its own supports. Informational nudge: supports on a platform that has modules — move to the module. Test on SAP with FI/PM.
20. RELATIONSHIP_TYPE_RULES: uses and flows_to allowed container↔container, container↔system, system↔system; actor uses system/container. Health finding: a flow whose endpoint is a platform rather than one of its modules.
Housekeeping from the audit
15. A2 remainder: mainCommitIdHint dedup on all resolveRef call sites; reportError in every model-scoped hook; docs/CHECK-console.md written from a route-by-route console pass.
16. BranchRebasePanel uses the persisted identity-dismiss RPC. Viewer-visibility integration test (before/after shared_for_review) written.
17. Design-system rule reconciled: either Home.tsx/OrgHome.tsx raw lists are replaced, or UI-principles §35 is amended to allow them; not both.
Summary lists each item done / not done with evidence and the human's sentence.
```

### V1 — the context diagram

Prerequisites: S1 merged (component level removed; external actors; container↔system relationship rules). Desktop and 390px. Engine frozen.

```
V1. Replace the context list with a diagram in the C4 system-context style, rendered by the landscape's canvas renderer (reuse layout.ts primitives; no new canvas). Centre: the system as a tile (name, type, one sentence). For a platform, the tile contains its module tiles, each with its capability chip; flows attach to the module when the relationship's endpoint is a container, else to the platform edge with a "which module?" marker (health finding). Around it: actors as person icons with their `uses` verb, neighbouring systems/modules with directional verb-labelled lines from the relationship's description, incoming and outgoing distinguished; the dotted enterprise boundary with external systems and external actors outside. Header keeps Supports (grouped by module for platforms) and Owned by (internal / external). Tone: lifecycle or exposure only. Zoom/fit controls as on the landscape; tap a neighbour to re-centre. Mobile: the same content as a list grouped by direction (uses / used by / flows in / flows out / people), modules as sub-rows, no canvas. Screen record before/after. Playwright (engine-path here; the golden path lands in S2 flow 2): SAP with FI and PM modules and a Salesforce flow to FI renders the flow to the FI tile; an external organisation actor renders outside the boundary.
```

### S2 — golden paths

Prerequisites: S1 merged; E1 merged.

```
S2. Write the golden-path specs first, watch them fail, fix until they pass at 1280 and 390, ship nothing else. Click-only from Home after sign-in; no page.goto after the first; no URL construction; no seeding beyond org and user.
Flows: (1) create a model and seed the electricity map; (2) add a system with description, capability (primary) and a verb-labelled uses relationship; (3) rename, retire with replacement, remove a system; (4) add and remove a relationship, promote a secondary supports; (5) propose a change from an element page, work in it, leave, re-enter, submit; reviewer views To-be, requests changes; proposer re-enters, resubmits; reviewer approves, merges; director sees the result on the capability map; (6) cancel a change; (7) tag before and after, diff by tag names; (8) comment on an element from a change's view, mention a member, see it in the tray, resolve after merge.
Rename every existing deep-linking spec *.engine.spec.ts. CLAUDE.md coverage rule applies from this PR. Screen record diff in the summary.
```

### E8 — performance

Prerequisites: S2; E3 in progress or done. Run before the feature sprints.

```
E8. First measure: timing log per route (resolve → first paint → data complete) and network waterfalls for six routes and three actions (add system, add relationship, save attribute) on the DNO model; numbers committed to docs/perf/2026-09.md. Then: (1) one model-level data layer (react-query or equivalent) caching org, model, branches, head, profiles across routes, invalidated on commit; pages read from it, no per-page resolveRef. (2) Main reads the projection, never folds; branch reads fold once per (branch, head) and cache. (3) After a commit, apply the returned deltas to the cached head and re-render, then revalidate in the background; no full reload. (4) Non-critical panels (comment counts, health findings, recent activity) load after first paint. (5) Realtime resync only on relevant events. Targets asserted in a Playwright timing spec: route change < 300 ms to content, action to updated UI < 500 ms on the DNO model. After numbers committed.
```

### F0 — change intent (the why)

Prerequisites: S2. Decided 12 September. A change carries an `intent`, chosen at creation, that sets what the workspace shows and how heavy the review is:

- **record** — something happened; the record is behind. Delivered date required; light review (one approver, no To-be needed); merge date = delivered date for history and roadmap.
- **propose** — something is planned. Target date; workspace leads with affected capabilities and exposure before/after; To-be is the artefact; full review.
- **correct** — the record was wrong. No date; provenance answers "who says so"; for contributors a one-click approval; architects edit main.
- **explore** — a candidate future, expected to have siblings; decisions (F3) attach here; two explorations on the same capability show side by side, never as a conflict; at most one merges.

```
F0. `branches.intent` (record | propose | correct | explore), set at creation (defaulting from the entry point: element page → correct or propose; director door → propose; "what happened" → record), editable while Draft. Change workspace renders by intent: header line ("Recording: Dynamics went live 3 Sept" / "Proposing: replace ADQM by March" / "Correction" / "Exploring: option B for Customer Contact"); required fields per intent; review weight per intent (correct and record: single approver, no split; propose and explore: full queue). Changes list groups by intent; the roadmap (F5) shows record on the delivered date and propose on the target date; explore never appears on the roadmap. Golden paths: one change of each intent end to end.
```

### F3 — decisions and options (with F0; the product's centre)

A problem or opportunity is a decision, created first: context, owner, needed-by date, linked to the capability and systems involved. Options are explore changes linked to the decision, deliberately coarse (name, a paragraph, capabilities affected, systems added/retired, a few numbers), each a visible To-be. The decision page compares options side by side (capabilities affected, exposure after, systems added/retired, boundary crossings, cost from custom attributes, To-be links). Choosing records choice and reasons; the chosen exploration converts to a propose change; the others are cancelled "not chosen: see decision". "Why is this here" on any element walks back to the decision and its losing options. "Start a decision" is an action on every health-finding row and on a capability tile, pre-filling capability, systems, needed-by and context from the finding; the decision page shows the finding it came from. A decision may cite a Lens map by URL; no shared schema. First golden path of the sprint, the loop in one flow (assess → decide → explore → choose → update): SAP PM within 12 months of support end appears in Assurance; Start a decision; three explorations (upgrade, replace with Maximo, extend support); compare; choose; the chosen one becomes a proposal, is reviewed and merged; the finding clears and the roadmap shows the replacement. Second golden path: from a weak capability on the director door, create a decision, sketch two options, compare, choose, watch the chosen one become a proposal.

Decision node (title, context, options, choice, consequences, date, decided-by, status incl. superseded-by); links to change, element/capability, assumption/evidence (evidence reuses facts; assumptions light node); decision list and page; "why is this here" on the element page; export as ADR markdown; notification tray deep links for decision anchors. Golden path: record a decision on a change, merge, find it from the retired system's page.

### F3a — review with multiple reviewers; sign-up shape

Prerequisites: F0/F3 (intent). Decided 12 September.

```
F3a. Table review_verdicts (merge_request_id, user_id, required boolean, verdict approve|request_changes|abstain|pending, comment, at). Reviewers derived from the affected elements' business and technical owners and the affected capabilities' business owners, plus one architect; the proposer can add or remove; an org setting defines a minimum required set (default: one architect). Merge gate: every required reviewer approved. Any request-changes returns the change to Draft. Queue and change page show n-of-m approvals with each verdict; the tray notifies assigned reviewers. Intent sets the weight: correct and record need one approval from anyone eligible; propose and explore need the derived set. RLS, contract, round-trip tests, ADR-006 amendment.
Sign-up: first sign-in offers "just me" or "my organisation"; sets the org name and whether the invite step is shown; a personal org reads as such in settings. Membership in several orgs already works.
Golden path: a change touching two systems with different owners; both approve; a third reviewer abstains without blocking; merge. A correct-intent change merges on one approval.
```

### F7 — accounts and access

Prerequisites: F3a. A pilot org hits these in its first week.

```
F7. (1) Invite emails via Supabase auth invite or a transactional provider, with org name and inviter; resend and revoke; pending invites listed in org settings. (2) Profile page: display name, handle, avatar, own email, notification preferences (mentions, replies, assigned reviews), sign out everywhere. (3) Magic link and password reset verified on mobile; error copy reviewed. (4) Model sharing across organisations: model_shares (model, shared_with_org, optional tag, viewer-only), RLS per SPEC §9's deferred clauses, "Shared with us" on the org home; the consultant case (one person, several client orgs) documented. (5) Membership audit on the org settings page. SSO recorded as a pilot-feedback item, not built. Golden path: invite a second account, accept from the email on mobile, assign a role, share a model read-only with a second org.
```

### F1 — custom attributes

Prerequisites: S2. Engine change allowed.

```
F1. Core attributes stay code; the long tail becomes data. Table attribute_definitions (org_id, key, label, kind text|number|date|boolean|select|link, options, applies_to element/relationship types, required, description, order). Owner UI under organisation settings: define, reorder, deprecate. Stored in the same JSONB attributes with provenance; rendered after core attributes by the generic attribute row; browse filter/sort; export; capture targets. No colour-by, no findings, no engine rules; validation at commit from the definition. Promotion to core = code change + data-migration commit. Contract, migration, round-trip tests, ADR-001 amendment recording the core/custom split. Golden path: define a select attribute, set it on a system, filter the browse table by it.
```

### F8 — export

Prerequisites: F1 (custom attributes render in the browse table).

```
F8. Export from the browse table (any element type, any filter applied) and from a capability-scoped or landscape view: CSV always; .xlsx with one sheet per element type plus a "Relationships" sheet (from, type, to, verb, role), using the xlsx skill's conventions. Columns = core attributes + custom attributes + a provenance summary (source, age) for the filtered/visible set. Server-side generation (edge function or scheduled job) for anything over ~500 rows, since the 50-id client guard rules out an unbounded client-side fetch. "Export" action on the browse table toolbar and on a capability's "N systems →" list. Golden path: filter browse to systems in one capability, export .xlsx, confirm columns match what was visible.
```

### E2 — C2b structural-conflict resolution (ADR-021)

Prerequisites: E1; S2. Per ADR-021 §5 items 2–6 and §7: `preparation` commit kind; `atlas.refresh_branch`; classifier fixes (supports.role cardinality, converged retracts); `buildStructuralResolutions`; split-delta ordering; card actions; P-29, P-31, P-32, integration and the deferred Playwright. Issue #76.

### E7 — merge_elements and identity matching

Prerequisites: E1. Before F2. `atlas.merge_elements(winner, loser)` as one reversible action per ADR-019: references re-pointed via relationship.update deltas, the loser's name recorded as an alias, the loser tombstoned by element.retract, all in one commit; undo restores exactly. Trigram identity matching (name + context: owner, vendor, description) in the classifier and the capture matcher, thresholds documented. UI: "Merge into…" on the element header menu with a preview of what re-points. Property test: merge then undo is the identity; integration through the RPC; golden path: merge two near-duplicate systems, old name found by search, undo.

### F2 — capture pipeline (K1)

**Done — PR1–PR16 (2026-09-20); audited and gap-fixed (#293, 2026-09-23).** Prerequisites: F1; E2 (C2b); E7 (merge_elements); E3 (delta-apply); E4 (LLM proxy deployed). Decide in design whether the edge function validates with the TypeScript contract (preferred) so `type_schemas` is never built. From `docs/SPEC-capture.md` (Prompt 10, already written): sources; candidate extraction for spreadsheet/CSV, PDF, pasted text; matching (exact id → alias → name+context); capture-draft branch; re-import diff; review queue for candidates (accept / merge into / reject / split) built on the S1 review page; aliases learned from merges; `supports` and technical-owner and `via` as first-class inferred fields; fixture set of ten messy inventories and a scoring script — the pipeline is done when it passes the fixtures. Starter-map upgrade flow (diff a model's tree against a newer map version, propose additions as a capture-draft) rides on this and is **not** part of what PR1–16 built — still open, see the register. Golden path, as actually shipped (`e2e/golden-path-capture-review.spec.ts`): upload a small CSV register, land as a `parsed` draft, open the review queue, accept a `new` candidate by keyboard (`a`), choose a target change (`t`), apply (`⌘/Ctrl+Enter`), and see it promoted with a `⚙` provenance badge — narrower than this line's original "twelve systems... merge... landscape" description, which was F2-lite's own reconciliation flow (`golden-path-import-spreadsheet.spec.ts` already covered that one until F2b retired it).

### F2b — fold F2-lite into K1 capture (in progress, 2026-09-23)

Prerequisites: F2 (K1, done); F6 (ADR-023, done — its own gate outlives this sprint). `docs/SPEC-capture.md`'s own "follow-on decision this build did not make" (its Amended 2026-09-20 note) is now made: retire F2-lite (`src/ui/import/SpreadsheetImportDialog.tsx`, `useSpreadsheetImport.ts`, `matchImportRows.ts`, `buildImportCommit.ts` and the row parsers) rather than run it alongside K1 indefinitely. Every gap F2-lite covered that K1 didn't is folded into `docs/SPEC-capture.md` (§5.2's mixed system/module sheet and owner/capability conventions, §5.2a's Relationships sheet, §5.6's JSON input format, §9.4's always-on "not in file", §10's bulk-accept), decided with the human where it genuinely conflicted with a standing ADR: **value-stream import is dropped, not carried over** (ADR-023 already forbids capture from proposing a value stream or stage; F2-lite's own JSON `value_streams` section is retired along with the rest of it, amended into ADR-023 directly), and a JSON entry with no stated confidence is capped at 0.90 like prose, not defaulted to 1.0 as F2-lite did (K-5/ADR-007: 1.0 is a human assertion, not an upload). Step 1 (this entry, docs-only) is done; Steps 2–7 (contract/migration, parsing/matching, retire-restore + edge transfer, review-queue bulk-accept, F2-lite's own removal, tests/fixtures/docs) follow one PR at a time — see the session plan for the exact breakdown.

### F4 — duplicates report (Q1)

Prerequisites: E7. Nightly candidate job (name/alias similarity, shared owner, overlapping relationships); count on the architect door; list with merge (E7) / not-a-duplicate remembered. Golden path: two near-duplicate systems, merge from the report, old name found by search.

### F5 — roadmap (R1)

Rows by capability or system; time horizontal; lifecycle bars from `introduced`/`plannedEnd`/`supportEndsAt`; markers for changes that add or retire; replacement arrows; version-upgrade markers; filters (capability, owner, criticality, contracts ending); as-is/to-be; export PNG and table; tray deep links for version anchors. Golden path: a retire-and-replace change appears as an arrow in the target quarter.

### F6 — value streams

New ADR: value stream → stages, `enables` from capability to stage; one view; no other taxonomy change. Written and decided before any code. **ADR-023 (`docs/ADR-023-value-streams.md`) is that ADR** — Step 1 of the sprint, docs only; the build (contract/engine/migration, rollup and impact hop, the Value streams page plus the director "By outcome" toggle, roadmap group-by and capability-map/page surfaces, editing behind the "main or a correct-intent change" gate, starter-map content, JSON import, tests) follows it step by step, one PR each.

---

### E3 — delta-apply in SQL

Prerequisites: E1. Before F2. Replace the client-computed head on main commits with server-side application of the commit's deltas to elements_head/relationships_head/facts inside commit_deltas (the TypeScript fold stays the reference; rebuildHead and the head==fold comparison prove equivalence). Payload per commit becomes the deltas only. P-2 and the perf payload test updated (budget drops to < 200 KB for a single edit at 2,000 elements). ADR-015 amendment. Three suites; rebuildHead on every dev model after deploy.

### E4 — LLM proxy edge function

Prerequisites: none. Before F2. Extract the existing suite's llm-proxy into the shared package, deploy it to the Architecture project under supabase/functions/, with per-org rate limits, request logging without payload retention, and a contract test. README documents deployment as part of pnpm release.

### E5 — typed Supabase client

Prerequisites: S2. Generate the Database type from the schema, adopt it across src/db, remove hand-written row types where duplicated, no behaviour change. Round-trip tests unchanged.

### E6 — landscape p5 fps

Prerequisites: S2. Profile the worst 5% of frames on the 2,000-system fixture before changing anything; report; then the smallest change that raises p5 to ≥ 45; gate updated to the measured value.

---

## 5. Plumbing track (desktop only; never the same files as the active sprint)

| Item | Why | Before |
|---|---|---|
| Typed Supabase client | H2 | any time |
| Landscape p5 fps 30 → 45: profile worst frames first | R-perf | after S2 |

---

## 6. Decisions in force (compact)

Taxonomy (12 September): capability, system (incl. platform kinds), container (modules and solutions), actor; **component removed — too detailed, containers are the bottom of the ladder**; **no data-object layer** — data stays as attributes: classification on flows (exists), `systemOfRecordFor` and `holdsPersonalData` on systems (add with F1 or S-track), data platforms as `kind: data_platform`; catalogues and lineage are linked artefacts, not modelled; supports (with role), uses, owns (with role), flows_to; `via` on uses/flows_to; verb phrase in `description`. Platforms host modules (containers) that support capabilities directly. Planned replacement is per capability and requires a retract in the same approved change. Ownership inherits down the capability tree. Lanes are level-1; primary decides placement. Attributes with rules or findings are code; everything else will be a custom attribute (F1). Data migrations are commits. Positions are not persisted on the landscape until auto-layout is stable. Comments never block a merge. A change is a mode you enter explicitly; viewing is distinct from working in. A change carries an intent (record / propose / correct / explore) that sets what the workspace shows and how heavy the review is (F0). Versions are optional snapshots. `essentialFunction` on capabilities and `supportEndsAt` on systems carry the NIS/CAF alignment; no compliance module. Custom attributes and platforms decided 12 September. C19 (ADR-021 §2.1) is the fold rule for main merges once E1 lands.

---

## 7. Deferred register

Every row has (or gets, in P1) a SPEC §11 row and an issue. A row leaves only when the work lands or the human drops it.

| Item | Target | Issue |
|---|---|---|
| C19 fast-forward fold rule | E1 | create |
| C2b structural-conflict resolution + deferred Playwright | E2 (before F2) | #76 |
| Reviewer read-only view of a change | S1 | create |
| Submit for review on the banner | S1 | create |
| Cancel a change | S1 | create |
| Comments on mobile landscape list and capability-scoped list | S1 | create |
| Electricity map Network Delivery & Maintenance; utility equivalent | S1 | create |
| Reorder on-the-fly order, L3 controls, header height, picker alphabetical | S1 | create |
| A2 remainder (resolveRef dedup, reportError everywhere, console check) | S1 | create |
| BranchRebasePanel persisted dismissals; viewer-visibility test | S1 | create |
| Golden-path specs (zero exist) | S2 | create |
| Context view as C4-style diagram | V1 | create |
| C2 review-queue design pass (after first real partial acceptance) | after S2 | create |
| Custom attributes | F1 | create |
| Starter-map upgrade flow (rides on full K1, which landed at PR1–PR16 — this row is the only part of the original F2 (full K1) register entry still open) | F2 (full K1) | create |
| Notification tray deep links (decision, version anchors) | F3 / F5 | create |
| Value streams | F6 | create |
| Drag-and-drop reorder | S-track when move buttons prove tedious | create |
| Typed Supabase client | any | create |
| Landscape p5 fps | after S2 | create |
| Landscape position persistence with layout versioning | not scheduled | create |
| Security zone on containers; compliance view | not scheduled | create |
| Keyboard shortcuts for As-is/To-be/Diff; propose-change picker for contributors at main | S-track | create |
| type_schemas (JSON-Schema generator) | never, if F2's edge function validates with the TypeScript contract | create |
| Deploy workflow (token privileges) | P1 | create |
| Capture: `LLM_BUDGET_EXCEEDED` doesn't exist — org cost cap collapses into `LLM_UNAVAILABLE` (§11) | needs a real per-org cost cap in llm-proxy first | #287 |
| Capture: `LLM_TRUNCATED`/`LLM_SCHEMA_INVALID` "retried once" claimed in a code comment, not implemented (§11) | not scheduled | #288 |
| Capture: calibration metric missing from `scoreCapture.ts` (§12.4) | not scheduled | #289 |
| Capture: `DRAFT_HEAD_MOVED` guard missing from `apply_capture_decisions` (§11) | not scheduled | #290 |
| Capture: SPEC-capture.md doc/code mismatches (§8.1 signature, §13 Playwright workaround, §5.2/§7.3 undisclosed narrowings) | not scheduled | #291 |
