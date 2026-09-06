# SPEC: Data model and delta specification

**Status:** Proposed
**Depends on:** `docs/ADR-000-foundations.md` (ADR-001 … ADR-014)
**Companion:** `src/contracts/delta.ts` (the delta and commit wire contract)

This document turns the ADRs into tables, a wire format, and algorithms precise enough to test against. It contains no UI and no engine code: the TypeScript is types only, the SQL is DDL-shaped table descriptions plus real RLS policies, the algorithms are pseudocode.

Where an ADR left a choice open, this spec makes it. Every such choice is listed in §1 so it can be challenged in one place.

---

## 1. Decisions made by this spec

| # | Choice | Why |
|---|---|---|
| S-1 | **Ids are UUID v7, minted by the writer** (client, capture worker, merge tool). The server enforces uniqueness; it does not assign. | A create followed by an update in the same branch needs the id before the round trip. v7 keeps indexes append-friendly. |
| S-2 | **Head tables are keyed by `commit_id`, not `branch_id`.** `branches.head_commit_id` points at a materialised commit. Rows are retained for (a) every branch head, (b) every tagged commit, (c) nothing else. | One representation serves branch heads and tags (ADR-003). Old heads are garbage-collected, never authoritative. |
| S-3 | **One `parent_id` column on `elements_head`**, not three per-type columns. The parent's required type is a validation rule (V2). | ADR-001's three FK columns were shorthand; a discriminated single table wants one column. |
| S-4 | **Promoted columns on `elements_head` are `name` and `parent_id` only.** Everything else lives in `attributes` jsonb. | Search, integrity and layout need those two; nothing else needs a column. |
| S-5 | **Relationship endpoints are immutable.** To re-point, retract and create. | Keeps the fact key model simple; a moved edge is a different fact. |
| S-6 | **Relationships are unique on `(commit, type, from, to)`**, `flows_to` included. Multiple data flows between the same pair are one `flows_to` with a richer description. | Small taxonomy. A duplicate is a merge conflict (§7), not a modelling feature. |
| S-7 | **`sources` is a first-class table**; `deltas.source_id` is a foreign key, not free text. Manual edits use an auto-created per-`(model, user)` source of kind `manual`. | Provenance must be joinable and countable ("how much of this landscape rests on one spreadsheet"). |
| S-8 | **`facts` is a materialised projection at attribute grain**, retained with the same rule as heads. `deltas` remains the only source of truth. | ADR-007's per-field provenance needs a cheap lookup; three-way merge needs `facts[commit][key]` in O(1). |
| S-9 | **`element.restore` / `relationship.restore` exist.** A retract is reversible by a new delta, never by deleting the retract. | Keeps history append-only on draft branches too (ADR-002). |
| S-10 | **Existence is a fact** with reserved attribute `$exists`; `previous_delta_id` on retract/restore points at the existence chain. | One supersession mechanism for everything. |
| S-11 | **Refresh = merge main into the branch** (a `merge` commit on the branch whose second parent is a main commit). The merge base is computed from the DAG, not stored. `branches.base_commit_id` is the fork point, for display only. | ADR-006's "refresh or rebase" becomes one mechanism with the same conflict rules as the final merge. |
| S-12 | **A merge commit carries only resolution deltas** (C15). A field conflict with no resolution delta is a rejected commit; there is no "theirs wins by default". | ADR-005: conflicts are surfaced, never silently resolved. |
| S-13 | **Identity conflicts are advisory** in the review queue; they do not block a merge. Structural and field conflicts do. | ADR-005(c): identity is resolved via `element_merges` after the fact; blocking on a fuzzy match would stall every capture. |
| S-14 | **Validation has two levels.** *Structural* (V2, V4, V5, V6) is required on every commit of every branch kind except `capture_draft`. *Schema* (V1, V3) is required on main and to approve a merge request; on change branches it is reported, not enforced. `capture_draft` requires only C1–C6. | ADR-001: drafts may be temporarily invalid; ADR-003: main never is. |
| S-15 | **`commits.head_hash`** is the SHA-256 of the canonical head (§6.4). It is the proof that materialisation equals fold. | Makes "head == fold(deltas)" a checkable equation rather than a belief. |
| S-16 | **One anchor per comment, stored inline** (`anchor_type`, `anchor_id` on `comments`). No `comment_anchors` join. | ADR-010 already fixed one anchor; a join table for a 1:1 is noise. |
| S-17 | **Direct commits to main are impossible via RLS.** Main advances only through `atlas.merge_branch(merge_request_id)`, a security-definer procedure. | Makes ADR-006's gate structural, not conventional. |
| S-18 | **New commits are accepted only while `branches.status = 'draft'`.** Submitting a merge request moves the branch to `proposed`; `changes_requested` moves it back to `draft`. | Avoids "the reviewer approved a head that has since moved". |
| S-19 | **`users` is Supabase `auth.users`.** No local users table; `members.user_id` references `auth.users(id)`. | Working assumption in ADR-000. If wrong, only `members` and the RLS helpers change. |
| S-20 | **Every table carries `org_id`**, including projections and deltas, even where derivable through joins. | RLS policies stay one predicate, and never need a join to decide. |
| S-21 | Table renames relative to the ADR: `organisation_members` → `members`; `element_aliases` → `aliases`; `merges` → `element_merges`; `capability_map_templates` → `capability_maps`; `capability_map_template_items` → `capability_map_items`. | The brief's requested names; the ADR's were descriptive placeholders. |

---

## 2. Conventions

- Schema `public` for tables, schema `atlas` for helper functions and procedures.
- Every table: `id uuid primary key`, `org_id uuid not null references organisations(id)`, `created_at timestamptz not null default now()`. These three are not repeated in the column lists below unless the type differs.
- `→` in a column list means a foreign key.
- Append-only tables (`commits`, `deltas`, `tags`, `element_merges`, `resolved_conflicts`) have no `update` or `delete` RLS policy for any application role, so those statements are denied outright. Only the service role and security-definer procedures can touch them, and those procedures only insert.
- Enumerations are Postgres enum types (§3.1). Values inside `attributes` jsonb are validated by `type_schemas`, not by enums.
- Wire format is camelCase; storage is snake_case. Mapping is mechanical (§4.4).

---

## 3. Tables

### 3.1 Enumerated types

| Type | Values |
|---|---|
| `member_role` | `owner`, `architect`, `contributor`, `viewer` |
| `element_type` | `capability`, `system`, `container`, `component`, `actor` |
| `relationship_type` | `supports`, `uses`, `owns`, `flows_to` |
| `branch_kind` | `main`, `change`, `capture_draft` |
| `branch_status` | `draft`, `proposed`, `in_review`, `approved`, `merged`, `rejected`, `archived` |
| `commit_kind` | `manual`, `capture`, `merge`, `template_seed` |
| `delta_kind` | `element_create`, `element_update`, `element_retract`, `element_restore`, `relationship_create`, `relationship_update`, `relationship_retract`, `relationship_restore` |
| `subject_type` | `element`, `relationship` |
| `source_kind` | `document`, `spreadsheet`, `interview`, `capture_job`, `template`, `manual`, `merge_resolution` |
| `alias_type` | `name`, `code`, `external_ref`, `source_system_key`, `template_code`, `merged_id` |
| `merge_request_status` | `pending`, `changes_requested`, `approved`, `merged`, `rejected` |
| `capture_status` | `pending`, `parsed`, `reviewed`, `discarded` |
| `decision_status` | `proposed`, `accepted`, `superseded`, `rejected` |
| `argument_stance` | `for`, `against`, `neutral` |
| `assumption_status` | `open`, `validated`, `invalidated` |
| `evidence_kind` | `document`, `link`, `capture_job_ref`, `comment_ref` |
| `comment_visibility` | `team`, `internal` |
| `comment_status` | `open`, `resolved` |
| `anchor_type` | `element`, `relationship`, `delta`, `branch`, `decision` |
| `view_kind` | `landscape`, `context`, `container`, `component` |
| `annotation_kind` | `text`, `highlight`, `arrow` |
| `map_status` | `draft`, `published`, `deprecated` |
| `validation_level` | `structural`, `schema` |
| `validation_status` | `pass`, `fail` |

