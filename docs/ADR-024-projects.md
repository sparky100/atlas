# ADR-024: Projects — the container for a piece of architecture work

**Status:** Proposed 2026-10-01 — docs only, no code. **Approved for build by the human on 2026-10-01** as sprint F10 (`docs/PLAN-2026-10-recommendations.md`), scheduled after F9. Accepted once its migration lands (the ADR-023 precedent).
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
| `owner_id` | `uuid not null → auth.users` | who is accountable for delivering it — distinct from any decision's own owner |
| `status` | `text not null default 'active'`, check in `('active','on_hold','closed','cancelled')` | RPC-only past creation (§4) |
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
- **Edit** `title`/`purpose`/`owner_id`/`start_date`/`target_date`: the project's creator or owner, or an org owner/architect, while `active` or `on_hold`.
- **Status:** `atlas.set_project_status(project_id, status, reason)` only. `active ⇄ on_hold` freely; `→ closed` or `→ cancelled` subject to P4, with `close_reason` required for `cancelled`. `closed`/`cancelled` are terminal; reopening is a new project (a decision is superseded, not reopened, for the same reason).
- **Viewers** read everything, as for decisions.

### 5. What is derived, never stored

- The project's **decision log**: `decisions where project_id = P`, plus decisions that link to it with `linked_type = 'project'` (shown separately as "constraining decisions").
- The **originating decision**: the project's earliest decision, if any. No column — the human's model makes the first decision just the first entry in the log.
- **What the project touches**: the union of elements changed by its changes' deltas, alongside the declared scope in `project_links`. A difference between the two (touched but not in scope, or in scope but untouched) is a useful prompt, shown, never auto-corrected.
- **Progress**: counts of its changes by status and decisions by status. No percentage — Atlas does not score (ADR-000 preface #6).
- **Overdue decisions**: a `proposed` decision in the project whose `needed_by` is past.

### 6. Views (built in later PRs, named so the ADR is complete)

1. **Projects** page — a list grouped by status, under the Work nav group.
2. **Project** page — purpose and owner, declared scope, decision log, changes (by stage: options being explored → chosen design → in review → merged), evidence, comments, and a roadmap slice of its changes.
3. **Roadmap** — a third `groupBy` mode, `project`, beside `capability` and `valueStream` (`src/ui/roadmap/roadmapFilterParams.ts`).
4. **Entry points** — "Start a project" from a health finding and from a capability or system's own page; "Add to project…" on a change and on a decision; on Choose, the chosen option is already in the decision's project (P1).

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
