# Plan — October 2026 recommendations (items 1–6)

**Status:** Approved by the human on 2026-10-01 — ADR-024 approved, navigation (F9) first, F9's nav grouping confirmed as written. Folded into `docs/prompts/atlas-prompt-pack.md` §3 item 9 and §4 (F9–F13) the same day; this file holds the detail those entries point to.
**Source:** the product review held in conversation on 2026-10-01 (UI, gaps against LeanIX/Ardoq/Bizzdesign/ServiceNow APM/Sparx, recommendations 1–6), and `docs/ADR-024-projects.md`.

Every sprint below follows CLAUDE.md as it stands: schema changes ship migration + type + round-trip/integration test together; every flow gets a click-only golden path from Home at 1280 and 390; all suites run locally on the final commit (cloud-session PRs carry `needs-local-verify`); UI strings follow the pack's language rule ("change", never "branch"). Each step below is one PR unless marked otherwise, and work stops for a summary after each.

---

## Recommended order

| Order | Item | Sprint | Why here |
|---|---|---|---|
| 1 | 3 — navigation, search, Elements in nav | **F9** | Low risk, every user sees it, and it makes room in the nav for Projects before item 1 adds a page. |
| 2 | 1 — projects (ADR-024) | **F10** | The biggest gap; ADR is drafted. |
| 3 | 2 — TIME disposition | **F11** | Small. Its best finding ("Migrate/Eliminate with nothing planned") reads projects and changes, so it lands better after F10. |
| 4 | 4 — filling gaps fast, owner confirmation | **F12** | Needs one design decision (ADR-025) before code. |
| 5 | 5 — exports and connectors | **F13** | Project pack export depends on F10. |
| 6 | 6 — wider model (technology, data, objectives) | decisions first | Each part either conflicts with a decision in force or reverses an ADR-001 exclusion; decide before planning code. |

This reorders the review's 1→6 by putting item 3 first. If you'd rather start with projects, F10 can go first; F9's nav changes would then be done inside F10 for the one new item, and redone in F9.

---

## F9 — navigation and findability (item 3)

**Goal:** fewer, clearer nav groups; every page reachable; jump to anything from anywhere; usable bottom bar on a phone.

**Grouping — confirmed by the human, 2026-10-01:**

| Group | Items |
|---|---|
| Model | Home, Capability map, Landscape, Value streams, **Elements** |
| Analyse | Portfolio, Roadmap, **Reports** (Boundary crossings, External interfaces, Duplicates) |
| Work | **Projects** (added by F10), Changes (review queue becomes a tab inside Changes, with a count badge on the nav item), Decisions, Capture |
| Record | Versions |

Mobile bottom bar: Home, Capability map, Landscape, Changes, **More** (a sheet listing the rest, grouped as above), every target ≥ 44px.

**Steps**
1. **Docs:** amend `docs/UI-principles.md` §2.0 (groups, mobile bar, "More" sheet, review queue as a Changes tab) and its curated lucide icon list (e.g. `List` for Elements, `BarChart3` for Analyse/Reports, `MoreHorizontal`, `Search`). No code.
2. **Nav regroup:** `ModelNav.tsx` and `modelNavSection.ts`; Elements and the Reports hub become nav entries; `/review` stays a working URL (deep links, architect door) but is no longer its own nav item. Update every golden path that clicks a nav item.
3. **Reports hub:** a small page listing Boundary crossings, External interfaces, Duplicates with their current counts — no new queries beyond what those pages already run.
4. **Mobile bottom bar:** five items plus "More" sheet; Playwright at 390 asserts ≥ 44px targets and that every section is reachable in two taps (the §2.0 promise, re-proved).
5. **Search anywhere (Ctrl/⌘-K):** a dialog over elements (name and aliases), changes, decisions — and projects once F10 lands — reusing `useHomeSearch`'s queries; keyboard-only flow; results open the canonical URL with the current ref. The Home search box stays and opens the same dialog. No `.in()` over growing id lists (CLAUDE.md rule 8).

**Golden paths:** `golden-path-nav-groups` (every nav destination by click, 1280 and 390), `golden-path-search-anywhere` (open with keyboard on a non-home page, find a system, land on it). **Migration:** none.

---

## F10 — projects (item 1, ADR-024)

**Status: built 2026-10-02** on branch `f10-projects` — all eight steps; ADR-024 accepted. Golden paths `golden-path-project-lifecycle` and `golden-path-project-roadmap` pass at 1280 and 390. What the build decided beyond the ADR is in ADR-024 §7.

**Prerequisite:** ADR-024 reviewed and approved by the human (Status stays Proposed until the migration merges).