### 3.2 Tenancy

#### `organisations`
One tenant. Every other row hangs off one of these.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | pk |
| `name` | text | not null |
| `slug` | text | not null, unique, `check (slug ~ '^[a-z0-9-]{3,63}$')` |
| `created_by` | uuid | → `auth.users(id)` |

(`organisations` has no `org_id`; it is the org.)

#### `members`
Who belongs to an organisation and with what role.

| Column | Type | Constraints |
|---|---|---|
| `org_id` | uuid | → `organisations(id)` on delete cascade |
| `user_id` | uuid | → `auth.users(id)` on delete cascade |
| `role` | member_role | not null |
| `invited_by` | uuid | → `auth.users(id)`, nullable |
| `joined_at` | timestamptz | not null default now() |

Primary key `(org_id, user_id)`. Index on `(user_id)`.
Trigger `atlas.on_organisation_created` inserts the creator as `owner`. Constraint trigger: an org must always have at least one `owner`.

#### `models`
A landscape. One org owns it; sharing is by grant (`model_shares`), never by moving it.

| Column | Type | Constraints |
|---|---|---|
| `name` | text | not null |
| `slug` | text | not null, unique within org: `unique (org_id, slug)` |
| `description` | text | |
| `schema_version` | int | not null → the `type_schemas` version this model is validated against |
| `created_by` | uuid | → `auth.users(id)` |

Index `(org_id)`. The main branch is found by `branches where model_id = ? and kind = 'main'` (partial unique index, see `branches`), not by a column here, to avoid a circular FK.

#### `model_shares`
Cross-org read grant on a model, optionally pinned to one tag (ADR-009).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` on delete cascade |
| `tag_id` | uuid | → `tags(id)`, nullable. Null = "current main"; set = "this version only". |
| `shared_with_org_id` | uuid | → `organisations(id)`, `check (shared_with_org_id <> org_id)` |
| `permission` | text | not null, `check (permission = 'view_only')` |
| `expires_at` | timestamptz | nullable |
| `created_by` | uuid | → `auth.users(id)` |

Unique `(model_id, shared_with_org_id, tag_id)` (nulls distinct). Index `(shared_with_org_id)`.

### 3.3 Schema registry

#### `type_schemas`
Versioned JSON Schema per element/relationship type. The thing `attributes` jsonb is validated against (ADR-001).

| Column | Type | Constraints |
|---|---|---|
| `subject_type` | subject_type | not null |
| `type_name` | text | not null (`element_type` or `relationship_type` value) |
| `schema_version` | int | not null |
| `json_schema` | jsonb | not null |
| `effective_from` | timestamptz | not null |

Primary key `(subject_type, type_name, schema_version)`. No `org_id`: this is product content, readable by every authenticated user, writable only by the service role. The checked-in generator derives `json_schema` from `src/contracts/delta.ts` (test RT-5).

#### `relationship_type_rules`
Which `(relationship_type, from_type, to_type)` triples are legal, and cardinality (ADR-001).

| Column | Type | Constraints |
|---|---|---|
| `relationship_type` | relationship_type | not null |
| `from_type` | element_type | not null |
| `to_type` | element_type | not null |
| `max_per_from` | int | nullable — max live relationships of this type from one element |
| `max_primary_per_to` | int | nullable — used by `owns` (1) |

Primary key `(relationship_type, from_type, to_type)`. No `org_id`; product content. Seed rows:

| relationship_type | from | to | max_per_from | max_primary_per_to |
|---|---|---|---|---|
| supports | system | capability | | |
| uses | system | system | | |
| uses | container | container | | |
| uses | component | component | | |
| uses | container | system | | |
| uses | component | container | | |
| owns | actor | capability | | 1 |
| owns | actor | system | | 1 |
| flows_to | system | system | | |
| flows_to | container | container | | |

### 3.4 History

#### `branches`
A named mutable pointer to a commit (ADR-002).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` on delete cascade |
| `name` | text | not null; `unique (model_id, name)` |
| `kind` | branch_kind | not null |
| `status` | branch_status | not null default `draft` |
| `base_commit_id` | uuid | → `commits(id)`, nullable only for main |
| `head_commit_id` | uuid | → `commits(id)`, nullable only before the genesis commit |
| `shared_for_review` | boolean | not null default false — makes the head visible to viewers (ADR-009) |
| `title` | text | change branches: the solution design title |
| `created_by` | uuid | → `auth.users(id)` |
| `updated_at` | timestamptz | not null |

Partial unique index `(model_id) where kind = 'main'`. Index `(model_id, status)`. Check: `kind = 'main'` ⇒ `status = 'draft'` (main is always open) and `base_commit_id is null`. Check: `kind = 'capture_draft'` ⇒ `status in ('draft','archived')`.

#### `commits`
An ordered batch of deltas on a branch. Ancestry is a DAG: two parents on a merge (ADR-002).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `branch_id` | uuid | → `branches(id)` |
| `parent_commit_id` | uuid | → `commits(id)`, null only for genesis |
| `merged_branch_head_commit_id` | uuid | → `commits(id)`, nullable; `check ((kind = 'merge') = (merged_branch_head_commit_id is not null))` |
| `kind` | commit_kind | not null |
| `message` | text | not null |
| `author_id` | uuid | not null — `auth.users.id` or service identity |
| `head_hash` | bytea | nullable until materialised; 32 bytes (§6.4) |
| `depth` | int | not null — 1 + parent depth; genesis = 0. Used to bound replay and order topological sorts. |

Indexes: `(branch_id, depth desc)`, `(parent_commit_id)`, `(merged_branch_head_commit_id)`, `(model_id, kind)`. Unique `(branch_id, parent_commit_id)` where `parent_commit_id is not null` — enforces linear history within a branch (C13). Append-only.

#### `deltas`
One fact assertion (ADR-002, ADR-007). The only source of truth for model content.

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `commit_id` | uuid | → `commits(id)` |
| `seq` | int | not null; `unique (commit_id, seq)` |
| `kind` | delta_kind | not null |
| `subject_type` | subject_type | not null, generated from `kind` |
| `subject_id` | uuid | not null — element id or relationship id |
| `attribute` | text | not null; `'$exists'` for create/retract/restore, attribute name for update |
| `element_type` | element_type | nullable; not null iff `subject_type = 'element'` |
| `relationship_type` | relationship_type | nullable; not null iff `subject_type = 'relationship'` |
| `name` | text | nullable; not null iff `kind = 'element_create'` |
| `parent_id` | uuid | nullable; only on `element_create` |
| `from_element_id` | uuid | nullable; not null iff `kind = 'relationship_create'` |
| `to_element_id` | uuid | nullable; not null iff `kind = 'relationship_create'` |
| `value` | jsonb | nullable; on create: the initial `attributes` object; on update: the new value (JSON `null` allowed = clear); null on retract/restore |
| `previous_delta_id` | uuid | → `deltas(id)`; null iff `kind in ('element_create','relationship_create')` |
| `source_id` | uuid | → `sources(id)`, not null |
| `source_ref` | text | nullable |
| `effective_date` | date | nullable |
| `confidence` | numeric(3,2) | not null, `check (confidence between 0 and 1)` |
| `created_by` | uuid | not null |

Indexes: `(commit_id, seq)`, `(model_id, subject_id, attribute)`, `(previous_delta_id)`, `(source_id)`, `(model_id, from_element_id)`, `(model_id, to_element_id)`. Unique `(commit_id, subject_id, attribute)` (C4). Append-only. Per-kind check constraints encode the nullability rules above.

