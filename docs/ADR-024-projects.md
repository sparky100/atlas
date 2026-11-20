# ADR-024: Projects — the container for a piece of architecture work

**Status:** **Accepted 2026-10-02** — built as sprint F10 (`docs/PLAN-2026-10-recommendations.md`); migrations `supabase/migrations/20261002010000_anchor_type_project.sql` and `20261002020000_projects.sql`. Proposed and approved for build by the human on 2026-10-01.
**Numbering:** ADR-023 is the current highest (`docs/ADR-023-value-streams.md`), so this is ADR-024. `docs/ADR-000-foundations.md`'s own index gains a one-line pointer to this file, per that document's established convention for ADR-021 and every later one.
**Depends on:** ADR-001 (`docs/ADR-000-foundations.md` — its "explicit non-types" list names `project-or-programme`, which this ADR has to argue against, and does not overturn), ADR-002 (branches), ADR-010 (comment anchors), ADR-013/ADR-022 (decisions, `decision_links`, `evidence`), F0 (`branches.intent`), F5 (roadmap group-by), ADR-023 (the roadmap's second group-by mode — this ADR adds a third).

## Context

Atlas can record *why* (a decision, its options and rationale) and *what* (a change: an isolated set of edits to the model, reviewed and merged). It has nothing that holds the piece of work both belong to. In practice an architecture team works project by project: "Housing CRM replacement" raises several decisions over its life ("replace, upgrade or tolerate?", "which integration pattern?", "migrate data or archive?"), produces one or more target-state designs, and is delivered in parts. Today those decisions and changes float free; the only grouping is a title convention.

The human's model, agreed in conversation on 2026-10-01, is the one this ADR records:

- **A project is the container.** Decisions are part of a project — its decision log. Changes are the project's design deliverables (its target-state "docs"), which become the live model when merged.
- **A project is optional for a decision.** Portfolio-level decisions ("standardise on Azure", "tolerate SAP PM until 2028") involve no delivery and must not be forced into a placeholder project.

Three things need deciding that neither ADR-001 nor ADR-013/022 answers:

1. Whether a project is a **model fact** (versioned, delta-carried, provenance-bearing) or a **workflow record** (like `decisions`).
2. How a project, its decisions, and its changes reference each other — and which of those references is stored versus derived.
3. What keeps the three consistent when a decision's options are themselves changes.

## Decision

### 1. A project is a workflow record, not a model fact

`projects` is a plain RLS-guarded table on the same tier as `decisions`, `decision_arguments` and `decision_option_ratings`: not in `deltas`, not folded into a head, not visible in a version (tag) as-of view. It changes no element type, no relationship type, no `relationship_type_rules` row, and no head hash.

**Why this does not overturn ADR-001.** ADR-001 excludes "projects/programmes as landscape elements" and says instead that "a programme is the subject of a change branch's metadata, not a landscape fact." This ADR is that sentence built out: a project is metadata *about* changes (and decisions), never a fact *in* the landscape. Nothing can `support`, `use`, `own` or `flow_to` a project; no capability-map tile, landscape lane or context diagram ever draws one as a shape. `DELIBERATELY_NOT_MODELLED` keeps `project-or-programme`; its doc comment gains a one-line pointer to this ADR, the same treatment ADR-023 gave `business-process`.

### 2. Schema

**`projects`** (new):

| Column | Type | Purpose |
|---|---|---|
| `id` | `uuid` pk | |
| `org_id` | `uuid not null → organisations` | tenancy (ADR-009) |
| `model_id` | `uuid not null → models` | a project belongs to one model |
| `title` | `text not null`, non-blank | |
| `purpose` | `text not null default ''` | the problem or opportunity, in plain words (the role `decisions.statement` plays for a decision) |
| `owner_id` | `uuid not null → auth.users` | the architect: who is accountable for delivering it — distinct from any decision's own owner (shown as "Architect" in the UI) |
| `project_manager_id` | `uuid` (no FK, no index — see `20261115130000_project_manager.sql`) | optional: the project manager, when they are an Atlas user |
| `project_manager_name` | `text`, 1–200 characters | optional: the project manager as a plain name, when they are not an Atlas user; at most one of the two is set |
| `status` | `text not null default 'active'`, check in `('proposed','active','on_hold','closed','cancelled')` (`proposed` only at creation, B2) | RPC-only past creation (§4) |
| `start_date` | `date` nullable | |
| `target_date` | `date` nullable | when the project as a whole is meant to be done — distinct from each change's own `branches.target_date` |
| `source_finding_key` | `text` nullable | which health-finding check "Start a project" traced back to — same stable-string-key stance as `decisions.source_finding_key` (ADR-022) |
| `closed_by`, `closed_at`, `close_reason` | nullable | set together by the close/cancel RPC only |
| `created_by`, `created_at` | | |

**`decisions.project_id`** — new nullable column `→ projects(id)`. "This decision is part of that project." Null is a portfolio-level decision. Grantable on the same terms as the other plain `decisions` columns (only while `status = 'proposed'`, `atlas.guard_decision_update`), but always written through `atlas.set_decision_project` (§3) so option changes follow.

**`branches.project_id`** — new nullable column `→ projects(id)`, with `check (project_id is null or kind = 'change')`: main and capture drafts never belong to a project. A change belongs to at most one project. It is branch metadata on the same footing as `title`, `target_date` and `intent`, never read by fold, merge classification or the head hash.

**`project_links`** (new, mirroring `decision_links` / ADR-010's polymorphic-anchor pattern): `project_id`, `linked_type` check in `('element','evidence')`, `linked_id`; primary key `(project_id, linked_type, linked_id)`.
- `element` is the project's **declared scope** — the capabilities and systems it is about, recorded at the start, before any change exists to derive scope from.
- `evidence` attaches business cases, vendor documents and links (the existing `evidence` table, ADR-013) to the project rather than to one decision.

**`decision_links.linked_type`** gains `'project'`, for the cross-cutting case: a decision that *constrains* a project it is not part of ("standardise on Azure" linked from three projects). Being part of a project is `decisions.project_id`; being relevant to one is a link. The two are never the same row.

**`anchor_type`** (comments) gains `'project'`, so a project page carries its own comment thread (ADR-010), checked by `atlas.check_anchor`/`atlas.anchor_visible_to_viewer` the same way `'decision'` is.

### 3. Consistency rules

**P1 — an option follows its decision.** A change linked to a decision as an option (`decision_links.linked_type = 'branch'`) has the same `project_id` as that decision. Enforced in the database, not only in UI code:
- creating an option from a decision in project P creates the change with `project_id = P`;
- a `decision_links` insert of type `'branch'` whose branch's `project_id` differs from the decision's is refused;
- `atlas.set_decision_project(decision_id, project_id)` (security definer, decision still `proposed`) moves the decision and every one of its option changes still in `draft` in one transaction. Options already submitted or merged are not moved; if any exist with a different project, the call is refused with a plain message rather than leaving the two disagreeing.

**P2 — a change's project is changed only while the change is open.** `branches.project_id` may be set or changed while the change is `draft`, `proposed`, `in_review` or `approved`; once `merged`, `rejected`, `cancelled` or `archived` it is frozen, the same "closed records don't move" stance as `decisions` after they leave `proposed`.

**P3 — split keeps the project.** `atlas.split_change` copies `project_id` to the new change alongside `target_date` and `intent`.

**P4 — closing loses nothing.** Close and cancel (§4) are refused while the project has an open change (`draft`/`proposed`/`in_review`/`approved`) or a `proposed` decision. The UI lists exactly which ones and offers to cancel them first through their own existing actions; the project RPC never cancels anything itself. No project is ever deleted (CLAUDE.md rule 5's spirit, applied to a workflow table as ADR-013 already does for decisions).

### 4. Lifecycle and permissions

- **Create:** owner/architect/contributor, mirroring `decisions_insert`. Always created `active`.
- **Edit** `title`/`purpose`/`owner_id`/`project_manager_id`/`project_manager_name`/`start_date`/`target_date`: the project's creator or owner, or an org owner/architect, while `active` or `on_hold`.
- **Status:** `atlas.set_project_status(project_id, status, reason)` only. `active ⇄ on_hold` freely; `→ closed` or `→ cancelled` subject to P4, with `close_reason` required for `cancelled`. `closed`/`cancelled` are terminal; reopening is a new project (a decision is superseded, not reopened, for the same reason).
- **Viewers** read everything, as for decisions.

### 5. What is derived, never stored

- The project's **decision log**: `decisions where project_id = P`, plus decisions that link to it with `linked_type = 'project'` (shown separately as "constraining decisions").
- The **originating decision**: the project's earliest decision, if any. No column — the human's model makes the first decision just the first entry in the log.
- **What the project touches**: the union of elements changed by its changes' deltas, alongside the declared scope in `project_links`. A difference between the two (touched but not in scope, or in scope but untouched) is a useful prompt, shown, never auto-corrected. **Amended 2026-10-07 (§9):** "changed" includes both ends of every relationship a change adds, changes or removes (`listElementsTouchedByChange`), so a project whose changes are integrations touches the systems they integrate; and a scope item one of its changes only *affects* — a capability or value stream reached through change impact (§8, ADR-023's amendment) — is covered, so it no longer reads "in scope, not touched or affected by any change yet". Affected items outside the scope are not listed as touched: impact reaches widely, and that list is for what the changes edit.
- **Progress**: counts of its changes by status and decisions by status. No percentage — Atlas does not score (ADR-000 preface #6).
- **Overdue decisions**: a `proposed` decision in the project whose `needed_by` is past.

### 6. Views (built in later PRs, named so the ADR is complete)

1. **Projects** page — a list grouped by status, under the Work nav group.
2. **Project** page — purpose and owner, declared scope, decision log, changes (by stage: options being explored → chosen design → in review → merged), evidence, comments, and a roadmap slice of its changes.
3. **Roadmap** — a third `groupBy` mode, `project`, beside `capability` and `valueStream` (`src/ui/roadmap/roadmapFilterParams.ts`).
4. **Entry points** — "Start a project" from a health finding and from a capability or system's own page; "Add to project…" on a change and on a decision; on Choose, the chosen option is already in the decision's project (P1).

### 7. Built as (F10, 2026-10-02)

Recorded so nothing in the build is an unwritten decision:

- **Two migrations, not one.** `anchor_type` gaining `'project'` is its own migration (`20261002010000`): Postgres won't use a new enum value in the transaction that adds it, and the main migration's anchor functions compare against it.
- **A closed or cancelled project accepts nothing new** (`atlas.assert_project_accepts_members`, on decision insert, `decisions.project_id` change and `branches.project_id` set). This is P4 kept true after closing, not a new rule: without it a decision or change could join a closed project and leave it closed with open work.
- **`branches.project_id` is a plain, column-granted update** (same roles as `title`/`intent`), guarded by `atlas.guard_branch_project` for P1/P2 — no third RPC. `decisions.project_id` is not client-updatable at all; it moves only through `atlas.set_decision_project`, which moves the decision first so its own option updates pass the P1 guard.
- **Scope and evidence links can be removed** (`project_links_delete`) by the same people who may edit the project, while it is open — the declared scope is part of the project's own record, editable like its title (the accepted no-field-history risk below covers it too). An element link is checked against permanent `element_create` history, like a comment anchor.
- **"What the project touches"** is computed per change from its own commits' element deltas (`listElementsTouchedByChange`, an inner embed on `commits.branch_id` routed through `selectAll`, never an `.in()` list).
- **Roadmap "By project"** groups each system bar under every project whose changes' roadmap events (add, retire, either end of a replacement) name it; systems no project touches sit under "No project".
- **Evidence authoring** is a link (http/https only) or a document reference with an optional description, attached to the project — the first `evidence` authoring path anywhere.
- **Found and fixed on the way:** `atlas.delete_model` never deleted `decision_option_ratings` (added after it was last rewritten), so deleting an archived model with a rated option failed on a foreign key. The F10 rewrite clears ratings, project links and projects.

### 8. Amended — change impact (2026-10-06)

Agreed with the human on 2026-10-06, after a change that only added an integration (ESCOMS uses GIS) listed no affected capabilities at all, though ESCOMS supports Wayleaves — the capability the change's own project is about.

**Which systems a change touches** (`summarizeOwnDeltas`, `src/db/changeSummary.ts`). Before this, only a system whose own record a change edited counted, so a change made of relationships reached nothing. Now a system counts as touched when:

- its own record is edited (unchanged);
- one of its modules is edited — a module rolls up to its parent system;
- a `uses` or `flows_to` edge is added, changed or removed with it, or one of its modules, on the **`from` (consuming / sending) side**. The `to` side is never counted: a provider gaining a consumer doesn't change how it delivers its own capabilities, and counting it made one integration with a widely used system (GIS, an integration platform) list everything that system supports.

A capability is affected when its own record is edited, its own `supports` edge is added/changed/removed (that capability only — not everything the supporting system supports), or a touched system or module supports it. A touched module counts under its own id as well as its platform's, so both the module's own `supports` edges and its platform's reach their capabilities. (Corrected 2026-10-07: the first build looked up `supports` edges from the platform only, so a module that supports a capability itself — ESCOMS, a module of Salesforce, supporting Land, Wayleaves & Consents — reached nothing.) Each affected capability carries its **reasons** (`ImpactReason`), shown beside it: "integration: ESCOMS uses GIS", "module SAP · PM edited", "GIS edited", and so on. Direction matters: "GIS uses ESCOMS" would reach GIS's capabilities instead — the direction an integration is recorded in is part of the fact.

**What is shown first** (`focusImpact`, `src/ui/changes/impactFocus.ts`). For a change in a project, the change page, the Changes list card and the project pack show the affected capabilities in the project's declared scope (`project_links`); everything else the change reaches is listed under a collapsed "Also reached, outside the project's scope". Affected value streams follow: a stream is shown with only the stages a shown capability reaches; a stream only collapsed capabilities reach is collapsed. With no project, or none of the affected capabilities in its scope, everything is shown — narrowing to an empty list would read as "nothing affected", which is false.

**Reviewer routing is not narrowed.** `loadDerivedReviewers` (`src/db/deriveReviewers.ts`, ADR-000 §merge review "Derivation") still reads the full affected-capability list, collapsed ones included: collapsing is a display choice, and a capability owner whose capability the change really reaches must not drop out of the review because the project's scope didn't name it. The wider touched-system rule above does reach more capability owners than before — the intended effect. The touched-*system* owner list for routing is unchanged (systems the change edits as elements).

**Deferred:** naming which capability an integration serves (a field on the `uses`/`flows_to` relationship), which would make a system supporting several capabilities reach exactly one. It is a data-model change (migration, contract, round-trip test) and waits for a need the scope focus doesn't meet.

### 8a. Amended — problems a change causes (2026-11-12)

Requested by the human (Simon) on 2026-11-12 after the project-and-change walkthrough found two gaps on the change page. A new panel, **"Problems this change causes"** (`findImpactProblems`, `src/engine/changeImpactProblems.ts`; `ImpactProblemsPanel`), sits above "Affected capabilities". It lists problems only and renders nothing when there are none; every element in a row is a link.

- **No system:** a capability some system supported before the change and none supports after (the same read the future landscape uses, `capabilitiesLeftWithoutSystem`), with the systems that supported it.
- **Provider side:** §8's rule stands — a provider is still never counted as *affecting* capabilities. The panel only reports a provider that is a problem: a system the change touches depends (`uses`/`flows_to`) on a provider whose `plannedEnd` is within `STALE_AFTER_MONTHS` with no `replaces` edge ("End of life"), or the change removes a provider that another system still depends on ("Removed").

Nothing is stored; it is computed from the as-is and to-be heads like the rest of the summary. Who can see a change page is unchanged (the Viewer question is still open).

### 9. Amended — open changes touching the same elements (2026-10-07)

Agreed with the human on 2026-10-07. The change page's "Other open changes touching the same elements" compared only the subjects a change edits — element ids, and for a relationship the relationship's own id. A change made of relationships therefore never matched anything: a relationship it adds exists on no other change.

**What a change touches** (`touchedElementIds`, `src/db/changeSummary.ts`; `touchedElementsByBranch`, `src/engine/changeOverlap.ts`): every element it edits, and **both** ends of every relationship it adds, changes or removes. Both ends, unlike change impact (§8): the question is "might these two changes collide?", and two changes integrating with the same system is exactly that. A relationship's ends come from either head, or from its own create delta when it was created and removed on the same change; for another change, from that relationship's create delta anywhere in the model.

**Overlap** (`sharedElements`): two open changes overlap when they touch a common element, or one touches a platform directly and the other one of its modules. Two sibling modules of one platform don't overlap. Each overlapping change is listed with the elements it shares ("Both touch GIS"), named as everywhere else ("Platform · Module").

**Capture drafts are listed apart (2026-10-08).** An unreviewed capture draft (`branches.kind = 'capture_draft'`) is the AI extraction from one uploaded document, not a change anyone has proposed, and each re-upload of the same document makes another one — so listing them beside real changes buried the changes under rows like "SPDJune2026ActionPlan.pdf — 2026-09-24" ×5. The list now holds `kind = 'change'` only; overlapping drafts go under a collapsed "Unreviewed capture drafts touching these elements (N)", one entry per document title with its draft count, the union of what they share, and a link to the newest upload's capture review (`groupCaptureDraftOverlaps`; the job is found through `capture_jobs.resulting_branch_id`). Agreed with the human on 2026-10-08. The query (`listOpenChangesSharingElements`, `src/db/elements.ts`) reads the model's deltas, commits and open branches whole and narrows in memory — CLAUDE.md rule 8, no id list in an `.in()` filter.

## Alternatives rejected

- **Project as a fifth landscape element type.** Gives history and provenance for free, but makes a delivery vehicle a landscape fact — it would appear in versions, be drawable, need relationship rules, and break ADR-001's explicit exclusion for no modelling gain. The things worth versioning (what the project changes) are already versioned, as its changes.
- **Project as a text label on a change.** No owner, dates, status or decisions; renames drift; the human's "decisions are part of a project" has nowhere to live.
- **Project = a decision with many changes.** A decision closes when an option is chosen; a project lives on through delivery and raises further decisions. Conflating them would reopen closed decisions or close live projects.
- **Changes reach their project only through a decision** (no `branches.project_id`). Fails for `record`/`correct` changes made as part of a project without any decision, and for later phases split off a chosen option.
- **Many projects per change.** Breaks a clean roadmap group-by and makes "the project's target state" ambiguous. Shared work is expressed by splitting the change (P3) or by a `'project'` decision link.
- **Making `project_id` required on decisions.** Rejected by the human on 2026-10-01: it forces portfolio-level decisions into placeholder projects.

## Consequences

- `src/db/types.ts` gains `ProjectRow`, `ProjectLinkRow`, `ProjectStatus`, `ProjectLinkedType`, and `project_id` on `DecisionRow`/`BranchRow`; `DecisionLinkedType` gains `'project'`. These are workflow row shapes, so they live in `src/db/types.ts`, not `src/contracts/` (the ADR-022 split).
- One migration ships the tables, columns, checks, P1–P3 triggers, RPCs, RLS and grants, with integration tests for RLS, P1–P4 and the RPCs, per CLAUDE.md rule 1. No delta, fold or head change, so no RT-/P- suite changes.
- `docs/SPEC-data-model.md` §3.8 gains the new table and columns; §11 gains the deferred rows below; `DELIBERATELY_NOT_MODELLED`'s comment gains its pointer.
- **Accepted risk, same as decisions today:** a project's plain fields (title, purpose, dates) are overwritten in place while it is open, with no field-level history. Status transitions keep who and when. Anyone needing a full audit trail of a project's own fields would need a history table, deferred below.
- `decisions.status = 'accepted'` still requires a chosen branch (`decisions_decided_consistent`), so a "tolerate / do nothing" outcome remains an option change with no edits. Unchanged by this ADR; noted because projects will make that case more visible.

## Deferred, unscheduled

- **Programmes** (a project containing projects). One level is enough until a real team asks.
- **Budget** on a project. If added, a banded judgement like `annualRunCost`, never a figure.
- **Phases and gates.** Changes already carry target dates; a gate model waits for evidence it is needed.
- **Dependencies between projects.**
- **Field-level history** for project fields (see accepted risk above).
- **Project pack export** (one document of scope, decision log, target state and evidence) — planned as part of the export work, not this ADR's first build.
- **Assumptions/evidence authoring UI** — already deferred by ADR-022; the project page's evidence section needs at least "add a link/document", so this becomes a prerequisite of that section, tracked in the plan.

**Amended — proposed projects (2026-11-19, migration `20261119150000_project_proposed_status.sql`):** a project may be created `proposed` (insert policy allows `active` or `proposed`). While proposed it is open: it can be edited and take decisions, changes and scope (policies and `atlas.assert_project_accepts_members` accept it). `atlas.set_project_status` is replaced: `proposed → active` only for an org owner or architect (never the proposer alone); `proposed → cancelled` declines it, with a reason and still subject to P4; `proposed → on_hold` or `closed` is refused; nothing returns to `proposed`. Proposed projects are not counted as work in hand and are left off the Roadmap. No new table or function. Reason: Simon's Phase B2, so a person (and later an agent) can put forward a project without it counting as committed work.

**Amended — who may start and accept a project (2026-11-20, migration `20261120020000_project_proposal_rules.sql`):** the insert policy now allows `proposed` for an owner, architect or contributor, and `active` only for an owner or architect (a contributor can no longer create an active project). `projects.accepted_by` / `accepted_at` record acceptance (no foreign key, on purpose: no new unindexed-FK advisor finding). `atlas.set_project_status` refuses `proposed → active` for the proposer while another owner or architect exists; the sole owner or architect may accept their own, and the record shows it. This enforces what the 2026-11-19 amendment's comment ("never the proposer alone") only claimed: that comment was not enforced in SQL.
