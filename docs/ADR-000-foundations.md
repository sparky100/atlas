# ADR-000: Foundations

**Status:** Proposed
**Scope:** Atlas — an enterprise-architecture product for mid-market and public-sector organisations (councils, NHS boards, housing associations, universities), sized for one-or-two-architect teams currently on Sparx, Visio, or spreadsheets.

This document is a set of numbered architecture decisions (ADR-001 through ADR-019). Each follows Context / Decision / Alternatives Rejected / Consequences. It is a foundations record, not a full design — several decisions explicitly defer detail to a future ADR, and say so.

**Working assumptions**, stated up front because several decisions depend on them:

- The product name used throughout is **Atlas** (the repository's own name), pending an actual brand decision.
- The brief's own use of "RLS" is read as a signal that the backend is Postgres (plausibly Supabase, given the tooling available in this environment). Row-level security, `organisation_id` columns, and `jsonb` attributes are chosen on that assumption. If the real backend differs, ADR-009 and the attribute-storage half of ADR-001 need revisiting first.
- "Existing suite" refers to a sibling product family this document cannot inspect directly (out of this session's repository scope). ADR-014's package-boundary decision is therefore necessarily provisional on one point, which it names explicitly.

## Preface: pushback on the brief

The brief is good and mostly implementable as stated, but a few things are wrong or underspecified enough to call out before the decisions below, since several decisions resolve them by disagreeing with the brief:

1. **"External" should not be a sixth element type.** Making it a sibling of System/Container/Actor doubles the attribute sets and the `relationship_type_rules` matrix for no new modelling power — an external system is a system, plus one fact ("we don't own it"). ADR-001 makes it an attribute instead.
2. **"Contains" should not be a relationship type.** Structural decomposition (capability→capability, system→container, container→component) needs single-parent and acyclic guarantees. Modelled as generic edge rows, nothing stops two parents or a cycle without extra application code; modelled as a foreign key on the child, the database enforces it. ADR-001 treats containment as structure, not a fact-relationship.
3. **"Versions (immutable tagged snapshots)"** reads as if a version is a stored copy of the whole landscape. It should be an immutable *pointer* (a tag on a commit), not a duplicated materialisation — otherwise every tag doubles storage and creates a second place state can drift from. ADR-002/003 make tags pointers; a snapshot cache is a separate, disposable performance optimisation.
4. **Capture pipeline, merge review queue, and decisions-with-evidence are requirements but weren't in the "cover at minimum" list.** They're core to the thesis ("capture with smart merging plus changes as branches plus decisions with arguments"), so this document adds ADR-004, ADR-006, and ADR-013 for them rather than leaving them implicit inside the delta model. Their omission from the minimum list looks like an oversight, not a deliberate v1 cut.
5. **Watch for a "Service" type request.** Public-sector customers (LGA service lists, NHS service directories) will very likely ask for a citizen-facing "Service" layer distinct from Capability within the first few months. Recommend *not* adding it now — model it as a tag/subset of leaf capabilities — but flag it here so it isn't treated as a surprise later.
6. **Maturity/heat-map scoring is explicitly out of scope for v1.** It's one of the most common ways EA tools accumulate scope; the brief doesn't ask for it and this document doesn't add it. If it's added later, ADR-007's fact model already has a natural home for it (a rated fact on a capability, sourced like any other).
7. **"One or two architects" per organisation is a role-model constraint, not just a target market.** ADR-009's roles must degrade to "one person, all rights" without friction — a four-role RBAC that assumes separation of duties will feel bureaucratic to the exact customer this product is for.
8. **The brief is silent on identity/tenancy overlap with the existing suite.** ADR-014 flagged this as the one open question this document could not close from inside this repository at the time it was written; ADR-017 closes it (Atlas has its own project and its own identity/tenancy tables, permanently).

---

## ADR-001: Element and relationship taxonomy

**Context.** The taxonomy has to stay small on purpose (per the stated philosophy) while covering landscape → context → container → component plus one business layer (capability). It has to support AI-assisted capture (which needs per-type validation to score confidence against) and must not let "just one more field" turn into scope creep.

**Decision.**

*Element types (five, not six):* **Capability, System, Container, Component, Actor** (subtype `person` or `team` — kept as one type with a subtype rather than two, because both can be relationship endpoints for `owns` interchangeably, and splitting them would double `relationship_type_rules` rows for no semantic gain).

"External" is not a type. It is an attribute (`is_external` boolean, `external_organisation` nullable text) available on System, Container, and Actor. Component is always internal to its parent Container, so it doesn't carry the attribute.

Attributes are stored as a discriminated single table per superclass (`elements`, `relationships`) with a `type` column and a `jsonb` attribute payload, validated against a versioned `type_schemas` registry (`type_schemas`: `type`, `schema_version`, `json_schema`, `effective_from`). This is deliberately not one table per element type, and not a fully generic EAV model — see Alternatives Rejected.

Structural containment is **not** a relationship row. It is a plain foreign key on the child element: `parent_capability_id` on Capability, `parent_system_id` on Container, `parent_container_id` on Component. Single parent and acyclicity are then ordinary database/application constraints, not something a generic edge table has to be taught to enforce.

Ownership is never a foreign-key attribute on an element (e.g. no `owner_actor_id` column). It is always the `owns` relationship, so *when* ownership changed and *from what source* is itself a fact with provenance (ADR-007), not a silently-overwritten column.

Attribute sets per type (required fields marked *req*):

| Type | Key fields |
|---|---|
| Capability | `name` *req*, `description`, ~~`level` *req* (1–3)~~ (ADR-016: computed from `parent_capability_id` depth, not a stored attribute), `parent_capability_id`, `code` (ADR-020, amended from "reference code from a starter map": an organisation's own optional reference, never populated by seeding), `template_ref` (nullable, links back to `capability_map_template_items`) |
| System | `name` *req*, `description`, `lifecycle_status` *req* (`planned`/`active`/`retiring`/`retired`), `vendor`, `is_external`, `external_organisation`, `introduced` (date, when it went live), `planned_end` (date, planned decommission — independent of `lifecycle_status`; a system can have a known end date well before it actually reaches `retired`) |
| Container | `name` *req*, `description`, `technology`, `parent_system_id` *req*, `is_external`, `introduced`, `planned_end` |
| Component | `name` *req*, `description`, `technology`, `parent_container_id` *req* |
| Actor | `name` *req*, `subtype` *req* (`person`/`team`), `email` (person only), `org_unit`, `is_external`, `external_organisation` |

*Relationship types (four, non-structural only):* **supports** (System → Capability), **uses** (System/Container/Component → System/Container/Component, directional runtime dependency), **owns** (Actor → Capability/System, accountability), **flows-to** (System/Container → System/Container, integration/data flow; attributes `data_classification`, `protocol`, both optional).

A `relationship_type_rules` table constrains what's legal: columns `relationship_type`, `allowed_source_types` (array), `allowed_target_types` (array), `max_cardinality_per_source` (nullable — e.g. `owns` may cap at one *primary* owner without forbidding secondary owners). This is the enforcement point that stops nonsense like "Actor uses Capability."

*(Sprint H1 amendment.)* This constraint shipped as `RELATIONSHIP_TYPE_RULES`, a constant in `src/contracts/relationshipTypeRules.ts` (SPEC-data-model.md §3.3), rather than as a migrated table — see that section's own note for why. `src/engine/deltas.ts`'s `apply()` checks every `relationship.create` against it, so "Actor uses Capability" is now a rejected commit, not just a documented intention.

*Explicit non-types* — deliberately excluded from the taxonomy, named here so a future feature request has to argue against a written decision rather than just accreting: business processes/workflow steps (BPMN-shaped), logical data entities (ERD-shaped), infrastructure/network topology (racks, subnets, firewalls), projects/programmes as landscape elements (a programme is the subject of a change branch's metadata, not a landscape fact), goals/strategy/KPIs (a layer above capability), requirements/user stories, cost/budget figures, risk register entries, service-catalogue entries (see Preface #5), maturity/heat-map ratings (see Preface #6), and org-chart reporting lines beyond a flat Actor.

**Alternatives rejected.**
- *Fully generic EAV/triple store for all attributes* — unqueryable at scale, no per-type validation to hang AI confidence scoring on.
- *One table per element type* — a migration for every new field, and joins across five tables for the most basic "search everything" query.
- *"External" as a sixth element type* — duplicates attribute sets and relationship rules for a single boolean fact's worth of information.
- *"Contains" as a generic relationship* — loses single-parent/acyclic guarantees that come for free from a foreign key.
- *Owner as a foreign-key column* — throws away the history and provenance of who owned something and since when.

**Consequences.** Adding a new element or relationship type is intentionally expensive (a schema entry, a migration, new `relationship_type_rules` rows) — that friction is the mechanism that keeps the taxonomy small, not an accident to be optimised away. Full validation (required fields, referential integrity, rule conformance) is enforced at materialisation time (ADR-003), not at write time, so a capture pipeline's draft branch is allowed to be temporarily invalid before human review.

---

## ADR-002: Delta representation, commits, branches, and tags

**Context.** Changes have to be branchable deltas against the current landscape, mergeable through review, and every change has to carry its own provenance. The representation has to support git-shaped vocabulary (branch, commit, tag) without inheriting git's blob/tree model, which isn't built for typed, queryable, tenant-scoped facts.

**Decision.** A **delta** is one fact assertion, not a generic patch operation. `deltas`: `id`, `origin_commit_id` (the commit that introduced it — immutable, for blame/history), `subject_type` (`element`/`relationship`), `subject_id`, `operation` (`create`/`update`/`retract`), `attribute` (nullable — unset for whole-object create/retract), `value` (jsonb), `previous_delta_id` (nullable — the fact this one supersedes, same subject+attribute), `source`, `source_ref` (pointer into the originating document, e.g. sheet/cell or PDF page), `effective_date`, `confidence`, `created_by`.

A **commit** groups a batch of deltas: `commits`: `id`, `branch_id`, `parent_commit_id`, `merged_branch_head_commit_id` (nullable — set only on merge-kind commits; this makes commit ancestry a DAG with two parents on a merge, exactly like a git merge commit), `kind` (`manual`/`capture`/`merge`/`template_seed`), `author`, `message`, `created_at`.

*(Sprint U4-1 amendment.)* `message` is `title` (renamed) plus `body` (added). `title` is no longer caller-typed: for a `manual` commit it's generated from the commit's own deltas (`src/engine/describeEnvelope.ts`) — real element and relationship names, not a hand-written summary. `body` is an optional caller elaboration nothing writes a real one into yet. See SPEC-data-model.md §5.1 for the full detail.

A **branch** is a named, mutable pointer: `branches`: `id`, `org_id`, `model_id`, `name`, `kind` (`main`/`change`/`capture_draft`), `base_commit_id`, `head_commit_id`, `status` (`draft`/`proposed`/`in_review`/`approved`/`merged`/`rejected`/`archived`), `created_by`.

A **tag** is an immutable, never-moved pointer, and is how "version" is implemented: `tags`: `id`, `org_id`, `model_id`, `name`, `commit_id` (must resolve to a commit on `main`), `created_by`, `created_at`. A tag row is insert-only — there is no update or delete path — and it does **not** duplicate the landscape's state; it points at a commit, and the materialised state at that commit is computed as described in ADR-003.

Because a merge commit has two parents, a delta authored on a change branch and "the same delta as it appears on main after merge" are the identical row — main's ancestry simply now includes it. No delta is ever copied or rewritten to migrate it from branch to main.

**Alternatives rejected.**
- *JSON Patch (RFC 6902) as the persisted format* — patch operations are path-context-free; they can't carry per-fact provenance/confidence without an ad-hoc wrapper, and "show every fact ever recorded about System X" requires replaying every op rather than a plain query. Diff-style JSON Patch is fine as a *transient, computed* representation for a UI diff view, never as storage.
- *A single mutable "current state" table with an audit log bolted on* — makes deltas second-class, and branches (which are the product's actual wedge) become awkward to represent as first-class diffable objects.
- *Literal git storage* (real git blobs/trees under the hood) — optimised for text files, not typed relational facts; cross-branch, cross-tenant queries and RLS (ADR-009) are native to Postgres and not to git. The vocabulary is deliberately git-shaped; the persistence is not.

**Consequences.** History is append-only — nothing is ever hard-deleted, which is a strength for audit but means storage grows monotonically forever; a retention/compaction policy is a real future need but is explicitly out of scope here (flagged, not designed).

---

## ADR-003: Materialised head — rebuild and validation

**Context.** "Main" has to always be a valid landscape — every other branch forks from it, and every view renders from it. Replaying the entire delta history from genesis on every read doesn't scale once a landscape has thousands of deltas.

**Decision.** Maintain a materialised projection — `landscape_elements`, `landscape_relationships` — but only persist it as a cache at commits that matter: the current head of `main`, and the head of every open branch. A snapshot is taken automatically whenever a tag is created and whenever `main`'s head advances, so replaying any historical or arbitrary commit only has to walk deltas back to the nearest prior snapshot, never to genesis.

Before a commit can become the new `main` head (i.e. as the last step of a merge, ADR-006), it must pass a validation gate:
1. **Schema validation** — every element's attributes satisfy the active `type_schemas` entry for its type.
2. **Referential integrity** — every relationship's endpoints and every structural `parent_*_id` reference an existing, non-retired, correctly-typed element.
3. **Relationship rules** — every relationship's (type, source type, target type) triple exists in `relationship_type_rules`, and cardinality limits hold.
4. **Acyclicity** — no cycles in any `parent_*_id` chain.
5. **Identity integrity** — no retracted/merged-away id reappears as if live (checked against the `merges` table, ADR-008).

A commit that fails is blocked from merging and stays on its own branch with the failing checks surfaced to its author. `main`'s head is therefore guaranteed valid at all times — validation is a merge gate, never a background cleanup job.

**Alternatives rejected.**
- *Validate only at read time, best-effort* — `main` is the shared source of truth every other branch and view depends on; letting it go invalid even briefly propagates the problem everywhere.
- *Full graph re-validation on every single delta write* — too slow for interactive review, where a person is toggling many proposed deltas before submitting.

**Consequences.** Merging has real latency (replay + validate), so it is a reviewed, slightly-asynchronous action rather than an instant flip — which fits naturally with the review queue in ADR-006. The rebuild function must be pure and deterministic (same deltas in, same materialised state out) so the review queue's "preview" step and the actual merge step can share one implementation.

---

## ADR-004: Capture pipeline lands as draft branches

**Context.** Spreadsheets, PDFs, and text need to produce proposed deltas without either forcing a human to pre-decide "which change is this for," or letting AI-produced facts touch `main` unreviewed.

**Decision.** Every capture run creates a branch of kind `capture_draft` (`base_commit_id` = `main`'s head at run time), containing one `capture`-kind commit whose deltas all carry `source` = the ingestion job id, `source_ref` = the document/page/cell locator, and a `confidence` score. `capture_jobs`: `id`, `org_id`, `model_id`, `input_type` (`spreadsheet`/`pdf`/`text`), `input_ref`, `status` (`pending`/`parsed`/`reviewed`/`discarded`), `resulting_branch_id`, `created_by`.

A `capture_draft` branch is never merge-eligible directly. A human triages it: discard individual deltas, promote accepted ones into a change branch (new or existing — this creates new deltas whose source references the human review as corroboration, without overwriting the original capture provenance, per ADR-007), or discard the whole branch.

**Alternatives rejected.**
- *Write capture output straight into a change branch chosen up front* — forces the user to name "which change" before they've seen what was extracted, when a capture run is often change-agnostic (e.g. "digitise this old spreadsheet").
- *Write capture output straight to main behind a "needs review" flag* — reintroduces an invalid/unreviewed `main`, which ADR-003 exists specifically to rule out.

**Consequences.** The review queue (ADR-006) has two distinct kinds of inbound work — architect-proposed change branches, reviewed as a whole design, and capture-pipeline drafts, reviewed delta-by-delta — and the UI needs to treat them differently rather than as one generic "pending branch" list.

---

## ADR-005: To-be composition

**Context.** A change branch's to-be view is straightforward (base landscape folded with the branch's own deltas). "All approved branches composed together" is a materially harder problem the brief correctly defers, but the schema shouldn't need to change when it's tackled.

**Decision.** V1 ships single-branch to-be only: a branch's as-is view is the materialised state at its `base_commit_id`; its to-be view is that state folded with its own deltas. No schema work is needed later to support multi-branch composition, because composition is a read-time query over existing `deltas`/`branches` rows, not a new storage shape.

When multi-branch composition is built, **conflict** is defined as one of three classes, distinguished because they need different resolutions: (a) **field conflict** — two branches assert different values for the same (`subject_id`, `attribute`) that both diverge from the same shared base value; (b) **structural conflict** — one branch retires or reparents an element that another branch adds a relationship to; (c) **identity conflict** — two branches independently create what later turns out to be the same real-world thing (resolved through ADR-008's merge mechanism after the fact, not at composition time). Composing multiple approved branches is read-only and advisory (a preview, not something that can itself be committed) until conflict-resolution UX and cross-branch identity merging exist.

**Alternatives rejected.**
- *Auto-merge all approved branches nightly into a "consensus to-be"* — silently resolves exactly the kind of disagreement the product exists to surface and record a decision about.
- *Require branches to be sequential/rebased on each other* — defeats the point of letting several in-flight changes exist in parallel, which is the actual reason composition is wanted.

**Consequences.** Product copy should say "this change's to-be view," singular and branch-scoped, and avoid implying a combined future-state view exists until multi-branch composition actually ships.

**Amendment (Sprint C1): `base_commit_id` moves on refresh.** This decision's original phrasing — "a branch's as-is view is the materialised state at its `base_commit_id`" — read as if `base_commit_id` were fixed forever at the branch's original fork point. It isn't: `head(mergeBase(B))` is what actually governs the As-is view (SPEC §7.1's `mergeBase`, UI-principles §6.2), and once refresh/rebase exists (Sprint C1), a branch's fork point and its current merge base are no longer always the same commit. The two are reconciled, not left to diverge: `base_commit_id` is fixed *between* refreshes, not forever — a refresh (ADR-006, SPEC §7.5) moves it to `main`'s head at the moment it succeeds, so `base_commit_id` continues to equal `mergeBase(B)` and folding at it remains a correct, O(1) way to compute As-is, with no DAG walk needed on every read. The original fork point is not lost, but it is not a stored field or a selectable view either — it stays discoverable only via commit ancestry, as the parent of the branch's first own commit. See SPEC §1 S-11 for the matching schema-level statement.

---

## ADR-006: Merge review queue

**Context.** Delivered changes need to move from a branch into `main` through review, not by direct write.

**Decision.** Requesting a merge creates a row in `merge_requests`: `id`, `branch_id`, `base_commit_id` (captured at request time), `requested_by`, `requested_at`, `status` (`pending`/`changes_requested`/`approved`/`merged`/`rejected`), `reviewed_by`, `reviewed_at`, `review_notes`. Merge is only possible once: the request is `approved`; `base_commit_id` is still an ancestor of `main`'s current head (otherwise the requester must refresh/rebase — see below); and ADR-003's rebuild-and-validate passes on the replayed result. Merging creates a `merge`-kind commit on `main` (parent = `main`'s previous head, `merged_branch_head_commit_id` = the branch's head) — the branch's own deltas are not copied, per ADR-002. The branch then becomes `merged` and read-only, never deleted, so its own as-is/to-be history stays queryable exactly as it looked when reviewed. Only Architect/Owner roles (ADR-009) can move a request to `approved` or `merged`. A request sent back to `changes_requested` (`request_changes`, branch reopened to `draft`) returns to `pending` via `atlas.resubmit_merge_request` (Sprint C1 step 7, `supabase/migrations/20260906162000_resubmit_merge_request.sql`) once the requester has addressed it — an update to the *same* `merge_requests` row (with a refreshed cached classification, SPEC §7.4: "cached at request and at each refresh"), not a second `submit_merge_request` insert, which the partial unique index on `(branch_id)` for an in-flight status would reject anyway.

**Alternatives rejected.**
- *Rewrite the branch's deltas' commit reference in place at merge time* — falsifies the branch's own immutable history, which stakeholders or a linked decision (ADR-013) may already cite.
- *Fast-forward with no merge commit* — loses the explicit "this reviewed change, by whom, on what date, became reality" marker the whole product is meant to preserve.

**Consequences.** "Your branch is behind `main`, please refresh" is a real, expected UX state, not an edge case — the product should show the requester what changed on `main` since they branched, using the two-way (branch vs. main) case of ADR-005's conflict taxonomy, which is simpler than full N-branch composition and should ship in v1 even though general composition doesn't.

**Amendment (Sprint C1): partial delivery is a split branch, not a partial merge commit.** ADR-002's merge-commit model is all-or-nothing — a merge commit's second parent is the whole branch head, so there is no mechanic for merging "some but not all" of a branch's own deltas in one merge commit. Rather than weaken that append-only guarantee, per-element accept/skip in the review queue is defined as follows:

1. Accepting a subset of a branch's elements/relationships in the review queue moves that accepted set into a **new** branch (`kind = 'change'`, `status = 'approved'`, `split_from` = the original branch's id, same target date as the original), which is then merged whole, in the same review action, using the ordinary all-or-nothing merge of ADR-006. The remainder — everything not accepted — stays on the original branch, whose own `status` is unchanged (still `proposed`/`in_review` as appropriate; it is not implicitly closed by a partial acceptance).
2. The split respects dependencies, computed before it is offered for confirmation: accepting a relationship whose endpoint is an unaccepted new element pulls that element into the split too, and the review queue shows this pulled-in closure before the reviewer confirms. Retracting an element that other, unaccepted deltas on the branch still depend on is blocked, with the dependency named as the reason, rather than silently splitting it away.
3. The change page (UI-principles) treats an original branch and every branch it has been split into as **one logical change**, shown as a single item with a "delivered / remaining" breakdown (what has merged via its splits, what is still open on the original branch); the roadmap view does the same — a split is bookkeeping for partial delivery, not a second change for a stakeholder to track.
4. `branches.split_from` (nullable, → `branches.id`) records this lineage; see SPEC §3.4 for the column and §1 for the corresponding decision entry.

**Alternatives rejected (amendment).**
- *A merge commit that cherry-picks a subset of the branch's own deltas* — falsifies the branch's own append-only history (ADR-002) by making its merged form disagree with what it actually contained when reviewed.
- *Two-phase commit that edits the original branch's deltas after acceptance* — deltas are never mutated post-hoc (ADR-002); a split branch is a new set of pointers over the same immutable delta rows, not a rewrite.

**Amendment (Sprint C2b, ADR-021 — `docs/ADR-021-structural-conflict-resolution.md`): how structural conflicts are resolved, and how a merge commit folds.** Two things this ADR's refresh/merge wording assumed turned out not to hold once structural conflicts were built for (issue #76): a resolution recorded in a later commit can never protect an earlier conflicting delta from the replay in SPEC §6.2's `fold`, on either side — and the final merge on `main` is the fold that is hashed. ADR-021 decides (1) a merge commit whose first parent is an ancestor of its second parent folds to the second parent's state (invariant C19; the merge commit itself stays, exactly as this ADR requires — only its fold rule changes), landing on its own before Sprints 7i–7k; and (2) a refresh is "prepare, replay, decide": an optional `preparation`-kind commit (new `commit_kind`, C18) makes main's replay applicable, then the `merge` commit carries the reviewer's decision deltas and the `resolved_conflicts` rows, written atomically by `atlas.refresh_branch`. The four actions §7.4 names (keep-retraction / keep-element with cascade, duplicate survivor, cardinality primary) have their exact delta sequences in ADR-021 §4.

---

## ADR-007: Provenance is fact-level

**Context.** Provenance has to answer "where did this specific field's value come from, and how confident are we," not just "where did this element come from" — the brief is explicit that element-level provenance is the wrong grain, and it's right.

**Decision.** Provenance (`source`, `source_ref`, `effective_date`, `confidence`, `created_by`) lives on the `deltas` row (ADR-002), never on the element/relationship row — an element accumulates facts from many sources over time (name from an interview, vendor from a spreadsheet, lifecycle status from a later email), each needing its own trail. The "current" provenance of a field is simply the provenance of its most recent non-retracted delta — always derivable, never duplicated onto the materialised row (which may cache a `source_delta_id` pointer per field for cheap display, but never the provenance fields themselves).

**Supersession** happens by reference, not overwrite: a new delta on the same (`subject_id`, `attribute`) sets `previous_delta_id` back to the fact it replaces; the prior delta is never edited or deleted, so "what did we believe about System X's vendor in March 2024, and from where" stays answerable forever.

**Conflict surfacing:** when two facts about the same (`subject_id`, `attribute`) disagree with no obvious time-ordering (e.g. two capture jobs disagree on the same day, or a capture draft's proposed value disagrees with `main`'s current value), the review/triage UI shows both, with sources and confidences, rather than silently picking one. A human's resolution becomes a new delta with `source` = "human decision," recorded in `resolved_conflicts`: `winning_delta_id`, `discarded_delta_id`, `resolved_by`, `resolved_at`, `rationale`.

**Alternatives rejected.**
- *Element-level provenance (one source/confidence per element)* — hides exactly the kind of per-field disagreement (a stale spreadsheet vendor field vs. an up-to-date interview) the product exists to catch; this is the brief's own stated failure mode of existing tools.
- *Last-write-wins with no conflict surfacing* — silent overwrite is the "decay" pattern named in the brief's thesis.

**Consequences.** Every UI surface that shows an attribute value needs a per-field provenance affordance (source, date, confidence on hover/expand), not one metadata panel per element — a real UI cost, but the core value proposition.

---

## ADR-008: Identity and merging

**Context.** Capture pipelines will see the same real-world thing under different names across different documents; the product has to converge on one stable identity per thing without ever falsifying what was recorded at the time.

**Decision.** `elements.id` / `relationships.id` are server-generated UUIDs, assigned once, never reused even after retirement. `element_aliases`: `id`, `element_id`, `alias_value`, `alias_type` (`name`/`code`/`external_ref`/`source_system_key`/`merged_id`), `source`, `confidence`, `created_at` — populated both manually ("also known as") and automatically (the capture pipeline records the exact string it matched, even on a confident match, so future documents using that string match instantly without re-running fuzzy logic).

Capture matching strategy, in order, stopping at the first hit above threshold:
1. **Exact id** — the source document already carries an Atlas id (e.g. a round-tripped export).
2. **Alias exact match** — a normalised token matches an existing `alias_value`.
3. **Name + context** — fuzzy name similarity above a threshold, *and* matching type, *and* matching structural context (same parent capability/system) — context is required, not optional, specifically so "Portal" the system doesn't match "Portal" the container under an unrelated system.
4. **No match** → propose a new element. Never silently create — a capture-draft `create` delta is exactly this case, always human-reviewed (ADR-004).

`merges`: `id`, `org_id`, `model_id`, `surviving_element_id`, `merged_element_id`, `decided_by`, `decided_at`, `rationale`, `evidence_ref` (nullable). On merge, `merged_element_id`'s own row is retired (not deleted); every existing relationship and delta that referenced it is left untouched, because rewriting them would falsify what a past commit — or an already-cited tagged version — actually said. Instead `merged_element_id` becomes a permanent alias (`alias_type = merged_id`) of `surviving_element_id`, and every lookup path (materialisation, search, relationship-rule checks) resolves ids through the alias table, so the two ids behave as one from that point on.

**Alternatives rejected.**
- *Rewriting historical rows to point at the surviving id* — falsifies history and any already-cited tagged version.
- *Fully automatic merge above a confidence threshold, no human step* — identity merges are exactly the kind of judgement call the product wants recorded with a rationale, not hidden.

**Consequences.** "Resolve through the alias table" has to be one shared function/view used everywhere an element is looked up by id — if any code path looks elements up directly instead, the alias table becomes decorative. This is an implementation-discipline risk worth calling out now, not a schema risk.

---

## ADR-009: Tenancy and access

**Context.** Multi-organisation, multi-role access, sized realistically for one-or-two-architect teams, with occasional need to share a specific version outside the organisation (e.g. an FOI request, an external auditor).

**Decision.** Every model-bearing table carries `organisation_id`; Postgres row-level security policies scope all reads/writes to the caller's organisation membership, enforced at the database layer as defense in depth, not only in application code. `organisation_members`: `org_id`, `user_id`, `role`, `invited_by`, `joined_at`.

Four roles, chosen to degrade gracefully for a one-person team: **Owner** (org/billing admin, implicitly also Architect), **Architect** (read-write on all model content; can approve merge requests and create tags/versions), **Contributor** (can create/edit change branches, run captures, comment; cannot merge to `main` or create tags), **Viewer** (read-only on `main` and on any tag/version, and on to-be views of branches explicitly marked shared-for-review; cannot see draft change branches or `capture_draft` branches, and sees a comment only when its own anchor is visible to them — ADR-010's Sprint M1a amendment dropped the separate internal/team visibility split this row originally named). A solo architect simply holds Owner+Architect on their own org — the model has to work with one person holding every right, not assume separation of duties (Preface #7).

Cross-organisation sharing of a specific version is a distinct grant, not a change to `organisation_id`: `model_shares`: `id`, `model_id`, `tag_id` (nullable — null means "always current `main`," set means "this version only"), `shared_with_org_id`, `permission` (`view_only`), `expires_at` (nullable), `created_by`. RLS policies allow access when `organisation_id` matches the caller's org **or** a matching non-expired `model_shares` row exists.

**Alternatives rejected.**
- *Application-layer-only tenancy checks* — one missed `WHERE` clause in one endpoint leaks across organisations; RLS makes the database the enforcement point of last resort.
- *A single "shared" boolean on models* — can't express "share only this tagged version, not live drafts," which is exactly the audit/FOI use case public-sector customers need.

**Consequences.** Every new table added to the product must get `organisation_id` and an RLS policy on day one — worth a lint rule or migration checklist, not a one-off decision each time.

**Amended (Sprint M1a, `atlas.profiles`, `supabase/migrations/20260906230000_profiles.sql`).** This ADR's tenancy model has always let one member see another exists (`members`), but nothing ever let one member see anything *about* another — no display name, no avatar, nothing beyond a bare `user_id`. `atlas.profiles` (`user_id` pk, `display_name`, a global lowercase `handle` defaulted from the email's local part at first membership, `avatar_url`) is the first table that changes that, and it is deliberately narrow: readable by any fellow org member regardless of role, editable by its own user only, and — the load-bearing constraint — **carries no email column and never will**. A handle derived once from an email at signup is not a standing channel back to that email; nothing in this schema, this table included, ever hands a member's real address to another member. This is the identity primitive @mentions (ADR-010's Sprint M1a amendment) reads; a member directory or invite UI built on top of it is explicitly deferred (SPEC §11, target U4) — this amendment is the data shape, not the screen.

**Amended (Sprint 7j item 1, model archive/delete, `supabase/migrations/20260911040000_model_archive.sql`).** Model lifecycle management this ADR never covered. `models.archived_at` (nullable timestamp) is soft: an owner or architect can set it (`atlas.archive_model`) or, owner only, clear it (`atlas.restore_model`) — narrower than archive, since undoing a hide is a bigger claim than making one. Archiving changes nothing about the model's own content, cascades nothing, and hides it only from `listModelsForOrg`'s ordinary list and `OrgHome.tsx`'s own display — a direct link to an archived model still resolves, read-only, for anyone who could already see it; RLS on `models` itself is unchanged. Delete (`atlas.delete_model`, owner only, only when `archived_at` is set — checked inside the function, not left to RLS) is hard: it removes the model and every row scoped to it across the tables the real FK graph touches (commits, deltas, branches, tags, sources, aliases, facts, `elements_head`/`relationships_head`, views and their layouts/annotations, merge_requests, resolved_conflicts, comments and their mentions/notifications), in dependency order, after nulling every self-referencing or cross-table column that would otherwise make that order impossible to express (the function's own comment has the full table-by-table reasoning — of everything with a `model_id` foreign key to `models`, only `branches` itself was ever declared `on delete cascade`; nothing else is, and several of the rest are self-referencing). `models_update`'s and `models_delete`'s own grants are narrowed to specific columns (`name`/`slug`/`description`) and revoked entirely, respectively, so `archived_at` and a model's actual removal are reachable only through these two functions, never a raw client write.

The member-directory/invite-UI deferral above is still open — targeted at Sprint 7j item 2/3 (a separate PR from this one), not closed by this amendment.

**Amended (Sprint 7j item 2, organisation settings, `supabase/migrations/20260911050000_organisation_settings.sql`).** Closes the member-directory half of the deferral just above (SPEC §11's row is updated to match; invite-by-email is still open, targeted at Sprint 7j item 4). `organisations_update`'s and `members_update`'s blanket grants are narrowed the same way the previous amendment narrowed `models`': `organisations` to `name`/`slug` only (never `created_by`/`created_at`), `members` to `role` only (never `org_id`/`user_id`/`invited_by`/`joined_at` — identity and history, not settings). `organisations_delete`'s blanket grant is revoked entirely; the only path left is `atlas.delete_organisation` (owner only, checked inside the function ahead of a `models` row count — refuses with a structured `{status:'has_models', count}` rather than a raw foreign-key error when the organisation still has models, matching `atlas.delete_model`'s own "route destructive actions through one function" convention). No RLS changes: `atlas.guard_last_owner` (pre-existing, this ADR's own §3.2) already fully enforces that an organisation always keeps at least one owner, on both a role-changing `members` update and a `members` delete — this sprint adds no new server-side rule there, only a settings screen (`/o/:org/settings`, `src/ui/orgs/OrganisationSettingsView.tsx`) that lets an owner trigger the update/delete the trigger was already guarding, and surfaces its refusal as a visible error rather than a silent failure.

**Amended (Sprint 7j item 4, invite by email, `supabase/migrations/20260911060000_invites.sql`).** Closes the member-directory/invite-UI deferral in full (SPEC §11's row is fully closed to match). `invites` (`id`, `org_id`, a lowercase-normalised `email`, `role`, `invited_by`, `created_at`, nullable `consumed_at`/`consumed_by`) is owner-only to create/view/revoke (RLS mirrors `members_insert`/`members_select`/`members_delete` exactly), with a partial unique index refusing a second *pending* invite to the same email at the same org — a resend, not a new row, surfaced by `createInvite` as `{status:'already_pending'}` rather than a raw conflict. No email is ever sent (this product has no email-sending mechanism anywhere, and `atlas.profiles`' own amendment above is explicit that it never will just to expose one); an invite is consumed automatically the moment the invited email establishes a session, by whichever of two paths applies. `atlas.consume_invites_for_new_user` fires `after insert on auth.users` — the first trigger in this schema on `auth.users` itself, rather than on a `public`/`atlas` table the way every earlier trigger (`atlas.profiles`' own `atlas.ensure_profile` included, which fires on `members` insert, not `auth.users`) does; flagged here as a real schema addition, not a shortcut, per this sprint's own plan. That trigger alone only covers a fresh signup, though: an invite sent to an email that *already has an account* would otherwise sit unconsumed forever, since `auth.users` insert fires exactly once, at that account's original signup, long before such an invite could exist. `atlas.consume_my_invites` — a thin, `security definer` RPC wrapping the same shared `atlas.consume_invites_for_user` worker, called against the now-authenticated `auth.uid()` rather than a client-supplied email — closes that gap; `AuthProvider.tsx` calls it once on every real `'SIGNED_IN'` event (not a token refresh). This second path is genuinely new beyond the plan's own literal wording (which named only the signup trigger) — recorded here as a small, clearly-scoped extension rather than an unrecorded decision, since without it "invite someone who already uses Atlas" would silently do nothing.

---

## ADR-010: Comments

**Context.** Comments need to anchor to anything in the model, thread, resolve without disappearing, and survive a merge without needing special re-anchoring logic.

**Decision.** `comment_anchors`: `comment_id`, `anchor_type` (`element`/`relationship`/`delta`/`branch`/`decision`), `anchor_id` — one anchor per comment. `comments`: `id`, `org_id`, `model_id`, `parent_comment_id` (nullable — flat reply chain, no deeper nesting, matching the small-taxonomy philosophy for this feature too), `author`, `body`, `visibility` (`team`/`internal` — internal is hidden from Viewer per ADR-009), `status` (`open`/`resolved`), `resolved_by`, `resolved_at`, `created_at`.

**Resolution** never deletes or hides a thread (aside from the Viewer visibility rule) — it's a reversible status, fully visible in history.

**Survival across merges** falls out of ADR-002/008 for free: a comment anchored to an `element_id` or `relationship_id` survives because those ids never change; a comment anchored to a `delta_id` on a change branch survives a merge with zero re-anchoring logic, because a merge commit incorporates the branch's existing delta rows by ancestry (ADR-002's two-parent commit model) rather than copying them — the delta the comment points at is the same row before and after merge.

**Alternatives rejected.**
- *Anchor comments to (view_id, x, y) diagram coordinates* — coordinates are layout (ADR-011), which is explicitly non-authoritative and can be regenerated at any time; a comment anchored only to a point that can vanish on re-layout is fragile. An optional coordinate *hint* for where to visually pin a comment on a given view is fine; the real anchor is always a model object.

**Consequences.** `comment_anchors.anchor_id` is polymorphic and Postgres can't natively foreign-key it — needs either a per-`anchor_type` check constraint or a trigger to keep it honest; an implementation detail to settle later, not a blocker here.

**Amended (Sprint M1a — `supabase/migrations/20260906240000_comments.sql`, SPEC §3.8/§9.4).** What actually shipped diverges from this decision in four ways, each a real, considered change rather than a drift: (1) no separate `comment_anchors` table — `anchor_type`/`anchor_id` are inline columns on `comments` itself (S-16, recorded when the capability-maps ADR claimed the ADR-012 number this draft had reserved); (2) `anchor_type`'s values become `element`/`relationship`/`change`/`decision`/`version` — `branch` renamed `change`, `delta` dropped with no replacement yet (so the attribute-level "comment on this value" anchor UI-principles §7.1 describes isn't reachable until one lands), `version` added (anchors to a `tags` row — this product's "version," ADR-002); (3) `visibility` (`team`/`internal`) is dropped for now — no product need for an internal-only comment has shown up, and re-adding it later is a column, not a redesign; (4) **@mentions and their notifications** (this ADR never covered either): `comment_mentions` (`comment_id`, `user_id`) and `notifications` (`user_id`, `kind`, `comment_id`, `read_at`) are written together, atomically, by trigger `atlas.process_comment_mentions` parsing `@handle` out of a comment's body against `atlas.profiles.handle` (ADR-009's Sprint M1a amendment) — in-app only, no email, one notification per resolved fellow-org member, none for the author's own handle. Resolve permissions also narrow past this ADR's original text: an owner/architect resolves any thread, but so does a contributor, for a thread *they themselves started* — SPEC §9.4 has the enforcement (`atlas.guard_comment_update`).

---

## ADR-011: Diagrams are derived views; layout is a hint

**Context.** The thesis is explicit: no view is hand-drawn, and diagrams decay into stale, disconnected pictures in every incumbent tool. Positions have to be preserved for usability without becoming a second source of truth.

**Decision.** A **view** is a saved query, not a saved drawing. `views`: `id`, `model_id`, `kind` (`landscape`/`context`/`container`/`component`/`capability_map`), `scope_element_id` (nullable — e.g. which System a container view is "for"), `branch_id` (which branch's folded state to render; defaults to `main`'s head), `created_by`, `name`. Rendering runs the scope+kind query against the chosen branch's materialised state (ADR-003) and lays it out; no view stores its own node/edge list. `capability_map` renders the model's own capability elements and their `supports` edges — it is a fifth view kind alongside the other four, not the separate versioned starter-content concept in SPEC §3.10 (ADR-012), which only ever seeds elements for a view to later render.

`view_layouts`: `view_id`, `element_id` (or `relationship_id` for edge routing), `x`, `y`, optional bend points — purely a rendering hint. The litmus test for whether something belongs here: deleting every `view_layouts` row for a view and re-running the auto-layout must be lossless. If losing it would change what the organisation knows, it isn't a layout hint and doesn't belong in this table.

Free-form annotation (callouts, highlights, arrows drawn directly on a diagram for a stakeholder presentation) is a real, common ask and is supported deliberately: `view_annotations`: `view_id`, `kind` (`text`/`highlight`/`arrow`), `geometry`, `text`, `created_by` — explicitly and permanently presentational, never contributes a fact, never appears in a "the model" export, and rendered with a visually distinct style (e.g. a sticky-note affordance) so it's never mistaken for a recorded fact.

**Alternatives rejected.**
- *Let dragging one box onto another on a diagram create a relationship* — conflates a drag gesture with a reviewed fact. May return later as a UI fast-path, but it would still create an ordinary delta for review, not write the model directly from the canvas.
- *No annotation support at all* — too austere for a real presentation use case; the risk of confusion is manageable through clear visual separation instead.

**Consequences.** Any export/print of a view needs to visually distinguish generated content from annotations (e.g. a legend or watermark), so a printed diagram cited in a decision (ADR-013) can't be mistaken for more authoritative than it is.

---

## ADR-012: Capability maps as versioned starter content

**Context.** Sector starter maps need their own versioning and provenance, independent of any one organisation's model, and tailoring them shouldn't sever the link back to the source.

**Decision.** `capability_map_templates`: `id`, `sector` (one of `src/contracts/capabilityMapContent.ts`'s `SECTORS` — `local_government_scotland`, `local_government_england`, `nhs`, `housing`, `hei`, `public_body`, `utility`, `electricity_network`; the list lives in the contract, not a database CHECK, per ADR-001's taxonomy-in-code — amended from the original five, where `local_government` was Scottish-authority-shaped and is now a deprecated alias for `local_government_scotland`, and `generic` was renamed `public_body`), `version`, `published_at`, `source_description`, `status` (`draft`/`published`/`deprecated`). `capability_map_template_items`: `id`, `template_id`, `code`, `name`, `description`, `level`, `parent_code` (nullable).

Applying a template to an organisation's model is a `template_seed`-kind commit whose deltas are ordinary `create` deltas with `source = template:{template_id}:{version}` and `confidence = high` — a curated reference, not an AI guess, but still an ordinary, auditable fact per ADR-007, not a special-cased import path.

**Tailoring** proceeds as ordinary edits (rename/add/retire/re-parent), but a rename preserves the original template code as an `element_aliases` row (`alias_type = template_code`) rather than overwriting it, so a later template version can still be matched back against this org's (renamed) capability.

**Template upgrades** never touch an org's model automatically. An org can request a diff between the template version they have and a newer one (matched through the alias table), and, if accepted, apply it as an ordinary proposed change branch through the same review queue as any other change (ADR-006) — never a silent overwrite.

**Provenance of the map itself** lives on `capability_map_templates.source_description`, with an optional `capability_map_template_sources`: `template_id`, `citation`, `url`, `reviewed_by`, `reviewed_at` for sector bodies that need to cite the actual reference frameworks and reviewers behind a starter map — public-sector procurement will ask "where did this taxonomy come from," and the answer needs to be a citation, not "the AI produced it."

**Alternatives rejected.**
- *Hard-coding starter maps into application code* — they need independent versioning, review, and citation on a different cadence than the product's release cycle.
- *Copying template items into an org's model with no reference back* — makes future template upgrades, and "why do we have this capability," unanswerable.

**Consequences.** Template content becomes a maintained content product in its own right, likely owned by a domain expert rather than engineering — an organisational consequence, not just a schema one.

---

## ADR-013: Decisions and evidence

**Context.** The brief's own thesis names "decisions with arguments" as part of the wedge, and requires decisions linked to changes, elements, assumptions, and evidence — not on the "cover at minimum" list, but too central to the differentiation to leave unaddressed.

**Decision.** `decisions`: `id`, `org_id`, `model_id`, `title`, `statement`, `status` (`proposed`/`accepted`/`superseded`/`rejected`), `decided_by`, `decided_at`, `branch_id` (nullable — the change branch this decision governs, if any), `superseded_decision_id` (nullable — a decision is never deleted, only superseded, matching the append-only discipline everywhere else in this document).

`decision_arguments`: `id`, `decision_id`, `stance` (`for`/`against`/`neutral`), `body`, `author`, `created_at` — a lightweight structured pro/con list, so a decision's rationale is scannable rather than archaeology through a comment thread.

`decision_links` (polymorphic, mirroring `comment_anchors` in ADR-010): `decision_id`, `linked_type` (`element`/`relationship`/`change_branch`/`assumption`/`evidence`), `linked_id`.

`assumptions`: `id`, `model_id`, `statement`, `confidence`, `status` (`open`/`validated`/`invalidated`), `owner`, `created_at` — first-class and independent of any one decision (an assumption can be linked from several decisions; when its status changes, e.g. it's later invalidated, the linked decisions get a re-review nudge rather than being silently marked wrong).

`evidence`: `id`, `model_id`, `kind` (`document`/`link`/`capture_job_ref`/`comment_ref`), `pointer`, `description`, `added_by`, `added_at`.

**Alternatives rejected.**
- *Fold decisions into comments (a "pinned thread" is a decision)* — decisions need their own status lifecycle and typed links to assumptions/evidence that a comment thread doesn't model well; conflating them would make comments heavier than ADR-010 wants and decisions lighter than the brief's thesis wants.
- *Treat assumptions as just another decision argument* — assumptions need an independent lifecycle, revisitable even before any decision built on them is finalised.

**Consequences.** This is the least-specified area of the brief relative to its stated importance. What's fixed here is only the data shape needed so nothing built for changes, comments, or provenance has to change later; the workflow (what "closing" a decision looks like, what a re-review nudge actually does) needs its own follow-up ADR once the UI is designed.

---

## ADR-014: Package boundary with the existing suite

**Context.** Atlas reuses a sibling suite's philosophy (small taxonomies, no scope creep, AI-assisted capture with human review) and some of its infrastructure, but is a separate product. The boundary needs to be drawn without either duplicating real infrastructure or prematurely generalising Atlas-specific domain logic.

**Decision.** Extract into a shared package only what is genuinely domain-agnostic:
- **Graph editor primitives** — node/edge rendering surface, pan/zoom/selection, a layout algorithm wrapper. The layout algorithm has no notion of "capability."
- **Schema validation and versioning** — the generic mechanism of "a jsonb payload validated against a named, versioned schema" (the `type_schemas` idea from ADR-001) is infrastructure; the actual field definitions for Capability/System/Container/etc. are not.
- **Versioning/delta engine primitives** — the generic commit/branch/tag/replay-and-validate mechanics (ADR-002/003), parameterised over "what is a delta, how is one folded." If the existing suite has any notion of drafts or history, this is likely reusable as-is; if it doesn't yet, build it here first and extract once a second real consumer exists rather than generalising speculatively.
- **LLM proxy** — provider auth, rate limiting, per-organisation cost attribution, prompt/response logging for audit. None of this is EA-specific, and the existing suite's own AI-assisted capture is an obvious second consumer *today*, not a hypothetical future one — recommend extracting this immediately rather than waiting, unlike the graph/versioning primitives above.

**Not extracted** — stays in this product: the taxonomy itself (element/relationship types, attribute schemas, `relationship_type_rules` content); the RLS/organisation/roles model (even if the suite has its own organisations, merging tenancy models is a materially bigger and riskier decision than sharing UI/infra primitives, and shouldn't be smuggled into this ADR — see the open question below); capture-pipeline prompts and extraction logic (tuned to this taxonomy, not reusable as-is even where the LLM proxy underneath is shared); and the review-queue, decisions, comments, and capability-map-template features, all of which are product-specific.

**Alternatives rejected.**
- *Extract everything speculatively before Atlas ships anything* — guarantees the shared package's API is designed against zero real usage.
- *Keep everything in-product and duplicate later if needed* — the right default for most of the list above, but not for the LLM proxy, where the duplication cost is already obvious and immediate.

**Consequences.** ~~This ADR leaves one question genuinely open: whether Atlas shares the existing suite's tenancy/identity tables or has entirely its own. Answering it needs facts about the existing suite's actual schema that this document's authoring session doesn't have access to. It should be the first follow-up ADR, resolved **before** the ADR-009 organisation/RLS tables are actually implemented — retrofitting a shared-vs-separate identity model after real tenant data exists is expensive.~~ **Closed by ADR-017 (the first follow-up ADR this paragraph called for): separate, permanently.** By the time ADR-017 was written, the ADR-009 tables already existed with real tenant data — the "before it's expensive" window named above had already passed, but separate is also what ADR-017 found already true in practice (two distinct Supabase projects, confirmed by docs/AUDIT-2026-09-U2.md's live inspection), so nothing needed retrofitting.

---

## ADR-015: Head materialisation is a security-definer function, not application code or a SQL reimplementation of fold

**Context.** `elements_head`, `relationships_head`, and `facts` (ADR-003, ADR-007) are materialised projections: something has to run the fold algorithm (SPEC §6) and write the result whenever a commit lands, and that "something" was never actually built in Sprint F1 — its migrations created these tables with no insert/update/delete grant for `authenticated` at all, correctly anticipating that populating them "means running the fold algorithm, which belongs to src/engine, not to a migration or a client's own judgement" (the projections migration's own words), but nothing was ever added to do that running. Sprint U1's editing step (step 5) needed this fixed first, and needed it before the element page (step 3) could show anything real.

**Decision.** `atlas.commit_deltas` (`supabase/migrations/20260906090000_facts_and_commit_deltas.sql`) is now the one place a commit is written. It is `security definer`, taking over a role the plain `commits`/`branches` RLS policies deliberately never granted an ordinary session: advancing `main` directly. (`commits_insert`'s policy from Sprint F1 step 2 requires `branch.kind = 'change'` and a `draft` status — main was never a legal target for a direct client insert, on the assumption that only a future `atlas.merge_branch`/`atlas.seed_from_map` would advance it, per SPEC §5.3's "who writes commits" table.)

This is a **permanent** product decision, not a stopgap for the sprint that happens to have no branch UI yet: **a contributor never commits to main, whether or not a branch/review-queue UI exists; owner/architect may, always.** `commit_deltas` re-derives this from `auth.uid()` itself — branch-kind-dependent (`owner`/`architect` only when the target is `main`; `owner`/`architect`/`contributor`, matching `commits_insert`'s original rule, for a `change` branch, which must still be `draft`) — rather than trusting anything the caller claims, since being `security definer` means it no longer gets any check for free from the bypassed policy. UI-principles.md §4.2 is amended to match: `Edit` on `main` is available to owner/architect directly, and reads `Propose a change…` for a contributor there; "there is no editing at main, ever" is no longer this product's rule for every role, only for contributors.

In one transaction: insert the commit and its deltas, advance `branches.head_commit_id` (still checked by `atlas.guard_branch_head_advance`, unchanged since Sprint F1 step 6, which supplies the actual concurrency guarantee — `commit_deltas` adds no separate check of its own), and — only when the branch is `main` — materialise the three projection tables via `atlas.replace_main_head_projection`, a second, narrower `security definer` function with no grant to `authenticated` at all (only `commit_deltas`, calling it as its own owner, and `service_role`, for `rebuildHead`'s repair/verification path, can reach it). What used to be a two-round-trip insert-then-compare-and-swap (`src/db/commits.ts`, Sprint F1 step 6) with a documented "a lost race leaves a harmless orphan commit" tradeoff is now one call: a lost race means the whole transaction fails and nothing was written, because a PL/pgSQL function body is one transaction. The orphan-commit tradeoff this ADR removes was itself recorded as accepted-for-now in Sprint F1's step 7 Definition-of-Done review (`docs/SPRINT-F1-STATUS.md`); it no longer applies.

**The current design computes the resulting `Head` client-side and ships it as data, not as SQL to execute.** `src/db/commits.ts` folds with the existing, tested `src/engine` (it already did this for validation) and serialises the result (`src/engine/projection.ts`) into the jsonb arrays `commit_deltas`/`replace_main_head_projection` write verbatim — the fold/apply algorithm itself is not reimplemented in SQL. This is a real tradeoff, not a free lunch: the full projection for the new head crosses the wire on every commit to `main`, sized to the model's live element/relationship/fact count regardless of how small the actual delta was (adding one system to a 2,000-element landscape still sends all 2,000 elements' rows back). It is deliberately the simpler design for now, matching SPEC §6.5's own "fetch everything" allowance and this product's stated scale (one or two architects, not a live-editing crowd). **The named upgrade path, if that payload ever becomes a real cost, is delta-apply in SQL**: teach `commit_deltas` to apply just the *new* commit's deltas directly against the existing `elements_head`/`relationships_head`/`facts` rows for the previous head (an `UPDATE ... SET attributes = jsonb_set(...)` per delta, roughly) rather than receiving and replacing the whole materialised set — SPEC §6.5's own incremental-rebuild shape (`load(parent)` then `applyAll` just the new deltas), not the full re-fold this ADR's "alternatives rejected" below still correctly rules out. Sprint U1 step 4's Playwright perf test (a generated 2,000-element model, UI-principles.md §8.6) is where this gets a real number: it now also asserts the `commit_deltas` payload size for a single-element edit against that model stays within a stated budget, so a future body making this tradeoff has a measured baseline, not a guess. Step 4b built that assertion (`e2e/landscape-perf.spec.ts`): against the fixture's 2,010 elements / 6,000 relationships / ~16,000 facts, the real serialised payload for one attribute edit measures ~8.45 MB, budgeted at 12 MB.

**Alternatives rejected.**
- *Reimplement `apply`/`fold` (the full delta-application semantics) in PL/pgSQL, as a second, independent implementation* — duplicates already-tested engine logic in a second language, with no independent test suite of its own, for the sake of avoiding a jsonb hand-off that's otherwise straightforward. (This is different from the delta-apply upgrade path named above, which still uses the client-computed delta list, not a from-scratch SQL fold — it moves *where* the new commit's deltas get applied to the projection, not *what* computes the delta list itself.)
- *Keep the two-round-trip CAS pattern and just add a separate materialisation step after it* — doesn't fix the underlying race window, and adds a *third* round trip (and a *second* kind of partial-write, projection-without-commit) instead of removing the first.
- *Make `commit_deltas` an ordinary (non-`security definer`) function and separately loosen the RLS policies on `elements_head`/`relationships_head`/`facts`/`commits` for `main`* — would let any authenticated session with the right role write projection rows directly, without going through a fold at all; the whole point of those tables having no `authenticated` write grant is that nothing but the engine's own fold output should ever land in them.

**Consequences.** `src/db/rebuildHead.ts` (the repair/verification path, SPEC §6.6's integrity job) reuses `atlas.replace_main_head_projection` from a service-role context, driven by the same engine (`foldFromGenesis`) rather than a SQL-side refold — built alongside this ADR, not deferred; its head-equals-fold comparison lives in `src/db/repository.integration.test.ts`, the same file every other real-Supabase check in this codebase lives in, rather than waiting for a later sprint's own integration-test file. `type_schemas` (ADR-001, SPEC §3.3) is deferred to Sprint K1 rather than migrated now: as SPEC literally specifies it (a full TypeScript-type-to-JSON-Schema generator plus a checked-in seed and validator, RT-5), it is real schema-validation infrastructure the element page never needed — attribute order and per-type definitions live in `src/contracts` as code instead, and Sprint K1's capture edge function, the first consumer outside the TypeScript runtime, is what will actually need the generator.

---

## ADR-016: Capability `level` is computed from `parent_id` depth, never a stored attribute

**Context.** ADR-001 originally gave Capability a required `level` (1–3) attribute alongside `parent_capability_id`. SPEC §6.3's V2 validation rule only ever checked that a capability's parent, if any, is itself a capability — it never checked that a stored `level` value actually matched real nesting depth. Sprint U2's capability map (ADR-011's `capability_map` view kind) renders L1/L2/L3 straight from the `parent_id` chain (src/ui/capabilityMap/layout.ts), not from `attributes.level` — so the two could silently disagree the moment anyone edited `level` independently of moving an element, and any future code that trusted `level` for a structural decision would be trusting a fact that isn't guaranteed to be one.

**Decision.** `level` is removed from `CapabilityAttributes` entirely (src/contracts/delta.ts) — it is never stored, never part of an `element.create`/`element.update` delta, and never independently editable. A capability's level is always `1 + the number of capability ancestors above it`, computed on read from the real `parent_id` chain (src/ui/elements/capabilityDepth.ts), capped at 3 — a chain that doesn't resolve cleanly within that cap (too deep, or a parent reference that doesn't terminate) computes to `null` and is shown as a gap, the same stance src/ui/capabilityMap/layout.ts already takes on a malformed chain, rather than either guessing or hiding it.

The element page's Structure section (§4.5: "For a capability: level, parent capability, child capabilities…") shows the computed level as a plain value with no provenance badge — it isn't a fact asserted by any source, so it gets none, the same way "children" and "parent" are shown structurally without one.

**Alternatives rejected.**
- *Keep `level` as a stored, editable attribute and add a validation gate checking it matches nesting depth* — still leaves two representations of the same information that a validation bug could let drift apart; computing it removes the possibility entirely rather than policing it.
- *Drop the concept of "level" altogether* — UI-principles §3.1/§6.1 and the element page's own Structure section spec name "level" directly; the concept is real, only its storage as an independent fact was the trap.

**Consequences.** A starter capability map's `capability_map_items.level` (SPEC §3.10, ADR-012) remains a real column on the *template* content — that's about the template's own authored structure, reviewed once by a domain expert, not a live organisation's model, so it isn't subject to the same drift risk and is unaffected by this decision.

---

## ADR-017: Atlas has its own Supabase project and its own identity/tenancy tables

**Context.** ADR-014 drew a package boundary with the existing suite but left one question open: whether Atlas shares the existing suite's tenancy/identity tables or has entirely its own, naming it as needing "facts about the existing suite's actual schema that this document's authoring session doesn't have access to." That gap has since closed, not because this document gained new information about the existing suite's *schema*, but because its actual deployment topology became directly inspectable: docs/AUDIT-2026-09-U2.md §8.1's live Supabase organisation lookup found two entirely separate projects already exist — "Architecture" (this product, holding every migration in `supabase/migrations/`) and "Des-studio" (the existing suite, with its own 71 migrations and its own deployed edge functions, including a real `llm-proxy`). No query, RLS policy, foreign key, or edge function in this repository has ever referenced Des-studio's project, tables, or ids — ADR-009's `organisations`/`members` tables were built as this product's own from their first migration onward, not provisionally pending this decision.

**Decision.** Atlas has its own Supabase project and its own `organisations`/`members`/`auth.users` — permanently, not as an interim state awaiting a shared-identity migration. The two products are physically separate Postgres databases with no cross-database join possible even by mistake. A person who uses both products holds two independent accounts and two independent organisation memberships, exactly as if they were unrelated SaaS products, because for tenancy purposes they are.

Sharing between the two products, where it happens at all, stays exactly where ADR-014 already drew it: the extracted-package boundary (graph editor primitives, schema validation/versioning, the versioning/delta engine primitives, the LLM proxy) — code, not data, and never identity. If the two products' identity ever needs to feel unified to a user (single sign-on, one subscription spanning both), that is a product/billing integration layered on top of two separate identity stores — a shared OAuth provider, or an account-linking table referencing both by external id — never a shared `organisations`/`members` schema. That is a distinct, larger decision this ADR does not make and does not need to: it belongs in its own future ADR if a concrete requirement for it ever appears, not pre-emptively here.

**Alternatives rejected.**
- *Share `organisations`/`members` across both products* — the option ADR-014 left open pending schema facts this session didn't have at the time. Decided against now: Atlas already has real tenant data accumulated across this sprint sequence, which is exactly the expensive-after-the-fact retrofit ADR-014's own Consequences warned about, and no concrete requirement for shared identity has ever surfaced (not in the brief, not in a sprint, not from a user). Absent that, separate is the option that costs nothing to keep and everything to undo later.
- *A shared `auth.users` with per-product membership tables* — Supabase's `auth.users` is project-scoped, so sharing it means sharing the whole project, not one table. That reopens every tenancy/RLS boundary this ADR exists to keep closed: a bug in the existing suite's RLS would become a risk to Atlas's data, and vice versa.
- *Defer the decision further, pending an actual look at the existing suite's schema* — was the honest position when ADR-014 was written, with no access to the existing suite's repository. It no longer holds: the live-inspection evidence ADR-014 named as missing now exists (docs/AUDIT-2026-09-U2.md §8.1), and it already points the same way separate identity does in practice. Continuing to defer would only postpone a decision today's evidence already answers.

**Consequences.** ADR-014's "Not extracted" list (the RLS/organisation/roles model) is now unconditional rather than provisional — it was never actually going to be shared, and this ADR removes the one open question that kept that from being said plainly. The "Deferred to follow-up ADRs" section's identity/tenancy item is closed and struck from that list. No migration, RLS policy, or application code changes as a result of this ADR: it ratifies a design that was already true in every implementation decision made since ADR-009, rather than requiring a new one.

---

## ADR-018: A model's main branch always has a real head — the genesis commit

**Context.** From Sprint F1 onward, `atlas.on_model_created` gave every new model a `main` branch with `base_commit_id`/`head_commit_id` both null, on the assumption that the model's first real commit would set them. But nothing could: `atlas.commit_deltas`'s own lookup (`join commits c on c.id = p_base_commit_id`) requires an existing commit row to attach the new one to, so a null head was a dead end for every write path except `atlas.seed_from_map` (capability-map import), which alone was allowed to insert a commit with `parent_commit_id` null. That made seeding from a starter map the *only* way a model could ever get its first commit — not a design choice anyone had made deliberately, but a gap nobody had needed to close until "add a capability by hand from an empty model" (the empty-state feature this ADR unblocks) needed a genesis commit from a code path that has nothing to do with capability maps. Three Playwright specs and one integration-test fixture had already worked around the same gap with a direct service-role insert of a fake "genesis" commit before this ADR, each carrying a comment pointing at the same unresolved cause.

**Decision.** `commit_kind` gains a fifth value, `'genesis'` — a real commit, inserted exactly once per model, with zero deltas, `depth = 0`, and the only kind ever allowed a null `parent_commit_id`. `atlas.on_model_created` inserts it in the same transaction as the model's `main` branch and sets `base_commit_id = head_commit_id` to it immediately, so **a model's main branch never has a null head, from the instant the model exists.** The only inserter of a `'genesis'` commit is this trigger — never a client RPC, never `atlas.commit_deltas` (which already rejects any `p_kind` not in `('manual', 'merge', 'template_seed')` for a main-branch commit, so `'genesis'` was excluded automatically the moment it stopped being in that list) and never `atlas.seed_from_map` (which now requires a real parent like every other commit, described below).

`branches.base_commit_id`/`head_commit_id` become `NOT NULL` outright, replacing the two kind-conditional CHECKs from Sprint F1 (`kind <> 'main' or (... base_commit_id is null)` and `kind = 'main' or base_commit_id is not null`) with one flat rule: every branch, of every kind, always has both set. `atlas.seed_from_map` (SPEC §5.1's "the first commit of a model seeded from a capability map") is unchanged in what it does — insert one `template_seed` commit carrying the map's items as `element.create` deltas — but no longer treats that commit as a null-parent genesis: it looks up main's current head (always the genesis commit, at this point, or seeding is refused), parents the seed commit on it, and increments `depth` to 1. "Seeded once, ever" is now expressed as "the current head is still the genesis commit itself" rather than "head_commit_id is null" — the same fact, checked against a head that always exists rather than one that might not. A migration backfills a genesis commit, and repoints `base_commit_id`/`head_commit_id`, for any model created before this ADR whose main had a null head.

This closes the empty-state gap outright: `src/db/ref.ts`'s `resolveRef` always resolves `main` to a real commit id now (the third case in its own doc comment — "a model with no commits yet" — no longer arises for `main`; an unknown tag or unknown branch name still resolve to `null`, unchanged), so `src/ui/capabilityMap/useCapabilityMap.ts` always reaches `ready`, with an empty tree for a fresh model rather than `refNotFound`. "Add a capability" (`src/ui/capabilityMap/CapabilityMapAddForm.tsx`, already built) commits through `atlas.commit_deltas` like any other edit, parented on the genesis commit exactly like a starter-map seed would be — no special-casing anywhere in the write path for "this is the model's very first capability." The three Playwright specs' and one integration fixture's service-role genesis bootstraps (`e2e/landscape-perf.spec.ts`, `e2e/element-edit.spec.ts`, `e2e/capability-map.spec.ts`, `e2e/zoom-chain-structure.spec.ts`, `e2e/landscape-navigation.spec.ts`, `e2e/versions.spec.ts`, `e2e/fixtures/changeBranchFixture.ts`) are deleted; each now just reads `main.head_commit_id`, already populated the instant `createModel` returns.

**Alternatives rejected.**
- *Give `atlas.commit_deltas` its own "create a genesis commit if the branch has none yet" branch, callable by any authenticated owner/architect* — makes genesis creation a general capability of the one function every ordinary edit already goes through, rather than a fact about model creation itself; a client could then construct a `kind: 'genesis'` commit with a real parent by mistake or malice, which is exactly the "genesis means true origin" invariant this ADR exists to protect.
- *Keep `head_commit_id` nullable and teach every reader (`resolveRef`, the engine's `ancestry`/`foldFromGenesis`, every UI hook) to treat null as "identical to an empty fold" explicitly* — this is what the codebase already did, informally, everywhere except the one write path (`commit_deltas`'s own base-commit lookup) that actually needed a row to exist. Making the null case rigorous everywhere it's read is strictly more code than making it not exist at the one place it's written.
- *A dedicated `atlas.create_first_capability` RPC, parallel to `seed_from_map`, for exactly the "empty model, add one capability" case* — duplicates `commit_deltas`'s validation and projection-refresh logic for no reason once main always has a real parent to commit against; "add a capability" needed nothing seed_from_map-shaped once the actual blocker (no parent to attach to) was gone.

**Consequences.** `src/contracts/delta.ts`'s `CommitKind` gains `'genesis'`; `CommitEnvelope.parentCommitId`'s doc comment is corrected — never null in a client-constructed envelope, since a client never constructs a genesis commit. `docs/SPEC-data-model.md` §3.4/§3.5/§5.1 are updated to describe `base_commit_id`/`head_commit_id` as always-set and to describe seeding's precondition as "still at genesis" rather than "no commits yet." Every Postgres enum value addition needs its own migration, separate from the one that uses the new value as a literal (`ALTER TYPE ... ADD VALUE` isn't visible by name until its own transaction commits) — `supabase/migrations/20260906210000_commit_kind_genesis.sql` exists only for that reason, ahead of `20260906220000_main_always_has_head.sql`'s actual implementation.

---

## ADR-019: Identity policy for created elements — search-first, merge reversibly, and report what search missed

**Context.** A prompt pack this product's brief traces back to named three linked rules for how duplicate elements get handled — search before creating, merge duplicates reversibly rather than deleting one, and surface the duplicates search alone didn't catch — under an ADR numbering that doesn't match this repo's. Substance, not number, is what matters here: none of the three was ever actually recorded as a decision in this repo's own ADR sequence, even though the second is already most of the way into `docs/SPEC-data-model.md` (`element_merges`, `atlas.merge_elements`, ADR-008) and the first shipped this sprint (`src/ui/components/ElementSearchAdd`, the search-first "Add" control on Landscape/Container/Component). A product rule like this is exactly what CLAUDE.md means by "an undocumented choice is exactly the kind of untracked fact this product is built to eliminate everywhere else" — it counts as ADR material even though no table changes shape today. Recording it now, plainly, gives U3b's own search box (already built) and Q1's duplicates-report build something real to be *consistent with* rather than a decision made silently a second time.

**Decision.** Three rules, one policy:

1. **Search before creating, always.** Every place an element can be created goes through a search-first control (`ElementSearchAdd`) that shows existing matches by name, alias, or description before offering to create anything new — never a bare "new element" form. This is preventive, not a gate with teeth: it lowers the rate of accidental duplicates at the moment of creation, nothing more.
2. **A duplicate, once found, is resolved by a reversible merge, never a delete.** `atlas.merge_elements` (ADR-008, SPEC §3.6/§9/§7.4 — specified, not yet implemented, deferred to Q1 alongside the matching pipeline it depends on) is the only sanctioned fix: the loser retracts, the survivor inherits its relationships (deduplicated, S-6), an `aliases` row of type `merged_id` records the mapping so old references still resolve, and `element_merges` itself is an append-only record of the merge. "Reversible" names what CLAUDE.md rule 5 already requires of everything in this system — nothing is forgotten, only superseded — applied specifically to identity, not a new mechanism this ADR invents.
3. **Search-first creation alone doesn't catch every duplicate, so the model needs a standing duplicates report, independent of any one person's create flow.** Two people can each search, each find nothing, and each create the same real-world system minutes apart — search-first only ever protects the moment of creation, not the model's whole life. A periodic or on-demand report surfacing likely-duplicate elements (by the same name/alias/description similarity `ElementSearchAdd`'s own search already uses, or `elements_head_name_trgm_idx`'s trigram matching once Q1's matching pipeline exists) is the second half of this policy, resolved through the same `atlas.merge_elements` action a reviewer chooses the survivor for — not built yet, and not this ADR's job to build, but named here so Q1 builds it against a decided requirement rather than inventing one when the moment arrives.

**Alternatives rejected.**
- *Rely on search-first creation alone, with no report* — leaves the exact race condition above (two independent, well-intentioned creators) permanently unaddressed; search-first is preventive, not comprehensive, and was never claimed to be either.
- *A hard uniqueness constraint on element name* — elements in this model legitimately share names across unrelated real things (two different orgs' "Billing Service"), and the same real thing legitimately gets referred to by different names (`aliases` exists precisely because names aren't identity) — a uniqueness constraint would reject exactly the cases `aliases` was built to handle.
- *Auto-merge on a high-confidence match instead of a human-reviewed report* — identity is advisory, never blocking or automatic (S-13, ADR-005(c)): a human always chooses the survivor. A report that quietly merged for you would be exactly the identity-conflict-blocks-everything failure mode S-13 already rejected, just moved to a different trigger.

**Consequences.** No migration, no contract change — this ADR ratifies existing SPEC infrastructure (`element_merges`, `atlas.merge_elements`, `aliases.merged_id`) as *the* identity-resolution mechanism and gives the not-yet-built duplicates report a name and a place in the deferred-to-Q1 list below, rather than leaving it as a prompt-pack idea with no repo record. `ElementSearchAdd`'s own module comment is corrected to point here instead of a numbering mismatch.

---

## ADR-020: Capability `code` is a user-set reference, never seed-populated

**Context.** `src/db/seedFromMap.ts`'s `buildSeedDeltas` set `attributes.code = item.code` unconditionally on every capability created from a starter map — duplicating the template's own code as a "fact" asserted about the model's own element. But the template's code was already recoverable two other ways with no duplication: `attributes.templateRef` (`capability_map_items.id`) links back to the template item itself, and the seed commit's own `template_code` alias (`aliases.alias_type = 'template_code'`, SPEC §3.5/ADR-001) records the exact code value used at seed time, surviving even a later rename (ADR-000's own "Tailoring" note on this same alias). Sprint U4-2a's check C1 (`docs/CHECK-U4-2a.md`) named the resulting state directly: `code` displayed unconditionally in the read-only Attributes list (labelled "Code," reading as a stable identifier rather than what it actually was), pre-filled on every seeded capability whether or not the organisation ever gave it independent meaning, and shown as a bare "—" rather than omitted on the (far more common, post-Sprint-U4-1-C5) case of a hand-added capability that was never seeded at all.

**Decision.** `code` becomes an ordinary, optional, user-set reference — relabelled "Reference" (`AttributeFieldMeta.label`, `src/contracts/attributeSchema.ts`) — for an organisation's own use (an internal capability-catalog number, a cross-reference into another system), never populated by `atlas.seed_from_map`/`buildSeedDeltas` at seed time. A capability's template code, when it has one, stays reachable exactly as before through `attributes.templateRef` and its `template_code` alias — neither changes. The read-only Attributes list hides the Reference row entirely when it has no fact (`AttributeFieldMeta.hideWhenEmpty`, `ElementPage.tsx`'s `AttributesTable`), rather than showing "—" — the one deliberate exception to §4.3's "a gap made visible, never hidden" rule: an unset Reference isn't a gap in what's known about the capability, it's a field the organisation hasn't chosen to use yet, the same distinction `templateRef`'s own `hidden: true` already draws for a different reason (ADR-000's Sprint U4-1 D2 note, above).

A one-off backfill (`scripts/stripSeedCodes.ts`, model-scoped, same shape as `scripts/syncDescriptionsFromMap.ts`) commits an `element.update` clearing `code` for every existing capability whose current `code` still equals its own template item's code — i.e., no organisation has ever actually changed it, so the value is pure seed leftover, not a real fact anyone asserted independently. A capability whose code was edited after seeding, to any value (including, coincidentally, the same one), is left untouched: that's now a real, deliberate fact with its own provenance, not seed noise, and this backfill has no way to distinguish "never touched" from "re-entered the same value" without also erasing the latter's legitimacy — it accepts that one is the safe reading and the target.

**Alternatives rejected.**
- *Keep pre-filling `code` at seed, only hide it once redundant* — still writes a duplicate fact on every one of potentially thousands of seeded capabilities for a value already recoverable via `templateRef`/the alias, and gives the field two silently different meanings (seed leftover vs. a real organisation-entered value) with no way to tell them apart in storage.
- *Drop `code` from `CapabilityAttributes` entirely* — an organisation legitimately wants its own reference numbers for some capabilities (a cross-reference into a separate catalog, a procurement code) independent of any starter map; removing the field removes that, not just the seed-populated case this decision actually objects to.
- *Show "—" for an empty Reference like every other optional field* — was the status quo (§4.3's own default). A field that's empty on the large majority of capabilities by design (every hand-added one, and every seeded one nobody has given an organisation-specific reference yet) reads as clutter under that default, not a gap worth flagging the way a genuinely-unset `System.vendor` is.

**Consequences.** `src/contracts/delta.ts`'s `CapabilityAttributes.code` doc comment is corrected: an organisation's own optional reference, never populated by seeding (was: "Reference code from a starter capability map"). `docs/SPEC-data-model.md` §5.1's seeding description and its RT-4 property-test row (§10) are corrected to no longer claim a seeded capability has `attributes.code` set — only `attributes.templateRef` and the `template_code` alias, which RT-4 already checked independently. No schema/migration change: `code` was already an optional JSONB attribute key, not a column: only the write path (seeding) and the read-only display (`hideWhenEmpty`) change.

---

## Deferred to follow-up ADRs

Named explicitly so they aren't mistaken for settled: multi-branch to-be composition and its conflict-resolution UX (ADR-005); the decisions/evidence workflow layer on top of ADR-013's data shape; delta retention/compaction policy (ADR-002); the full `type_schemas` JSON-Schema generator and validator (ADR-001, ADR-015), deferred to Sprint K1; and, deferred to Q1 alongside the matching pipeline and `atlas.merge_elements` itself (ADR-019), the standing duplicates report ADR-019 names but doesn't build.

**ADRs recorded in their own files** (this document holds ADR-001–020; later ones are separate files, indexed here): **ADR-021** — `docs/ADR-021-structural-conflict-resolution.md`, structural-conflict resolution on refresh ("prepare, replay, decide", the `preparation` commit kind, C18) and the fast-forward fold rule for the final merge (C19). Accepted 2026-09-11; amends ADR-006.

~~Whether Atlas shares the existing suite's identity/tenancy tables (ADR-014)~~ — **closed, Sprint H1: ADR-017 decides separate, permanently.** This was the only item in this list with a concrete follow-up ADR actually written; the rest remain open in the sense this section describes.