#### `tags`
Immutable pointer to a main commit; the product's "version" (ADR-002).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `name` | text | not null; `unique (model_id, name)` |
| `commit_id` | uuid | → `commits(id)` |
| `description` | text | |
| `created_by` | uuid | → `auth.users(id)` |

Check via trigger: `commit_id` is on the model's main branch. Insert-only, no update/delete policy for anyone.

### 3.5 Materialised projections

Retention rule (S-2): rows exist for a `commit_id` iff that commit is some branch's `head_commit_id` or some tag's `commit_id`. A GC job deletes the rest. Projections are rebuildable from `deltas` at any time (§6).

#### `elements_head`
The folded element set at a commit.

| Column | Type | Constraints |
|---|---|---|
| `commit_id` | uuid | → `commits(id)` on delete cascade |
| `element_id` | uuid | not null |
| `model_id` | uuid | → `models(id)` |
| `element_type` | element_type | not null |
| `name` | text | not null |
| `parent_id` | uuid | nullable — must reference an `element_id` in the same `commit_id` (enforced by V2, not FK) |
| `attributes` | jsonb | not null default `'{}'` |
| `exists_delta_id` | uuid | → `deltas(id)` — the create/restore currently asserting existence |

Primary key `(commit_id, element_id)`. Indexes: `(commit_id, element_type)`, `(commit_id, parent_id)`, `(model_id, element_id)`, GIN `(attributes)`, GIN trigram on `lower(name)` (pg_trgm) for matching (§8).

#### `relationships_head`
The folded relationship set at a commit.

| Column | Type | Constraints |
|---|---|---|
| `commit_id` | uuid | → `commits(id)` on delete cascade |
| `relationship_id` | uuid | not null |
| `model_id` | uuid | → `models(id)` |
| `relationship_type` | relationship_type | not null |
| `from_element_id` | uuid | not null |
| `to_element_id` | uuid | not null |
| `attributes` | jsonb | not null default `'{}'` |
| `exists_delta_id` | uuid | → `deltas(id)` |

Primary key `(commit_id, relationship_id)`. Unique `(commit_id, relationship_type, from_element_id, to_element_id)` (S-6). Indexes `(commit_id, from_element_id)`, `(commit_id, to_element_id)`.

#### `facts`
Attribute-grain provenance at a commit: which delta currently asserts each fact (S-8, ADR-007).

| Column | Type | Constraints |
|---|---|---|
| `commit_id` | uuid | → `commits(id)` on delete cascade |
| `subject_type` | subject_type | not null |
| `subject_id` | uuid | not null |
| `attribute` | text | not null |
| `value` | jsonb | nullable |
| `delta_id` | uuid | → `deltas(id)` |
| `source_id` | uuid | → `sources(id)` |
| `source_ref` | text | |
| `effective_date` | date | |
| `confidence` | numeric(3,2) | not null |
| `asserted_by` | uuid | not null |
| `asserted_at` | timestamptz | not null — the delta's commit `created_at` |

Primary key `(commit_id, subject_id, attribute)`. Index `(commit_id, source_id)` ("what depends on this spreadsheet"). One row per live attribute including `$exists`; a create delta yields one `$exists` row plus one row per initial attribute, all pointing at the create delta. Attributes of retracted subjects are removed from `facts` (they come back on restore from the delta chain).

### 3.6 Provenance and identity

#### `sources`
Where a fact came from (S-7).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `kind` | source_kind | not null |
| `name` | text | not null — "Application register 2025-Q3.xlsx", "Interview: Head of Digital, 4 Mar 2026" |
| `uri` | text | nullable — storage pointer or URL |
| `captured_at` | date | nullable — when the source was produced, not uploaded |
| `capture_job_id` | uuid | → `capture_jobs(id)`, nullable; not null iff `kind = 'capture_job'` |
| `capability_map_id` | uuid | → `capability_maps(id)`, nullable; not null iff `kind = 'template'` |
| `user_id` | uuid | → `auth.users(id)`, nullable; not null iff `kind = 'manual'` |
| `created_by` | uuid | not null |

Unique `(model_id, user_id) where kind = 'manual'`. Index `(model_id, kind)`.

#### `aliases`
Alternative identifiers for an element (ADR-008, ADR-012).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `element_id` | uuid | not null |
| `alias_value` | text | not null |
| `alias_type` | alias_type | not null |
| `source_id` | uuid | → `sources(id)` |
| `confidence` | numeric(3,2) | not null |
| `created_by` | uuid | not null |

Unique `(model_id, alias_type, lower(alias_value))` — an alias string resolves to exactly one element within a model. Index `(model_id, element_id)`. Rows of `alias_type = 'merged_id'` have `alias_value = merged_element_id::text` and are inserted only by `atlas.merge_elements`.

#### `element_merges`
Record that two ids were the same real thing (ADR-008).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `surviving_element_id` | uuid | not null |
| `merged_element_id` | uuid | not null, `check (merged_element_id <> surviving_element_id)` |
| `decided_by` | uuid | not null |
| `rationale` | text | not null |
| `evidence_id` | uuid | → `evidence(id)`, nullable |
| `commit_id` | uuid | → `commits(id)` — the commit that retracted the merged element and re-pointed its relationships |

Unique `(model_id, merged_element_id)` — an id is merged away at most once. Append-only. The procedure `atlas.merge_elements` writes this row, an `aliases` row of type `merged_id`, and a commit on the chosen branch containing: retract of `merged_element_id`, retract+create for each relationship that touched it (re-pointed to the survivor, skipping duplicates per S-6), and re-parent updates for its children.

#### `resolved_conflicts`
A human's choice between two disagreeing facts (ADR-007).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `winning_delta_id` | uuid | → `deltas(id)` |
| `discarded_delta_id` | uuid | → `deltas(id)`, `check (discarded_delta_id <> winning_delta_id)` |
| `resolution_delta_id` | uuid | → `deltas(id)`, nullable — the new delta written to record the choice, if one was needed |
| `resolved_by` | uuid | not null |
| `rationale` | text | |

Index `(model_id, discarded_delta_id)`. Append-only.

### 3.7 Workflow

#### `capture_jobs`
One ingestion run (ADR-004).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `input_kind` | text | not null, `check (input_kind in ('spreadsheet','pdf','text'))` |
| `input_ref` | text | not null — storage pointer |
| `status` | capture_status | not null default `pending` |
| `resulting_branch_id` | uuid | → `branches(id)`, nullable until parsed; must be `kind = 'capture_draft'` |
| `stats` | jsonb | nullable — counts by match outcome (§8) |
| `error` | text | nullable |
| `created_by` | uuid | not null |
| `finished_at` | timestamptz | nullable |

Index `(model_id, status)`.

#### `merge_requests`
Request to merge a change branch into main (ADR-006).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `branch_id` | uuid | → `branches(id)`; branch must be `kind = 'change'` |
| `requested_head_commit_id` | uuid | → `commits(id)` — the head when the request was made |
| `main_head_commit_id` | uuid | → `commits(id)` — main's head when the request was made |
| `status` | merge_request_status | not null default `pending` |
| `requested_by` | uuid | not null |
| `reviewed_by` | uuid | nullable |
| `reviewed_at` | timestamptz | nullable |
| `review_notes` | text | |
| `merge_commit_id` | uuid | → `commits(id)`, nullable; set iff `status = 'merged'` |
| `classification` | jsonb | nullable — the §7 output, cached at request and at each refresh |

Partial unique `(branch_id) where status in ('pending','changes_requested','approved')` — one open request per branch. Index `(model_id, status)`.

#### `validation_results`
Outcome of running §6.3 against a commit's head.

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `commit_id` | uuid | → `commits(id)` on delete cascade |
| `level` | validation_level | not null |
| `status` | validation_status | not null |
| `findings` | jsonb | not null default `'[]'` — array of `{rule, subjectId, attribute?, message}` |
| `ran_at` | timestamptz | not null |