**Steps**
1. **Migration and types:** `projects`, `project_links`, `decisions.project_id`, `branches.project_id`, the `'project'` link and anchor types, P1–P3 triggers, `atlas.set_decision_project`, `atlas.set_project_status` (with P4), RLS and grants; `atlas.split_change` copies `project_id`. `src/db/types.ts` rows; `src/db/projects.ts` typed queries. Integration tests for RLS per role, P1–P4, both RPCs, and split. SPEC §3.8 and §11 updated; `DELIBERATELY_NOT_MODELLED` comment pointer.
2. **Projects list and create:** Work → Projects; list grouped by status; create form (title, purpose, owner, dates, optional scope elements).
3. **Project page (read):** purpose, owner, dates, declared scope, decision log (own + constraining), changes by stage (exploring → chosen → in review → merged), comments thread, the derived "touched vs declared scope" difference.
4. **Attach and inherit:** "Add to project…" on a change and on a decision (decision moves with its draft options through `set_decision_project`); "New decision" and "New change" from the project page pre-fill it; option changes created from a decision inherit its project; Choose needs no change (P1 already holds).
5. **Evidence on a project:** minimal authoring — add a link or document reference (`evidence` + `project_links`); the first authoring UI for `evidence` anywhere (closes part of ADR-022's deferred row; the same form then becomes reusable on decisions).
6. **Roadmap by project:** `groupBy=project` beside capability and value stream; changes with no project grouped under "No project".
7. **Entry points:** "Start a project" on health-finding rows (architect door, director weak tiles) carrying `source_finding_key`, and in the element page header's overflow menu (pre-fills scope with that element).
8. **Close and cancel:** status actions with P4 enforced in the RPC and explained in the UI (lists the open changes/decisions, links to each).

**Golden paths:** `golden-path-project-lifecycle` (start a project from a finding → start a decision in it → two options → rate → choose → chosen change is in the project → submit, approve, merge → close project), `golden-path-project-roadmap` (roadmap grouped by project). **Migration:** yes (step 1).

**Done also means:** `docs/USER-GUIDE.md` gains a Projects section; ADR-024 flipped to Accepted.

---

## F11 — TIME disposition (item 2)

**Decision needed (human), recorded as an ADR-001 amendment, the `annualRunCost`/`importance` precedent:** a judged, optional system attribute `disposition: 'tolerate' | 'invest' | 'migrate' | 'eliminate'`, unset = "Not assessed". Recommended: on systems and as a module (container) override, not inherited; TS-contract only (attributes are `jsonb`, no migration); labels in code. It is a *decision about* a system, not a score, so it does not breach the "no maturity rating" exclusion — the amendment says so.

**Steps**
1. **Docs:** ADR-001 amendment paragraph; SPEC attribute list. No code.
2. **Attribute:** contract type, `attributeSchema.ts` entry with help text, validation, round-trip test, element page row, browse table column and filter, CSV/XLSX export column, capture column synonyms ("TIME", "Disposition", "Rationalisation").
3. **Portfolio:** disposition column, filter, and a signal where it disagrees with the facts (e.g. *Invest* on a poor-fit system; *Tolerate* on a costly, poor-fit one) — same "never on missing input" stance as the existing signals.
4. **Health finding:** "Marked Migrate or Eliminate, with no open change retiring it" (reads open changes; also names the project if one exists — F10), with "Start a project" from the row.
5. **Capability map colour-by:** worst disposition among supporting systems (order eliminate > migrate > tolerate > invest).

**Golden path:** `golden-path-disposition` (set Migrate on a system → finding appears → start a project from it → the system's retirement merged in a change → finding clears). **Migration:** none.

---

## F12 — filling gaps fast, and owner confirmation (item 4)

**Decision needed (human), as ADR-025, before step 3:** how "the owner confirms this is still true" is recorded under rules 4–5 (every fact via a delta; nothing updated in place). Options:
- **(a) Re-assert:** a confirmation is an `element.update` delta re-stating the current value, with a source of a new kind (`attestation`), so staleness — which reads the newest fact — naturally resets. Needs the engine to accept a same-value update as a real fact rather than a no-op. **Recommended:** one mechanism, provenance shows who confirmed and when.
- **(b) Separate `attestations` table** read alongside facts. Simpler engine, but staleness then has two inputs and an attestation is a fact living outside the delta model.

**Steps**
1. **Editable grid on Elements:** inline edit of enum/date/text attributes for many rows; one commit with many `element.update` deltas; the element page's own edit gate (architect/owner at main; contributor inside a change). Round-trip/integration test that a grid save produces exactly one commit with the right deltas and source.
2. **Gaps queue:** "23 systems have no fit rating", "11 have no owner", "40 have no run cost" — counts from the existing missing-input logic (`missingPortfolioInputs`, health checks); opening one walks the rows with the keyboard (rate, next), the capture review's own keyboard pattern.
3. **ADR-025** (docs only), then **confirmation:** "Still accurate" on an element page and in the grid, writing per the decision.
4. **Owner requests:** a periodic digest to each member who is an owner (`owns` → actor → `memberId`) listing their elements that are stale or have gaps, one-click into the gaps queue filtered to them; edge function on the `send-invite-email` pattern; opt-out in the existing notification preferences.

**Golden paths:** `golden-path-bulk-edit`, `golden-path-gaps-queue`, `golden-path-confirm-still-accurate`.

**Built so far (branch `f12-gaps`):**
- *Step 1 — bulk edit.* Elements → **Edit in grid**: Lifecycle, Criticality, Disposition and the selected custom-attribute column, saved as one commit of `element.update` deltas (`src/engine/bulkEdit.ts`, `src/ui/elements/bulkEdit.ts`). Facts for `previousDeltaId` are read per attribute at the commit (`loadAttributeFactsAtBranch`), never by an element-id list (rule 8).
- *Step 2 — gaps queue.* `/gaps`, reached from the Reports hub rather than a new nav item (the nav's four groups stay as F9 set them). Scope calls, made here rather than asked because the spec is silent and each is reversible: run cost covers systems and modules; criticality and disposition cover systems only (a module's value is an optional override, so unset isn't a gap); fit is one item per unrated `supports` edge; owner means no `owns` edge of any role; retired elements are never gaps. The walk takes its list once when opened, and each answer is its own commit.
- *Step 3 — Still accurate.* ADR-025, option (a), accepted: one commit re-asserting each current fact under a per-confirmation `attestation` source; on the element page beside ✎ Edit, and per row in the grid while editing. No engine change was needed — `element.update` already applied a same-value update as a real fact.
- *Step 4 — owner digests.* **Not built** — left out of F12 by the human on 2026-10-02. No digest is sent and no notification preference exists for one; the gaps queue is reachable only from the Reports hub. **Migration:** likely (ADR-025 source kind / digest schedule).

---

## F13 — exports and connectors (item 5)

**Steps**
1. **View export with stamp:** PNG and PDF of capability map (each colour-by), portfolio and landscape, stamped with model, version/change name and date — reusing `roadmapPngExport.ts`'s approach. A picture of a view is a rendering, not stored state, so rule 2 is unaffected.
2. **Project pack export** (needs F10): one document — purpose, scope, decision log (each decision via the existing ADR markdown builder), target-state summary per change, evidence links — as Markdown and PDF.
3. **Scheduled re-import (decision needed, human):** where from. Recommended first source: a ServiceNow (or other CMDB) table read on a schedule by an edge function, landing as a **capture draft** in the review queue — never a direct write (rule 4), reusing the re-import lineage (`src/capture/reimportDiff.ts`) so unchanged rows don't reappear. Alternative: a file dropped into storage on a schedule.
4. **SSO:** Supabase SAML for an organisation, plus a "Sign in with your organisation" option. Mostly configuration and plan-tier — needs a human with Supabase dashboard access; the code side is small.

**Golden paths:** `golden-path-export-view`, `golden-path-project-pack`, `golden-path-scheduled-import` (against a stubbed CMDB in test setup only — rule 7). **Migration:** step 3 (schedule/config).

---

## Item 6 — wider model: decide before planning code

Each part touches a written decision, so the plan here is the decision, not a sprint.

| Part | What stands in the way | Recommendation |
|---|---|---|
| **Data objects** | Pack §6, "Decisions in force" (12 September): **no data-object layer** — data stays as attributes, `systemOfRecordFor` and `holdsPersonalData` on systems "add with F1 or S-track". Neither attribute exists yet. | Keep the decision. Build the two promised attributes (small S-track item, no migration) plus a "personal data" filter and finding. Revisit a data layer only if a real team needs CRUD-by-data-object. |
| **Technology / end of support** | ADR-001 has no technology type; `supportEndsAt` exists on systems only; `technology` on containers is free text. | No new type. ADR-001 amendment: `supportEndsAt` on containers (module override), the existing end-of-support finding extended to containers, and `technology` offered as a custom attribute with a controlled list per org (F1 mechanism). |
| **Objectives / goals** | ADR-001 excludes `goal-strategy-kpi`. | Hold. Projects (`purpose`) and capability `importance` cover the near-term need. If wanted, an ADR-026 would add objectives on the **workflow tier**, like projects — linked to projects and capabilities, never a landscape fact — rather than reverse the exclusion. |

Each "yes" becomes a short ADR or ADR-001 amendment, then a sprint in this format.

---

## Decisions needed from the human, in order

1. ~~ADR-024 — approve, or mark up.~~ **Approved 2026-10-01.**
2. ~~Order — F9 (nav) first, or F10 (projects) first.~~ **F9 first, 2026-10-01.**
3. ~~F9 nav grouping — the table above, or changes to it.~~ **Confirmed as written, 2026-10-01** — recorded in `docs/UI-principles.md` §2.0 and §10 item 18 (F9 step 1).
4. F11 — disposition values and whether modules can override. *(Before F11 step 1.)*
5. F12 — ADR-025 option (a) or (b). *(Before F12 step 3.)*
6. F13 — first scheduled import source, and who sets up SSO. *(Before F13 steps 3–4.)*
7. Item 6 — the three recommendations. *(Any time; no code depends on it.)*