Primary key `(commit_id, level)`.

### 3.8 Collaboration

#### `comments`
Threaded comments anchored to a model object (ADR-010, S-16).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `parent_comment_id` | uuid | → `comments(id)`, nullable; replies must share the root's anchor (trigger) |
| `anchor_type` | anchor_type | not null |
| `anchor_id` | uuid | not null |
| `view_id` | uuid | → `views(id)`, nullable — optional visual pin |
| `hint_x`, `hint_y` | double precision | nullable |
| `author_id` | uuid | not null |
| `body` | text | not null |
| `visibility` | comment_visibility | not null default `team` |
| `status` | comment_status | not null default `open` |
| `resolved_by` | uuid | nullable |
| `resolved_at` | timestamptz | nullable |
| `edited_at` | timestamptz | nullable |

Indexes `(model_id, anchor_type, anchor_id)`, `(parent_comment_id)`. Anchor existence is checked by trigger `atlas.check_anchor` (polymorphic; Postgres cannot FK it).

#### `decisions`, `decision_arguments`, `decision_links`, `assumptions`, `evidence`
Decision record (ADR-013). Column lists as in ADR-013, with these additions: `decisions.superseded_decision_id → decisions(id)`; `decision_links` primary key `(decision_id, linked_type, linked_id)` with `linked_type` a text check over `('element','relationship','branch','assumption','evidence')`; `assumptions.linked_review_pending boolean default false` — set true on linked decisions when an assumption's status changes (the "re-review nudge"); `evidence.source_id → sources(id)` nullable, so a piece of evidence that is also a capture source is the same row in both roles.

Indexes: `decisions (model_id, status)`, `decisions (branch_id)`, `decision_links (linked_type, linked_id)`, `assumptions (model_id, status)`.

### 3.9 Views

#### `views`
A saved query, not a drawing (ADR-011).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `name` | text | not null |
| `kind` | view_kind | not null |
| `scope_element_id` | uuid | nullable; required for `context`/`container`/`component`, must be null for `landscape` |
| `branch_id` | uuid | → `branches(id)`, nullable = main |
| `created_by` | uuid | not null |

#### `view_layouts`
Per-view position hints. Deleting all rows for a view is lossless.

| Column | Type | Constraints |
|---|---|---|
| `view_id` | uuid | → `views(id)` on delete cascade |
| `subject_type` | subject_type | not null |
| `subject_id` | uuid | not null |
| `x`, `y` | double precision | nullable (elements) |
| `bends` | jsonb | nullable (relationships: array of `{x,y}`) |
| `updated_by` | uuid | not null |
| `updated_at` | timestamptz | not null |

Primary key `(view_id, subject_id)`.

#### `view_annotations`
Presentational markup that is never a fact (ADR-011).

| Column | Type | Constraints |
|---|---|---|
| `view_id` | uuid | → `views(id)` on delete cascade |
| `kind` | annotation_kind | not null |
| `geometry` | jsonb | not null |
| `text` | text | nullable |
| `created_by` | uuid | not null |

### 3.10 Starter content

#### `capability_maps`
A versioned sector starter map (ADR-012).

| Column | Type | Constraints |
|---|---|---|
| `sector` | text | not null, `check (sector in ('local_government','nhs','housing','hei','generic'))` |
| `version` | int | not null; `unique (sector, version)` |
| `status` | map_status | not null default `draft` |
| `source_description` | text | not null |
| `published_at` | timestamptz | nullable; not null iff `status = 'published'` |

No `org_id`; product content. Readable by all authenticated users; writable by service role.

#### `capability_map_items`

| Column | Type | Constraints |
|---|---|---|
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `code` | text | not null; `unique (map_id, code)` |
| `parent_code` | text | nullable → `(map_id, code)` |
| `name` | text | not null |
| `description` | text | |
| `level` | int | not null, `check (level between 1 and 3)` |

Trigger: `level = 1` ⇔ `parent_code is null`; parent's level = level − 1.

#### `capability_map_sources`

| Column | Type | Constraints |
|---|---|---|
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `citation` | text | not null |
| `url` | text | |
| `reviewed_by` | text | not null — a name, not a user id; reviewers are often external |
| `reviewed_at` | date | not null |

Seeding a model from a map (ADR-012) creates one `sources` row of kind `template` and one `template_seed` commit whose `element_create` deltas have `attributes.code` and `attributes.templateRef` set and an `aliases` row of type `template_code` per element.

---

## 4. The delta format

The authoritative definition is `src/contracts/delta.ts`. Summary:

### 4.1 Kinds

| Kind | Asserts fact | Required fields beyond base |
|---|---|---|
| `element.create` | `(elementId, $exists)` plus one fact per key in `attributes`, plus `name`, plus `parentId` | `elementId`, `elementType`, `name`, `parentId`, `attributes` |
| `element.update` | `(elementId, attribute)` | `elementId`, `elementType`, `attribute`, `value`, `previousDeltaId` |
| `element.retract` | withdraws `(elementId, $exists)` | `elementId`, `elementType`, `previousDeltaId` |
| `element.restore` | re-asserts `(elementId, $exists)` | `elementId`, `elementType`, `previousDeltaId` |
| `relationship.create` | `(relationshipId, $exists)` plus one per attribute; endpoints are part of the existence fact | `relationshipId`, `relationshipType`, `fromElementId`, `toElementId`, `attributes` |
| `relationship.update` | `(relationshipId, attribute)` | `relationshipId`, `relationshipType`, `attribute`, `value`, `previousDeltaId` |
| `relationship.retract` | withdraws `$exists` | `relationshipId`, `relationshipType`, `previousDeltaId` |
| `relationship.restore` | re-asserts `$exists` | `relationshipId`, `relationshipType`, `previousDeltaId` |

Base fields on every delta: `id`, `sourceId`, `sourceRef?`, `effectiveDate?`, `confidence`.

### 4.2 Why `previousDeltaId` on create-shaped facts

A create's initial attributes all point (in `facts`) at the create delta. The first update to any of them has `previousDeltaId = createDelta.id`. This means `facts[(subject, attr)].delta_id` is always defined for any live attribute, and C6 is uniformly checkable. Restore's `previousDeltaId` is the retract it reverses; a restored subject's attribute facts are recovered by following each attribute's chain to its last live assertion before the retract (§6.2 `apply`).

### 4.3 Clearing a value

`element.update` with `value: null` clears an optional attribute (the fact then reads "known to be unset", with provenance). Required attributes (per `type_schemas`) cannot be cleared; V1 rejects it at the level required for the branch.

### 4.4 Wire ↔ storage mapping

| Wire (TS) | Storage (`deltas`) |
|---|---|
| `kind: 'element.update'` | `kind = 'element_update'` (dot → underscore) |
| `elementId` / `relationshipId` | `subject_id` (+ `subject_type` derived from kind) |
| `attribute` | `attribute`; absent on create/retract/restore → `'$exists'` |
| `attributes` (create) | `value` |
| `value` (update) | `value` |
| `parentId` | `parent_id` |
| `fromElementId`, `toElementId` | `from_element_id`, `to_element_id` |
| `previousDeltaId` | `previous_delta_id` |
| `sourceId`, `sourceRef`, `effectiveDate`, `confidence` | `source_id`, `source_ref`, `effective_date`, `confidence` |
| array index in `CommitEnvelope.deltas` | `seq` |

Attribute keys inside `value` stay camelCase in jsonb (they are validated by `type_schemas`, which is generated from the TS types; no per-key translation).

---

## 5. Commits

### 5.1 Structure

`CommitEnvelope` in `delta.ts`: `id`, `branchId`, `parentCommitId`, `mergedBranchHeadCommitId`, `kind`, `message`, `authorId`, `deltas[]`.

Kinds:

- `manual` — a person's edit on a change branch.
- `capture` — output of a capture job, on a `capture_draft` branch. Exactly one per capture branch.
- `template_seed` — the first commit of a model seeded from a capability map, on main. The only non-merge commit that can ever be on main.
- `merge` — second parent set. On a change branch: a refresh (pull main in). On main: the merge of an approved change branch (created only by `atlas.merge_branch`).

### 5.2 Invariants

`COMMIT_INVARIANTS` in `delta.ts` is the list (C1–C16). They are checked in this order, and the first failure rejects the whole commit:

1. Shape: C1, C2, C3, C14.
2. Intra-commit: C4.
3. Against history: C5 (id never used), C13 (parent is current head), C12 (source in model).
4. Against parent head: C6 (previousDeltaId matches `facts`), C7 (exists/not-exists preconditions).
5. Against resulting head: C8, C9, C10, C11, C15.
6. Validation level for the branch kind: C16 → §6.3.

C6 is the one that turns concurrent editing into a rejected commit rather than a lost update. Two people editing the same attribute of the same element on the same branch: the second submit fails C6 and must re-read.

### 5.3 Who writes commits

| Branch kind | Writer | Path |
|---|---|---|
| `capture_draft` | capture worker (service role) | direct insert, then `branches.head_commit_id` update |
| `change` | contributor+ via API | RLS-permitted insert (§9) inside `atlas.commit(envelope)` which runs the C-checks in one transaction |
| `main` | nobody directly | `atlas.merge_branch`, `atlas.seed_from_map` (security definer) |

---

## 6. Head rebuild and its proof

### 6.1 Definitions

- `ancestry(c)`: the set of commits reachable from `c` via `parent_commit_id` and `merged_branch_head_commit_id`, including `c`.
- `exclusive(c2, c1)`: `ancestry(c2) \ ancestry(c1)`.
- `topo(S)`: commits in `S` sorted so parents precede children; ties broken by `(depth, created_at, id)`.
- `Head`: `{ elements: Map<id, ElementRow>, relationships: Map<id, RelRow>, facts: Map<(subjectId, attribute), FactRow> }`.

### 6.2 Fold (full rebuild from genesis)

```
fold(c: Commit | null) -> Head
  if c is null: return emptyHead()
  if c.kind == 'merge':
    H = fold(c.parent)                                     // first parent: the branch this commit is on
    for c2 in topo(exclusive(c.mergedBranchHead, c.parent)):
      for d in deltasOf(c2) ordered by seq: apply(H, d)    // the other side, in order
  else:
    H = fold(c.parent)
  for d in deltasOf(c) ordered by seq: apply(H, d)         // this commit's own deltas (resolutions, on a merge)
  return H

apply(H, d):
  key = factKeyOf(d)
  switch d.kind:
    element.create:
      H.elements[d.elementId] = { type: d.elementType, name: d.name, parentId: d.parentId, attributes: d.attributes, existsDeltaId: d.id }
      H.facts[(d.elementId, '$exists')] = fact(d, value = { type, name, parentId })
      H.facts[(d.elementId, 'name')]    = fact(d, d.name)
      H.facts[(d.elementId, 'parentId')]= fact(d, d.parentId)
      for (k, v) in d.attributes: H.facts[(d.elementId, k)] = fact(d, v)
    element.update:
      e = H.elements[d.elementId]                          // must exist (C7)
      if d.attribute == 'name': e.name = d.value
      else if d.attribute == 'parentId': e.parentId = d.value
      else if d.value is null: delete e.attributes[d.attribute]
      else: e.attributes[d.attribute] = d.value
      H.facts[key] = fact(d, d.value)
    element.retract:
      delete H.elements[d.elementId]
      for every (s, a) in H.facts with s == d.elementId: delete H.facts[(s, a)]
      H.facts[(d.elementId, '$exists')] = fact(d, value = null, live = false)   // tombstone kept for C7/restore
    element.restore:
      // rebuild the row from the delta chain: for each attribute, the newest delta
      // in ancestry with that fact key whose commit precedes the retract in topo order
      e = reconstructElement(d.elementId, before = d.previousDeltaId)
      H.elements[d.elementId] = { ...e, existsDeltaId: d.id }
      H.facts[(d.elementId, '$exists')] = fact(d, value = { type, name, parentId })
      for (k, f) in reconstructedFacts: H.facts[(d.elementId, k)] = f   // original provenance, not the restore's
    relationship.*: symmetric, with from/to on the row and inside the $exists fact value
```

`fact(d, value)` copies `d.id, d.sourceId, d.sourceRef, d.effectiveDate, d.confidence, commit.authorId, commit.createdAt`.

A tombstone `$exists` fact with `live = false` is kept in memory for C7 checks and dropped from the `facts` table on persist (the table holds live facts only; the retract delta is found via `deltas.previous_delta_id` chains).

### 6.3 Validation gate (on the folded head)

| Rule | Level | Check |
|---|---|---|
| V1 | schema | every `elements_head.attributes` and `relationships_head.attributes` validates against `type_schemas` for `(type, models.schema_version)`; required attributes present |
| V2 | structural | every `parent_id` references an element in the same head with the required type: capability→capability, container→system, component→container; capability/system/actor parents are null or (capability only) a capability. Every relationship endpoint references an element in the same head. |
| V3 | schema | every relationship's `(type, from.type, to.type)` is in `relationship_type_rules`; `max_per_from` and `max_primary_per_to` respected |
| V4 | structural | no cycle in `parent_id` |
| V5 | structural | no element id in the head appears as `merged_element_id` in `element_merges` |
| V6 | structural | no two relationships in the head share `(type, from, to)` |

Required levels per branch kind: `capture_draft` none (only C1–C6); `change` structural, schema recorded to `validation_results` as advisory; `main` both. A merge request cannot move to `approved` unless the branch head has `validation_results (schema) = pass`.

### 6.4 Canonical hash

```
canonical(H) =
  JSON with sorted keys and no whitespace of
  { elements: sortBy(id, H.elements as [id, type, name, parentId, sortedAttributes, existsDeltaId]),
    relationships: sortBy(id, ... [id, type, from, to, sortedAttributes, existsDeltaId]),
    facts: sortBy((subjectId, attribute), ... [subjectId, attribute, value, deltaId]) }
head_hash(H) = sha256(utf8(canonical(H)))
```

`facts` contributes only `(subjectId, attribute, value, deltaId)` to the hash — provenance columns are functions of `deltaId`, so hashing them would be redundant.

### 6.5 Incremental rebuild (what the materialiser actually runs)

```
materialise(c):
  if c.kind == 'merge':
    H = load(c.parent) or fold(c.parent)                    // parent head is retained if it was a branch head; else replay from nearest retained ancestor
    for c2 in topo(exclusive(c.mergedBranchHead, c.parent)): applyAll(H, deltasOf(c2))
  else:
    H = load(c.parent) or replayFromNearestRetained(c.parent)
  applyAll(H, deltasOf(c))
  runValidation(H, levelsFor(branchKind(c)))
  persist(elements_head, relationships_head, facts) for c
  commits.head_hash := head_hash(H)
  gcOldHeads(branch)                                         // drop rows for the previous head unless tagged

replayFromNearestRetained(c):
  r = nearest ancestor of c (first-parent chain) with retained head rows, else genesis
  H = load(r) or emptyHead()
  for x in topo(exclusive(c, r)): applyAll(H, deltasOf(x))
  return H
```

Bound: replay cost is O(deltas since the nearest tag or branch head), never O(all history), because tags are retained.

### 6.6 The proof obligation: `head == fold(deltas)`

The materialiser is trusted only because these three equalities are checked:

1. **Property test P-2** (every CI run): for random commit DAGs, `head_hash(materialise(c)) == head_hash(fold(c))` where `fold` is the §6.2 reference implementation with no caching.
2. **Integrity job** (nightly, per model): for every retained commit `c`, recompute `fold(c)` from genesis and compare to `commits.head_hash` and to the persisted rows (row-by-row, not just hash). Any mismatch: raise an incident, mark `validation_results` for `c` as `fail` with rule `HASH`, and refuse merges on that model until repaired.
3. **On tag creation**: `fold(commit)` is recomputed from genesis before the tag row is inserted. A tag is the one moment the cost is always paid, so that anything a version is cited for was verified from first principles.

Order-independence (P-3) is a second obligation: for commits whose delta fact-key sets are disjoint, applying them in either order yields the same `head_hash`. This is what makes `topo`'s tie-break irrelevant for correctness and only relevant for determinism.

---

## 7. Merge algorithm

### 7.1 Setup

```
mergeBase(B):        // B is a change branch
  // main's first-parent chain is linear; the merge base is the newest main commit in B's ancestry
  return max by depth of ( ancestry(B.head) ∩ mainChain )

base   = head(mergeBase(B))
ours   = head(B.head)
theirs = head(main.head)
```

The same three heads serve both a **refresh** (merge main → B, producing a `merge` commit on B) and the **final merge** (B → main). ADR-006's precondition "base is an ancestor of main's head" is now: `mergeBase(B) == main.head`. If not, the branch needs a refresh first; the final merge is then a merge commit with zero deltas (C15 has nothing to resolve), and `atlas.merge_branch` is an assertion followed by a pointer move.

### 7.2 Per-key three-way comparison

For every fact key `k` in `keys(base) ∪ keys(ours) ∪ keys(theirs)`:

```
b = base.facts[k]?.deltaId ; o = ours.facts[k]?.deltaId ; t = theirs.facts[k]?.deltaId
vb, vo, vt = the corresponding values (undefined if absent)

oursChanged   = (o != b)
theirsChanged = (t != b)

if !oursChanged && !theirsChanged:            UNCHANGED
elif oursChanged && !theirsChanged:            OURS       (take ours)
elif !oursChanged && theirsChanged:            THEIRS     (take theirs)
elif vo == vt (deep equal):                    CONVERGED  (take either; record both delta ids in resolved_conflicts with rationale 'converged')
else:                                          FIELD_CONFLICT
```

Comparing on `deltaId`, not value, is deliberate: a re-assertion of the same value from a better source is a change to provenance and is carried across.

### 7.3 Element-level classification

Field results are grouped per subject and lifted to element level. Let `E(o)`, `E(t)` be existence on each side.

| Situation | Class | Blocking? |
|---|---|---|
| All keys UNCHANGED/OURS/THEIRS/CONVERGED | **clean** | no |
| Any key FIELD_CONFLICT, subject exists on both sides | **field conflict** | yes |
| Retracted on one side, any attribute key changed on the other | **structural: retract-vs-modify** | yes |
| Retracted on one side, a relationship created on the other with it as endpoint | **structural: dangling endpoint** | yes |
| Retracted on one side, an element re-parented under it on the other | **structural: dangling parent** | yes |
| Both sides create a relationship with the same `(type, from, to)` and different ids | **structural: duplicate relationship** | yes |
| `owns.primary = true` created on both sides for the same target | **structural: cardinality** (V3 would fail) | yes |
| Both sides create elements that match under §8 rule 3 (name + type + context) | **identity** | no (advisory) |
| Both sides create elements with the same `alias_value` in `aliases` | **identity** (strong) | no (advisory) |

"Structural" conflicts are those where taking both sides mechanically would fail V2, V3 or V6. They are detected by running the union head through the structural rules and mapping each finding back to the pair of changes that caused it.

### 7.4 What the review queue shows

The queue renders `merge_requests.classification` (cached; recomputed on every push to the branch and every main advance). For a request the reviewer sees:

**Summary row**: branch title, requester, counts by class, `validation_results` for both levels at the branch head, and a red "refresh required" state when `mergeBase(B) != main.head` and any blocking class is non-empty.

**Clean changes** (collapsed by default): per element, the list of `OURS` keys with old → new value and the delta's source, confidence, effective date. Relationships created/retracted listed by `type from → to`. This is the as-is / to-be diff and is the only section for most merges.

**Field conflicts** (one card per fact key):
- element name, type, breadcrumb (parent chain)
- three columns: *base* (value, source, date, confidence, author), *this change* (same), *main now* (same)
- actions: keep this change / keep main / enter a value. Any action writes a `merge` commit on the branch (a refresh) containing one resolution delta with `sourceId` = a `merge_resolution` source, `previousDeltaId` = ours' delta id, plus a `resolved_conflicts` row (`discarded_delta_id` = the losing side's delta id; `winning_delta_id` = the chosen one or the resolution delta itself for a typed-in value).

**Structural conflicts** (one card per retracted element):
- the retract (which side, by whom, source) and every dependent change on the other side
- actions: *keep retraction* (the refresh commit also retracts the dependants / re-parents children to the retracted element's own parent) or *keep element* (the refresh commit restores it via `element.restore` on the side that retracted — which, if that side is main, means the resolution is a restore on the branch, and main's retract will be superseded on merge). Duplicate relationships: pick which id survives; the other is retracted. Cardinality: pick the primary owner; the other becomes `primary = false`.

**Identity warnings** (one card per pair): both elements side by side with the match score and the matching context; actions: *merge now* (runs `atlas.merge_elements` on the branch, survivor chosen by the reviewer) or *keep both* (dismiss; recorded in `classification` so it does not reappear). Never blocks approval.

**Approval** is enabled only when: no blocking class remains, `mergeBase(B) == main.head`, schema validation passes at the branch head, and the reviewer holds `architect` or `owner`. Approving sets `branches.status = 'approved'`; merging calls `atlas.merge_branch`, which re-checks all four conditions inside the transaction (they can go stale between the click and the commit), writes the `merge` commit on main, moves `branches.head_commit_id` for main, marks the request `merged` and the branch `merged`, and materialises the new main head. If main moved in between, the procedure fails with `REFRESH_REQUIRED` and the request returns to `pending`.

### 7.5 Refresh

`atlas.refresh_branch(branch_id, resolutions[])` produces the `merge` commit on the branch: `parent = B.head`, `mergedBranchHead = main.head`, deltas = the supplied resolutions. C15 is checked: the set of fact keys in `resolutions` must equal the set of FIELD_CONFLICT keys (plus the deltas implied by structural choices). After refresh, `mergeBase(B) == main.head` by construction.

---

## 8. Matching (capture pipeline)

Order, first hit wins:

1. **Exact id** — the source carries an Atlas element id (a round-tripped export). Match if the id exists in `elements_head` at main's head or in `aliases` as `merged_id` (resolve to the survivor).
2. **Alias** — normalised token (`lower`, collapse whitespace, strip punctuation) equals `lower(alias_value)` for the model. `aliases` uniqueness guarantees one hit.
3. **Name + type + context** — trigram similarity of normalised name ≥ 0.6 against `elements_head.name` where `element_type` matches **and** the structural context matches: for a container/component the proposed parent resolves to the same parent; for a capability the proposed parent code/name resolves to the same parent; for systems and actors the context is the type alone. Multiple hits above threshold → propose the best but flag `ambiguous` in `capture_jobs.stats` and in the delta's `sourceRef`.
4. **No match** → `element.create` with a fresh id, confidence as scored by the extractor.

Every match at level 2 or 3 also emits an `aliases` insert proposal (type `name` or `source_system_key`) so the next document matches at level 2.

---

## 9. RLS

Helper functions live in schema `atlas`, are `security definer`, and read `members` and `model_shares` directly (those tables also have RLS; definer functions bypass it, which is the point).

```sql
create schema if not exists atlas;

-- Role of the current user in an organisation, or null.
create or replace function atlas.member_role(p_org uuid)
returns member_role
language sql stable security definer
set search_path = public, pg_temp
as $$
  select m.role from members m
  where m.org_id = p_org and m.user_id = auth.uid();
$$;

create or replace function atlas.is_member(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from members m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create or replace function atlas.has_role(p_org uuid, variadic p_roles member_role[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select atlas.member_role(p_org) = any (p_roles);
$$;

-- True if the current user's org has a live share on the model.
create or replace function atlas.model_shared_with_me(p_model uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from model_shares s
    join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
    where s.model_id = p_model
      and (s.expires_at is null or s.expires_at > now())
  );
$$;

-- True if a specific commit is readable through a share:
--   tag-pinned share  -> only that tag's commit
--   unpinned share    -> any commit on the model's main branch
create or replace function atlas.commit_shared_with_me(p_commit uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from commits c
    join model_shares s on s.model_id = c.model_id
    join members m on m.org_id = s.shared_with_org_id and m.user_id = auth.uid()
    left join tags t on t.id = s.tag_id
    join branches b on b.id = c.branch_id
    where c.id = p_commit
      and (s.expires_at is null or s.expires_at > now())
      and (
        (s.tag_id is null and b.kind = 'main')
        or (s.tag_id is not null and t.commit_id = c.id)
      )
  );
$$;

-- True if a viewer-role member may see this branch's content.
create or replace function atlas.branch_visible_to_viewer(p_branch uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from branches b
    where b.id = p_branch and (b.kind = 'main' or b.shared_for_review);
  );
$$;

-- True if a viewer may see the object a comment is anchored to.
create or replace function atlas.anchor_visible_to_viewer(p_type anchor_type, p_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_type
    when 'decision' then true
    when 'branch'   then atlas.branch_visible_to_viewer(p_id)
    when 'delta'    then exists (
                      select 1 from deltas d join commits c on c.id = d.commit_id
                      where d.id = p_id and atlas.branch_visible_to_viewer(c.branch_id))
    when 'element'  then exists (
                      select 1 from elements_head eh join branches b on b.head_commit_id = eh.commit_id
                      where eh.element_id = p_id and (b.kind = 'main' or b.shared_for_review))
    when 'relationship' then exists (
                      select 1 from relationships_head rh join branches b on b.head_commit_id = rh.commit_id
                      where rh.relationship_id = p_id and (b.kind = 'main' or b.shared_for_review))
  end;
$$;
```

### 9.1 `organisations`

```sql
alter table organisations enable row level security;
alter table organisations force row level security;

create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id));

-- Anyone signed in may create an org; a trigger makes them its owner.
create policy organisations_insert on organisations
  for insert to authenticated
  with check (created_by = auth.uid());

create policy organisations_update on organisations
  for update to authenticated
  using (atlas.has_role(id, 'owner'))
  with check (atlas.has_role(id, 'owner'));

create policy organisations_delete on organisations
  for delete to authenticated
  using (atlas.has_role(id, 'owner'));
```

`members` (needed for the above to be meaningful):

```sql
alter table members enable row level security;
alter table members force row level security;

create policy members_select on members
  for select to authenticated
  using (atlas.is_member(org_id));

create policy members_insert on members
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner') and invited_by = auth.uid());

create policy members_update on members
  for update to authenticated
  using (atlas.has_role(org_id, 'owner'))
  with check (atlas.has_role(org_id, 'owner'));

-- Owners remove anyone; anyone may leave. The last-owner constraint trigger stops an org losing its last owner.
create policy members_delete on members
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner') or user_id = auth.uid());
```

### 9.2 `models`

```sql
alter table models enable row level security;
alter table models force row level security;

create policy models_select on models
  for select to authenticated
  using (atlas.is_member(org_id) or atlas.model_shared_with_me(id));

create policy models_insert on models
  for insert to authenticated
  with check (atlas.has_role(org_id, 'owner', 'architect') and created_by = auth.uid());

create policy models_update on models
  for update to authenticated
  using (atlas.has_role(org_id, 'owner', 'architect'))
  with check (atlas.has_role(org_id, 'owner', 'architect'));

create policy models_delete on models
  for delete to authenticated
  using (atlas.has_role(org_id, 'owner'));
```

### 9.3 `commits`

```sql
alter table commits enable row level security;
alter table commits force row level security;

create policy commits_select on commits
  for select to authenticated
  using (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    or (
      atlas.has_role(org_id, 'viewer')
      and (
        atlas.branch_visible_to_viewer(branch_id)
        or exists (select 1 from tags t where t.commit_id = commits.id)
      )
    )
    or atlas.commit_shared_with_me(id)
  );

-- Direct inserts: contributors and above, on a draft change branch they can see,
-- as the author. Never on main (S-17) and never on capture_draft (service role only).
create policy commits_insert on commits
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and author_id = auth.uid()
    and kind in ('manual', 'merge')
    and exists (
      select 1 from branches b
      where b.id = commits.branch_id
        and b.org_id = commits.org_id
        and b.model_id = commits.model_id
        and b.kind = 'change'
        and b.status = 'draft'
    )
  );

-- No update or delete policies: append-only for every application role.
-- atlas.merge_branch / atlas.seed_from_map are security definer and are the only
-- writers of commits whose branch is main.
```

`deltas` follow `commits` exactly (select through the commit's visibility; insert only alongside a commit the same user may insert; no update/delete). The policy is the same predicate applied via `exists (select 1 from commits c where c.id = deltas.commit_id)` — the RLS on `commits` does the work.

### 9.4 `comments`

```sql
alter table comments enable row level security;
alter table comments force row level security;

create policy comments_select on comments
  for select to authenticated
  using (
    atlas.is_member(org_id)
    and (
      atlas.has_role(org_id, 'owner', 'architect', 'contributor')
      or (
        visibility = 'team'
        and atlas.anchor_visible_to_viewer(anchor_type, anchor_id)
      )
    )
  );

create policy comments_insert on comments
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and author_id = auth.uid()
    and status = 'open'
    and resolved_by is null
  );

-- Authors edit their own body; architects and owners may also resolve/unresolve.
-- Column-level grants restrict what each may touch; the trigger below enforces the split.
create policy comments_update on comments
  for update to authenticated
  using (
    atlas.is_member(org_id)
    and (author_id = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  )
  with check (
    atlas.is_member(org_id)
    and (author_id = auth.uid() or atlas.has_role(org_id, 'owner', 'architect'))
  );

revoke update on comments from authenticated;
grant update (body, edited_at, status, resolved_by, resolved_at) on comments to authenticated;

create or replace function atlas.guard_comment_update()
returns trigger
language plpgsql
as $$
begin
  -- Only architects/owners change resolution state.
  if (new.status, new.resolved_by, new.resolved_at) is distinct from (old.status, old.resolved_by, old.resolved_at)
     and not atlas.has_role(new.org_id, 'owner', 'architect') then
    raise exception 'only architects or owners may resolve comments' using errcode = '42501';
  end if;
  -- Only the author edits the body.
  if new.body is distinct from old.body and new.author_id <> auth.uid() then
    raise exception 'only the author may edit a comment' using errcode = '42501';
  end if;
  -- Resolution metadata must be consistent.
  if new.status = 'resolved' and (new.resolved_by is null or new.resolved_at is null) then
    raise exception 'resolved comments need resolved_by and resolved_at';
  end if;
  if new.status = 'open' and (new.resolved_by is not null or new.resolved_at is not null) then
    raise exception 'open comments must not carry resolution metadata';
  end if;
  return new;
end;
$$;

create trigger comments_guard_update
  before update on comments
  for each row execute function atlas.guard_comment_update();

-- No delete policy: comments are never deleted, only resolved.
```

### 9.5 Pattern for every other table

Every remaining table uses one of three templates, chosen per table:

| Template | Select | Insert/Update | Tables |
|---|---|---|---|
| **Member-scoped** | `is_member(org_id)` (+ viewer restriction where the row can reveal draft content) | `has_role(org_id, 'owner','architect')` or contributor+ per table | `branches`, `tags` (insert architect+, no update/delete), `sources`, `aliases`, `merge_requests`, `capture_jobs`, `decisions*`, `assumptions`, `evidence`, `views`, `view_layouts`, `view_annotations`, `validation_results` |
| **Commit-scoped** | visible iff `commits_select` would pass for `commit_id` | service role only | `elements_head`, `relationships_head`, `facts`, `deltas` |
| **Product content** | `to authenticated using (true)` | service role only | `type_schemas`, `relationship_type_rules`, `capability_maps`, `capability_map_items`, `capability_map_sources` |

`element_merges` and `resolved_conflicts`: member-scoped select, insert via procedure only.

---

## 10. Tests that must exist before any UI is built

All property tests use generated inputs (fast-check or equivalent) with shrinking, and run against a real Postgres (testcontainers), not a mock. "Reference fold" means the §6.2 pseudocode implemented plainly, without caching, kept in the test tree.

### 10.1 Round-trip

| Id | Test |
|---|---|
| RT-1 | For every `DeltaKind`: arbitrary `Delta` → JSON → `Delta` is deep-equal; `Delta` → `deltas` row → `Delta` is deep-equal (the §4.4 mapping is a bijection on valid deltas). |
| RT-2 | Arbitrary valid `CommitEnvelope` → `atlas.commit` → read back commit + deltas ordered by `seq` → equals the envelope (ids and order preserved). |
| RT-3 | Arbitrary model with a tag → export (elements, relationships, facts at the tag) → import into a fresh model preserving ids → `head_hash` equal. |
| RT-4 | Seed a model from a `capability_maps` version → diff the seeded head against the map → empty; every seeded element has a `template_code` alias and `attributes.templateRef`. |
| RT-5 | `type_schemas.json_schema` generated from `src/contracts/delta.ts` equals the checked-in seed, and every arbitrary `ElementAttributesByType[T]` validates against the schema for `T` (and an arbitrary object with one required key removed does not). |
| RT-6 | `atlas.merge_elements(a, b)` then resolve `a` and `b` through `aliases` → same survivor; `deltas` and `relationships_head` rows that referenced `b` before the merge are byte-identical after it (history untouched); the survivor carries every relationship `b` had, deduplicated per S-6. |
| RT-7 | For an arbitrary `views` row: node and edge set returned by the view query is identical before and after deleting all `view_layouts` and `view_annotations` rows for it. |
| RT-8 | Comment anchored to a delta on a change branch → merge the branch → the anchor resolves to the same `deltas` row, now reachable from main's ancestry; comment count on the element unchanged. |

### 10.2 Properties — fold and materialisation

| Id | Property |
|---|---|
| P-1 | `fold` is deterministic: two runs over the same DAG give the same `head_hash`. |
| P-2 | For arbitrary commit DAGs (branch, refresh, merge, tags, GC in between): `head_hash(materialise(c)) == head_hash(fold(c))` and the persisted rows equal the reference fold row-for-row. |
| P-3 | For two commits with disjoint fact-key sets, applying them in either order gives the same `head_hash`. |
| P-4 | `apply(apply(H, retract(x)), restore(x))` has the same elements/relationships/facts for `x` as `H`, and the recovered facts keep their original `delta_id`/provenance (not the restore's). |
| P-5 | For every live fact, following `previous_delta_id` terminates at a create delta for that subject; the chain length equals the number of updates to that key in the fact's ancestry; no chain has a cycle. |
| P-6 | Snapshot-and-replay: after GC, every branch head and every tagged commit still has head rows; no other commit does; `replayFromNearestRetained(c)` for any commit equals `fold(c)`. |
| P-7 | Tag creation recomputes from genesis: injecting a corrupted `elements_head` row for the tagged commit before tagging causes tag creation to fail. |

### 10.3 Properties — commit invariants and validation

| Id | Property |
|---|---|
| P-8 | For each invariant C1–C16 there is a generator that produces an otherwise-valid envelope violating exactly that invariant, and `atlas.commit` rejects it naming that id. Valid envelopes are accepted. |
| P-9 | For each rule V1–V6 there is a generator that mutates a valid head to violate exactly that rule, and the gate reports exactly that rule; the resulting head is refused on main and (structural rules) on change branches, and accepted on `capture_draft` with the finding recorded. |
| P-10 | Concurrency: two envelopes with the same `parentCommitId` submitted to the same branch → exactly one succeeds (C13); two envelopes on sequential parents updating the same fact key with the same `previousDeltaId` → the second fails C6. |
| P-11 | Id reuse: an `element.create` with an id that appears in any delta of the model on any branch (including a retracted or merged-away one) is rejected (C5). |

### 10.4 Properties — merge

| Id | Property |
|---|---|
| P-12 | `classify(base, ours=base, theirs)` is all THEIRS/UNCHANGED and clean; `classify(base, ours, theirs=base)` is all OURS/UNCHANGED and clean. |
| P-13 | Swapping ours and theirs swaps OURS↔THEIRS and leaves the set of FIELD_CONFLICT, structural and identity keys unchanged. |
| P-14 | For an arbitrary branch and main with generated divergence: the set of FIELD_CONFLICT keys equals the set of keys changed on both sides to non-equal values; CONVERGED keys are exactly those changed on both sides to deep-equal values. |
| P-15 | For every blocking class there is a generator; the resulting union head fails at least one of V2/V3/V6 when the class is structural, and never fails them when the class is field-only. |
| P-16 | Refresh with resolutions covering exactly the FIELD_CONFLICT set passes C15; any missing or extra key is rejected; after refresh `mergeBase(B) == main.head`. |
| P-17 | `atlas.merge_branch` on a branch with `mergeBase(B) == main.head` and no blocking classes produces a merge commit with zero deltas whose head equals `ours`; on a branch where main has since advanced it fails with `REFRESH_REQUIRED` and changes nothing. |
| P-18 | Identity warnings never prevent approval or merge; dismissing one persists in `classification` and it is not raised again for the same pair. |

### 10.5 Properties — matching and aliases

| Id | Property |
|---|---|
| P-19 | An element with an alias for string `s` is matched at level 2 for `s`, regardless of any other element whose name is within trigram threshold of `s`. |
| P-20 | Two elements of different types with identical names never match each other; two containers with identical names under different systems never match each other. |
| P-21 | `aliases` uniqueness: inserting the same `(alias_type, alias_value)` for two elements in one model fails; the same value in two models succeeds. |

### 10.6 Properties — access

| Id | Property |
|---|---|
| P-22 | For random (org, user, role) and random artefacts: a user sees zero rows from any table for an org they are not a member of and that has not shared with them. |
| P-23 | Viewer matrix: a viewer sees commits/heads/deltas on main, tagged commits, and `shared_for_review` branches, and nothing on draft or capture branches; sees `team` comments whose anchors are visible and never `internal` ones. |
| P-24 | Share matrix: a member of a shared-with org sees exactly the pinned tag's commit and heads (tag-pinned) or main's commits and heads (unpinned), never branches, comments, decisions or sources; nothing after `expires_at`. |
| P-25 | Write matrix: contributor can insert commits on draft change branches only; viewer cannot insert anything model-bearing; nobody with an application role can insert a commit on main, update or delete a commit, delta or tag; only architect+ can create tags, approve merge requests, or resolve comments. |
| P-26 | Last owner: deleting or demoting the sole owner of an org fails. |

### 10.7 Properties — content

| Id | Property |
|---|---|
| P-27 | Capability map upgrade: seed v1, rename and re-parent arbitrary items, publish v2 with arbitrary additions/renames; the computed upgrade diff matches every renamed item through its `template_code` alias and creates no duplicates. |
| P-28 | `owns` cardinality: at most one `primary = true` owner per target survives V3; a second is a cardinality conflict at merge and a V3 failure on commit. |

A UI ticket may not be opened until RT-1…RT-8 and P-1…P-28 exist and pass in CI.
