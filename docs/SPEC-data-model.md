# SPEC: Data model and delta specification

**Status:** Proposed
**Depends on:** `docs/ADR-000-foundations.md` (ADR-001 … ADR-017)
**Companion:** `src/contracts/delta.ts` (the delta and commit wire contract)

This document turns the ADRs into tables, a wire format, and algorithms precise enough to test against. It contains no UI and no engine code: the TypeScript is types only, the SQL is DDL-shaped table descriptions plus real RLS policies, the algorithms are pseudocode.

Where an ADR left a choice open, this spec makes it. Every such choice is listed in §1 so it can be challenged in one place.

---

## 1. Decisions made by this spec

| # | Choice | Why |
|---|---|---|
| S-1 | **Ids are UUID v7, minted by the writer** (client, capture worker, merge tool). The server enforces uniqueness; it does not assign. | A create followed by an update in the same branch needs the id before the round trip. v7 keeps indexes append-friendly. |
| S-2 | **Head tables are keyed by `commit_id`, not `branch_id`.** ~~`branches.head_commit_id` points at a materialised commit. Rows are retained for (a) every branch head, (b) every tagged commit, (c) nothing else.~~ **Superseded by ADR-015 (Sprint H1 amendment — docs/AUDIT-2026-09-U2.md §2.E.3 item 17):** rows are retained only for `main`'s current head and every tag (which must resolve to a commit on `main`, S-21) — a `change` branch's head is never materialised at all, at any point in its life. See §3.5. | One representation serves `main`'s head and tags (ADR-003 as narrowed by ADR-015). Old main heads are garbage-collected unless tagged, never authoritative. |
| S-3 | **One `parent_id` column on `elements_head`**, not three per-type columns. The parent's required type is a validation rule (V2). | ADR-001's three FK columns were shorthand; a discriminated single table wants one column. |
| S-4 | **Promoted columns on `elements_head` are `name` and `parent_id` only.** Everything else lives in `attributes` jsonb. | Search, integrity and layout need those two; nothing else needs a column. |
| S-5 | **Relationship endpoints are immutable.** To re-point, retract and create. | Keeps the fact key model simple; a moved edge is a different fact. |
| S-6 | **Relationships are unique on `(commit, type, from, to)`**, `flows_to` included. Multiple data flows between the same pair are one `flows_to` with a richer description. | Small taxonomy. A duplicate is a merge conflict (§7), not a modelling feature. |
| S-7 | **`sources` is a first-class table**; `deltas.source_id` is a foreign key, not free text. Manual edits use an auto-created per-`(model, user)` source of kind `manual`. | Provenance must be joinable and countable ("how much of this landscape rests on one spreadsheet"). |
| S-8 | **`facts` is a materialised projection at attribute grain**, retained with the same rule as heads. `deltas` remains the only source of truth. | ADR-007's per-field provenance needs a cheap lookup; three-way merge needs `facts[commit][key]` in O(1). |
| S-9 | **`element.restore` / `relationship.restore` exist.** A retract is reversible by a new delta, never by deleting the retract. | Keeps history append-only on draft branches too (ADR-002). |
| S-10 | **Existence is a fact** with reserved attribute `$exists`; `previous_delta_id` on retract/restore points at the existence chain. | One supersession mechanism for everything. |
| S-11 | **Refresh = merge main into the branch** (a `merge` commit on the branch whose second parent is a main commit). The merge base is computed from the DAG, not stored, and is always the authority for As-is (§6.2, §7.1). **Amended (Sprint C1, ADR-005 amendment):** `branches.base_commit_id` is not the original fork point forever — it is set to `main`'s head at fork and moves to `main`'s (new) head on every successful refresh, so it stays equal to `mergeBase(B)` between refreshes and folding at `base_commit_id` is a correct, O(1) way to compute As-is without a DAG walk on every read. It is display data derived from `mergeBase(B)`, kept in sync by refresh, not an independent source of truth the DAG could disagree with. The original fork point is not itself stored or selectable after a refresh moves it forward; it stays discoverable only via commit ancestry — the `parent_commit_id` of the branch's first own commit. | ADR-006's "refresh or rebase" becomes one mechanism with the same conflict rules as the final merge; ADR-005's amendment keeps its as-is definition and this row from silently disagreeing once refresh exists. |
| S-12 | **A merge commit carries only resolution deltas** (C15). A field conflict with no resolution delta is a rejected commit; there is no "theirs wins by default". | ADR-005: conflicts are surfaced, never silently resolved. |
| S-13 | **Identity conflicts are advisory** in the review queue; they do not block a merge. Structural and field conflicts do. | ADR-005(c): identity is resolved via `element_merges` after the fact; blocking on a fuzzy match would stall every capture. |
| S-14 | **Validation has two levels.** *Structural* (V2, V4, V5, V6) is required on every commit of every branch kind except `capture_draft`. *Schema* (V1, V3) is required on main and to approve a merge request; on change branches it is reported, not enforced. `capture_draft` requires only C1–C6. | ADR-001: drafts may be temporarily invalid; ADR-003: main never is. |
| S-15 | **`commits.head_hash`** is the SHA-256 of the canonical head (§6.4). It is the proof that materialisation equals fold. **Set only for commits on `main` (Sprint H1 clarification — docs/AUDIT-2026-09-U2.md §2.E.3 item 16); always `null` for `change`/`capture_draft` commits, which are never materialised (§3.5) and so have nothing to hash against.** | Makes "head == fold(deltas)" a checkable equation rather than a belief, on the one branch kind where a materialised head actually exists to check it against. |
| S-16 | **One anchor per comment, stored inline** (`anchor_type`, `anchor_id` on `comments`). No `comment_anchors` join. | ADR-010 already fixed one anchor; a join table for a 1:1 is noise. |
| S-17 | ~~**Direct commits to main are impossible via RLS.** Main advances only through `atlas.merge_branch(merge_request_id)`, a security-definer procedure.~~ **Superseded by ADR-015 (Sprint H1 amendment — docs/AUDIT-2026-09-U2.md §2.E.3 item 7):** `atlas.commit_deltas`, a security-definer function `authenticated` is granted execute on, lets an owner/architect commit directly to `main`. `atlas.merge_branch` does not exist and was never built — the real gate is role-based (owner/architect on `main`, permanently; a contributor is rejected inside `commit_deltas` itself, not by a policy it bypasses), not "no direct writes at all." | Makes ADR-006's gate structural (the contributor exclusion is enforced in the function body, not left to convention), not the unconditional block originally described. |
| S-18 | **New commits are accepted only while `branches.status = 'draft'`.** Submitting a merge request moves the branch to `proposed`; `changes_requested` moves it back to `draft`. | Avoids "the reviewer approved a head that has since moved". |
| S-19 | **`users` is Supabase `auth.users`.** No local users table; `members.user_id` references `auth.users(id)`. | Working assumption in ADR-000. If wrong, only `members` and the RLS helpers change. |
| S-20 | **Every table carries `org_id`**, including projections and deltas, even where derivable through joins. | RLS policies stay one predicate, and never need a join to decide. |
| S-21 | Table renames relative to the ADR: `organisation_members` → `members`; `element_aliases` → `aliases`; `merges` → `element_merges`; `capability_map_templates` → `capability_maps`; `capability_map_template_items` → `capability_map_items`. | The brief's requested names; the ADR's were descriptive placeholders. |
| S-22 | **Partial delivery is a split branch, never a partial merge commit** (ADR-006 amendment, Sprint C1). Accepting a subset of a branch's elements/relationships in the review queue creates a new `change` branch with `split_from` = the original branch's id, carrying only the accepted (dependency-closed) subset, merged whole in the same action; the remainder stays on the original branch. `branches.split_from` (nullable, → `branches.id`) records this. An original branch and its splits are one logical change for the change page and roadmap (§3.4). | ADR-002's merge commit is all-or-nothing (second parent = the whole branch head); a split branch keeps that guarantee instead of weakening it to support partial acceptance. |

---

## 2. Conventions

- Schema `public` for tables, schema `atlas` for helper functions and procedures.
- Every table: `id uuid primary key`, `org_id uuid not null references organisations(id)`, `created_at timestamptz not null default now()`. These three are not repeated in the column lists below unless the type differs. This includes tables whose primary key is composite (`members`, `elements_head`, `relationships_head`, `facts`) — there `id` is dropped (the composite key replaces it) but `org_id` still applies, per S-20; §9's literal RLS SQL for `commits` reads `commits.org_id` directly, confirming the same holds for every history and projection table, not only the ones where a column list happens to repeat it. `organisations` (is the org) and `user_preferences` (explicitly user-scoped, §3.2) are the only tables without `org_id`. **`created_at` has its own named exceptions (Sprint H1 amendment, closing docs/AUDIT-2026-09-U2.md §2.E.3 item 2):** `branches` tracks `updated_at` instead — it's a mutable pointer (ADR-002), and "when did this pointer last move" is the more useful timestamp than "when was the row first inserted"; `members` tracks `joined_at` instead, the same value under a name that says what it actually means; `elements_head`, `relationships_head`, and `facts` have no timestamp column at all — a row in these commit-scoped projection tables is a disposable, GC'able re-derivation of `deltas` (§3.5), not an entity with a history of its own, so there is nothing for a `created_at` to record.
- Per S-1, `id` on every table populated by client-composed envelopes (`models`, `branches`, `commits`, `deltas`, `tags`, `sources`, `aliases`, and every table in §3.7–3.10) is minted by the writer, not defaulted by the database. The exception is infrastructure rows the database creates as a side effect rather than a client ever composing them — the `main` branch row created by `atlas.on_model_created` — which may use `gen_random_uuid()`.
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
| `commit_kind` | `genesis`, `manual`, `capture`, `merge`, `template_seed` |
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
| `comment_status` | `open`, `resolved` |
| `anchor_type` | `element`, `relationship`, `change`, `decision`, `version` (Sprint M1a amendment — see §3.8; `comment_visibility`, `delta`, and `branch` from the original draft are gone: visibility is dropped for now, `branch` is renamed `change`, and `delta` has no replacement yet, so an attribute-level "comment on this value" anchor isn't reachable until it does) |
| `notification_kind` | `mention` (Sprint M1a; the only kind today — extensible by name, not by schema, once a second one is needed) |
| `view_kind` | `landscape`, `context`, `container`, `component`, `capability_map` |
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
Trigger `atlas.on_organisation_created` inserts the creator as `owner`. `atlas.guard_last_owner`, an ordinary `before` row trigger — not a SQL `create constraint trigger` (Sprint H1 correction, docs/AUDIT-2026-09-U2.md §2.E.3 item 18: this deferrable-checking distinction isn't needed here — "no owners left" should reject the statement immediately, not at end of transaction) — stops an org losing its last `owner`.

#### `atlas.profiles` (Sprint M1a, ADR-009 amendment)
A user's public identity, decoupled from `auth.users.email`. Lives in the `atlas` schema, not `public` — infrastructure identity, not model content, same distinction that already separates every `atlas.*` RPC from the tables it writes; client reads/writes go through `.schema('atlas')`. No `org_id` (like `organisations`/`user_preferences`, this is not org-scoped — a person's profile follows them across every org they belong to).

| Column | Type | Constraints |
|---|---|---|
| `user_id` | uuid | pk, → `auth.users(id)` on delete cascade |
| `display_name` | text | nullable |
| `handle` | text | not null, unique, lowercase (`check (handle ~ '^[a-z0-9_-]+$')`) |
| `avatar_url` | text | nullable |
| `updated_at` | timestamptz | not null default now() |

Created by trigger `atlas.ensure_profile` (`after insert on members`) the first time a user joins any organisation — a no-op on every org after their first, since a profile is one per person, not one per membership. The default `handle` is the email's local part, lowercased and sanitised to the column's own charset, with a `-2`/`-3`/... suffix appended on collision so two people who both happen to be `alex@` never silently overwrite one handle. **Email is never exposed to other members** — there is no email column here, and nothing else in this schema exposes one either. Editable by the user only; readable by any fellow org member (any shared org, any role). Commit and comment author display always reads through this table (`src/db/profiles.ts`), never a raw join against `auth.users`, which RLS never exposes to a client at all.

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

#### `user_preferences`
Per-person UI preferences. Keyed on the user, not the membership: preferences follow the person across organisations (UI-principles §3, §10). Ships in the first UI migration.

| Column | Type | Constraints |
|---|---|---|
| `user_id` | uuid | pk → `auth.users(id)` on delete cascade |
| `home_mode` | text | not null default `'director'`, `check (home_mode in ('director','architect'))` |
| `density` | text | not null default `'comfortable'`, `check (density in ('comfortable','compact'))` |
| `theme` | text | not null default `'system'`, `check (theme in ('system','light','dark'))` |
| `capability_map_colour_by` | text | nullable, no default, `check (capability_map_colour_by in ('none','metric:supportingSystemCount','metric:oldestLifecycleStage','metric:lifecycleExposure'))` — Sprint U4-1 C4 |
| `updated_at` | timestamptz | not null default now() |

No `org_id` (exception to S-20: the row is not org-bearing). RLS: `user_id = auth.uid()` for select, insert, update; no delete policy (a row is reset, not removed). Defaults in the UI when no row exists: architect door for `owner`/`architect` members, director door otherwise; the row is created on first change, not on sign-up. `capability_map_colour_by` is the one column here without a fixed default — unlike its three siblings, null (no override ever saved) resolves in the UI, not the schema: exposure for director home mode, coverage for architect, "none" while the model has no systems at all (`src/ui/capabilityMap/metrics.ts`'s `resolveDefaultColourBy`) — a saved value always wins over that computed default ("remember last choice per user").

### 3.3 Schema registry

**Deferred to Sprint K1 (ADR-015).** `type_schemas` as specified below needs a full TypeScript-type-to-JSON-Schema generator plus a checked-in seed and validator (RT-5) — real schema-validation infrastructure that Sprint U1's element page (which only needed attribute order and labels) never required. Attribute order and per-type attribute definitions live in `src/contracts` as code until then; validation of attribute values happens in the TypeScript contracts at the commit boundary, with tests, not against this table. The shape below is unchanged and still the target once K1 builds it.

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

**Superseded by a constant, not a migrated table (Sprint H1).** Unlike `type_schemas` above, this table's content was fully known from ADR-001 from the start and simply had no runtime enforcement anywhere in the codebase — not a table, not an engine check, not an application-level validation (flagged in docs/AUDIT-2026-09-U2.md §6.2/§6.3). Sprint H1 closes that gap with `RELATIONSHIP_TYPE_RULES`, a constant in `src/contracts/relationshipTypeRules.ts`: the seed rows below are that constant's content, kept here as the documented reference, not read from a live table at runtime. C9 and V3 are both checked against the constant — in `src/engine/deltas.ts`'s `apply()` (so every caller of `fold`, including `commitToBranch`, inherits the check), and therefore at the commit boundary in `src/db/commits.ts`. **Superseded, not deferred (§11 lists this alongside this document's genuinely-deferred items, marked "never"):** migrating this to a real table isn't scheduled anywhere and isn't expected to be — it would only be worth doing if the ruleset needed to become live-editable product content without a code change (e.g. an admin screen), and nothing today requires that.

**Correction (Sprint U4-1 B4, found while adding `max_primary_per_from` below; superseded by the C17 note directly below it).** The paragraph above overstates what `apply()` checked at the time: only C9 (the `(type, from.type, to.type)` triple itself) was enforced there — `isRelationshipTripleAllowed`, `src/engine/deltas.ts`. Neither `max_per_from` nor `max_primary_per_to` (V3's cardinality half) was checked anywhere, engine or database; `owns.primary`'s own "at most one primary owner" had no runtime enforcement. `max_primary_per_from` was the one exception, and only for `supports`: enforced by a database constraint (a partial unique index, `relationships_head_one_primary_supports_per_system`), not by `apply()`.

**C17 (Sprint U4-1, addressed the gap above the same sprint it was found).** `apply()` now enforces both primary-cardinality rules inline, alongside C8/C9, on every fold — `checkPrimaryCardinality`, `src/engine/deltas.ts`: a `relationship.create`/`relationship.update`/`relationship.restore` that would set (or, for restore, revive) `supports.role = 'primary'` (anchored on `fromElementId`, one system) or `owns.primary = true` (anchored on `toElementId`, one owned target) is rejected if the resulting head would already hold another live edge with that same primary flag on the same anchor — unless the same commit demotes the existing one first (an earlier delta in `seq` order); a restore is checked against the head as it stands now, not as it stood when the relationship was retracted, so reviving a stale primary can't silently create a second one alongside whatever was promoted while it was gone. Because `fold`/`apply` are the same functions `commitToBranch` calls for every branch kind, this is checked at commit time on a `change` branch's own commits, not only once they reach `main` — closing the branch-time gap the partial-unique-index approach alone left open (§6.3, C10/C11 discussion). `rebuildHead` (`src/db/rebuildHead.ts`) re-folding a model's full history from genesis means a pre-existing violation (written before this check existed) surfaces there too, as a thrown error, with no separate detection code. `max_per_from` (a non-primary per-type count cap) is not used by any seed row today and remains unenforced — a real gap, but a different one, and not this item's to close. Both `supports.role` and `owns.primary` also have a database partial-unique-index as backstop (`relationships_head_one_primary_supports_per_system`, `relationships_head_one_primary_owns_per_target`) — `relationships_head` is materialised for `main`/tags only, so each index only ever backstops main; `apply()`'s C17 is what actually covers a change branch.

Which `(relationship_type, from_type, to_type)` triples are legal, and cardinality (ADR-001).

| Column | Type | Constraints |
|---|---|---|
| `relationship_type` | relationship_type | not null |
| `from_type` | element_type | not null |
| `to_type` | element_type | not null |
| `max_per_from` | int | nullable — max live relationships of this type from one element |
| `max_primary_per_to` | int | nullable — used by `owns` (1) |
| `max_primary_per_from` | int | nullable — used by `supports` (1, Sprint U4-1 B4: `supports.role`, the landscape lane a system's tile is placed in) |

Primary key `(relationship_type, from_type, to_type)`. No `org_id`; product content. Seed rows:

| relationship_type | from | to | max_per_from | max_primary_per_to | max_primary_per_from |
|---|---|---|---|---|---|
| supports | system | capability | | | 1 |
| uses | system | system | | | |
| uses | container | container | | | |
| uses | component | component | | | |
| uses | container | system | | | |
| uses | component | container | | | |
| owns | actor | capability | | 1 | |
| owns | actor | system | | 1 | |
| flows_to | system | system | | | |
| flows_to | container | container | | | |

### 3.4 History

#### `branches`
A named mutable pointer to a commit (ADR-002).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` on delete cascade |
| `name` | text | not null; `unique (model_id, name)` |
| `kind` | branch_kind | not null |
| `status` | branch_status | not null default `draft` |
| `base_commit_id` | uuid | → `commits(id)`, not null (ADR-018: for `main`, its own genesis commit, set the instant the model is created); for a `change` branch, kept equal to `mergeBase(B)` — set at fork, moved to `main`'s head on every successful refresh (§1 S-11, ADR-005 amendment) |
| `head_commit_id` | uuid | → `commits(id)`, not null (ADR-018: never unset — a freshly created `main` starts pointed at its own genesis commit, the same row as `base_commit_id`) |
| `shared_for_review` | boolean | not null default false — makes the head visible to viewers (ADR-009) |
| `title` | text | change branches: the solution design title |
| `description` | text | nullable; change branches: free-text description of the change, set at creation |
| `target_date` | date | nullable; change branches: the intended delivery date shown on the change page and roadmap |
| `split_from` | uuid | → `branches(id)`, nullable; set only on a branch created by partial acceptance in the review queue (§1 S-22, ADR-006 amendment) — the branch it was split out of |
| `created_by` | uuid | → `auth.users(id)` |
| `updated_at` | timestamptz | not null |

Partial unique index `(model_id) where kind = 'main'`. Index `(model_id, status)`. Index `(split_from) where split_from is not null`. Check: `kind = 'main'` ⇒ `status = 'draft'` (main is always open). Check: `kind = 'capture_draft'` ⇒ `status in ('draft','archived')`. Check: `split_from is not null` ⇒ `kind = 'change'`. (ADR-018 removed the old kind-conditional `base_commit_id`/`head_commit_id` nullability checks — both columns are simply `not null` now, for every branch kind, so there is nothing left to check per-kind.)

#### `commits`
An ordered batch of deltas on a branch. Ancestry is a DAG: two parents on a merge (ADR-002).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `branch_id` | uuid | → `branches(id)`, `deferrable initially deferred` (ADR-018: `atlas.on_model_created` inserts a model's genesis commit and its main branch in one transaction, each naming the other's id, so this FK can't be checked row-by-row) |
| `parent_commit_id` | uuid | → `commits(id)`, null only for `kind = 'genesis'` — the one commit per model ever allowed a null parent, inserted only by `atlas.on_model_created` (ADR-018), never by a client RPC |
| `merged_branch_head_commit_id` | uuid | → `commits(id)`, nullable; `check ((kind = 'merge') = (merged_branch_head_commit_id is not null))` |
| `kind` | commit_kind | not null |
| `title` | text | not null — generated, not caller-typed, for `manual` commits (§5.1: `describeEnvelope`); renamed from `message` in Sprint U4-1 B1 |
| `body` | text | nullable — optional caller elaboration alongside `title`, added Sprint U4-1 B1 |
| `author_id` | uuid | not null — `auth.users.id` or service identity |
| `head_hash` | bytea | nullable; set only for a commit on `main` (§3.5, S-15) — `atlas.commit_deltas` writes it iff the branch kind is `main`, never "once materialisation eventually happens" for any other branch kind; 32 bytes (§6.4) |
| `depth` | int | not null — 1 + parent depth; genesis = 0. Used to bound replay and order topological sorts. |

Indexes: `(branch_id, depth desc)`, `(parent_commit_id)`, `(merged_branch_head_commit_id)` (partial, `where merged_branch_head_commit_id is not null` — Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 10), `(model_id, kind)`. Unique `(branch_id, parent_commit_id)` where `parent_commit_id is not null` — enforces linear history within a branch (C13). Append-only.

#### `deltas`
One fact assertion (ADR-002, ADR-007). The only source of truth for model content.

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `commit_id` | uuid | → `commits(id)` |
| `seq` | int | not null; `unique (commit_id, seq)` |
| `kind` | delta_kind | not null |
| `subject_type` | subject_type | generated from `kind` (Sprint H1 note — docs/AUDIT-2026-09-U2.md §2.E.3 item 8: the migrated generated column has no explicit `not null`; its `case` expression has an `else` branch and so is total over every `delta_kind` value, making it non-null in practice without the constraint needing to say so) |
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

Indexes: `(model_id, subject_id, attribute)`, `(previous_delta_id)` (partial, `where previous_delta_id is not null`), `(source_id)`, `(model_id, from_element_id)` (partial, `where from_element_id is not null`), `(model_id, to_element_id)` (partial, `where to_element_id is not null`) — Sprint H1 note (docs/AUDIT-2026-09-U2.md §2.E.3 items 9-10): `(commit_id, seq)` isn't a separate index, it's the `unique (commit_id, seq)` table constraint already named above (Postgres backs it with a unique index automatically, but it's one thing, not two); the three FK-shaped indexes above are `partial` on the migrated table, which is a strict improvement over an unqualified index for a nullable column, not a difference worth treating as a gap. Unique `(commit_id, subject_id, attribute)` (C4). Append-only. Per-kind check constraints encode the nullability rules above.

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

**Retention rule, main-only (Sprint H1 rewrite, superseding S-2 as originally written — docs/AUDIT-2026-09-U2.md §2.E.3 item 17; ADR-015).** Rows exist for a `commit_id` iff that commit is `main`'s current `head_commit_id`, or some tag's `commit_id` (tags only ever point at a commit on `main`, S-21). A `change` branch's head is **never** materialised into these tables, at any point in its life — not "not yet," structurally never: `atlas.commit_deltas` (§5.3) only calls the projection writer `atlas.replace_main_head_projection` when the committing branch's `kind = 'main'`. Reading a `change` branch's current state means folding it (§6) — via `foldFromGenesis`, which any UI page showing a change branch already has to call — not querying these tables. Every time `main` advances, `atlas.replace_main_head_projection` deletes the *previous* main head's rows unless a tag still cites them (`gcOldHeads`, below), then inserts fresh rows for the new head; it never leaves more than one untagged main-head generation lying around. Projections are rebuildable from `deltas` at any time (§6) — this is what makes deleting old, untagged generations safe rather than a loss.

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

Primary key `(commit_id, element_id)`. Indexes: `(commit_id, element_type)`, `(commit_id, parent_id)` (partial, `where parent_id is not null` — Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 10), `(model_id, element_id)`, GIN `(attributes)`, GIN trigram on `lower(name)` (pg_trgm) for matching (§8).

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
| `org_id` | uuid | → `organisations(id)` — **added Sprint H1** (docs/AUDIT-2026-09-U2.md §2.E.3 item 1: this table was migrated without it, despite S-20 explicitly naming `facts` in its own carve-out list; backfilled from `commits.org_id`) |
| `model_id` | uuid | → `models(id)` — **added Sprint H1**, same backfill, from `commits.model_id` |
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

Primary key `(commit_id, subject_id, attribute)`. Indexes `(commit_id, source_id)` ("what depends on this spreadsheet") and `(model_id, subject_id)` (added Sprint H1, alongside `org_id`/`model_id` above). One row per live attribute including `$exists`; a create delta yields one `$exists` row plus one row per initial attribute, all pointing at the create delta. Attributes of retracted subjects are removed from `facts` (they come back on restore from the delta chain).

`org_id`/`model_id` are supplied by `atlas.replace_main_head_projection` from its own `p_org_id`/`p_model_id` parameters, exactly like `elements_head`/`relationships_head`'s own copies of those columns — constant for the whole call, never read per-row from `p_facts`, and so never something `src/engine/projection.ts`'s `serializeHeadProjection` or `FactRow` needed to carry either.

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
| `capture_job_id` | uuid | → `capture_jobs(id)` **once that table exists (Sprint K1) — not migrated yet, so today this is a plain `uuid` column with only the CHECK half below** (Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 11; same "add the FK in its own migration once the target exists" pattern `deltas.source_id`'s FK already used, `20260906071500_sources_and_aliases.sql`'s own comment), nullable; not null iff `kind = 'capture_job'` |
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
Threaded comments anchored to a model object (ADR-010 amendment, S-16, Sprint M1a — `supabase/migrations/20260906240000_comments.sql`'s own module comment has the full column-by-column diff from the original draft below).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `anchor_type` | anchor_type | not null — `element`, `relationship`, `change`, `decision`, `version` |
| `anchor_id` | uuid | not null — a stable subject id (element/relationship/branch/tag id), **never a commit id**, so merge and refresh cost this table nothing (RT-8) |
| `branch_id` | uuid | → `branches(id)`, nullable — which branch this comment was raised *from*, for an anchor (typically an element/relationship) not yet on main; stays pinned to that branch forever, even after merge, so it is display metadata (e.g. the change page's own comment feed), not part of viewer-visibility (that's the anchor's own job, via `atlas.anchor_visible_to_viewer`) |
| `view_kind` | view_kind | nullable — which kind of view a comment was raised from, if any (no per-view pin coordinate this iteration) |
| `parent_comment_id` | uuid | → `comments(id)`, nullable; replies are flat (no reply-to-a-reply) and must share the root's exact anchor — both checked by trigger `atlas.check_anchor` |
| `body` | text | not null, non-empty |
| `author_id` | uuid | not null |
| `status` | comment_status | not null default `open`; only a thread's root ever carries resolution state |
| `resolved_by` | uuid | nullable |
| `resolved_at` | timestamptz | nullable |
| `edited_at` | timestamptz | nullable |

Indexes `(model_id, anchor_type, anchor_id)`, `(parent_comment_id)`, `(org_id)`, `(branch_id)` where not null. Anchor existence is checked by trigger `atlas.check_anchor` (polymorphic; Postgres cannot FK it) against permanent history (`deltas`' own `element_create`/`relationship_create` rows), not the current head — an element retracted after its comment was posted stays a valid anchor forever (rule 5), and the comment stays readable, flagged by `src/db/comments.ts`'s `listCommentsForAnchor` as anchored to a retracted subject when the anchor is absent from main's current `elements_head`/`relationships_head`. `visibility` (`team`/`internal`) and the `view_id`/`hint_x`/`hint_y` visual-pin columns from the original draft are dropped for this iteration — no product need for an internal-only comment has shown up yet, and a pin coordinate never shipped a renderer. `replica identity full`, so a realtime `UPDATE` payload always carries the complete previous row.

#### `comment_mentions` (Sprint M1a)
Who an `@handle` in a comment's body resolved to.

| Column | Type | Constraints |
|---|---|---|
| `comment_id` | uuid | → `comments(id)` on delete cascade |
| `user_id` | uuid | not null |

Primary key `(comment_id, user_id)`. Written only by trigger `atlas.process_comment_mentions` (`after insert on comments`), which parses `@handle` tokens out of the new comment's body against `atlas.profiles.handle`, restricted to the comment's own org, dropping any mention of the comment's own author (no self-notification). `src/contracts/comments.ts`'s `parseMentionHandles` is the same pattern client-side, kept in sync by a round-trip test — a read-only preview of what the server will do, not a second enforcement point.

#### `notifications` (Sprint M1a)
One in-app notification per mentioned member per comment. No email delivery — SPEC §11 defers a notification tray UI to U4; this sprint ships the record and an unread count only (`src/db/notifications.ts`).

| Column | Type | Constraints |
|---|---|---|
| `user_id` | uuid | not null — the recipient |
| `kind` | notification_kind | not null — `mention`, today the only value |
| `comment_id` | uuid | → `comments(id)` on delete cascade, nullable |
| `read_at` | timestamptz | nullable |

Index `(user_id, read_at)`. Written only by `atlas.process_comment_mentions`, alongside its `comment_mentions` row, in the same transaction as the comment itself — a mention and its notification always exist together or not at all. A person's own notifications are private: nobody else, not even an owner, reads another member's `notifications` rows.

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
| `scope_element_id` | uuid | nullable; required for `context`/`container`/`component`, must be null for `landscape`/`capability_map` |
| `branch_id` | uuid | → `branches(id)`, nullable = main |
| `created_by` | uuid | → `auth.users(id)`, not null (Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 12: the `→` was missing here — the migrated column is a real FK) |

`capability_map` is a view kind like the other four: it renders the model's
own `capability`-typed elements (containment via `parent_id`, `supports`
edges into them from systems) at the chosen branch's head, the same as any
other view — it is not the `capability_maps`/`capability_map_items` content
in §3.10. Those are versioned, product-owned starter content (ADR-012) used
to *seed* a model's capability elements via a `template_seed` commit; once
seeded, they are ordinary elements and are rendered, like everything else,
through a `views` row. Building the `capability_map` view kind's renderer is
Sprint U2, not U1.

#### `view_layouts`
Per-view position hints. Deleting all rows for a view is lossless.

| Column | Type | Constraints |
|---|---|---|
| `view_id` | uuid | → `views(id)` on delete cascade |
| `subject_type` | subject_type | not null |
| `subject_id` | uuid | not null |
| `x`, `y` | double precision | nullable (elements) |
| `bends` | jsonb | nullable (relationships: array of `{x,y}`) |
| `updated_by` | uuid | → `auth.users(id)`, not null (same Sprint H1 note as `views.created_by` above) |
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
| `created_by` | uuid | → `auth.users(id)`, not null (same Sprint H1 note as `views.created_by` above) |

### 3.10 Starter content

Starter map source data (the sector maps' items and citations, before
they're seeded into any model) lives under `content/` in the repository —
versioned, reviewed text, not inline in application code (CLAUDE.md rule 7)
— and is loaded into the `capability_maps`/`capability_map_items`/
`capability_map_sources` tables below by Sprint U2's seeding job. Nothing in
Sprint U1 reads or writes these tables.

#### `capability_maps`
A versioned sector starter map (ADR-012).

| Column | Type | Constraints |
|---|---|---|
| `sector` | text | not null. No database CHECK (dropped, `20260906180000_capability_maps_sector_taxonomy_in_code.sql`): the allowed values are `src/contracts/capabilityMapContent.ts`'s `SECTORS` — `local_government_scotland`, `local_government_england`, `nhs`, `housing`, `hei`, `public_body`, `utility`, `electricity_network` — taxonomy in code per ADR-001, validated by `parseCapabilityMapContent`, which is the only path to this column (the loader is its sole writer). The deprecated `local_government` parses as `local_government_scotland`. |
| `version` | int | not null; `unique (sector, version)` |
| `status` | map_status | not null default `draft` |
| `source_description` | text | not null |
| `published_at` | timestamptz | nullable; not null iff `status <> 'draft'` — set once, on first publish, and kept through a later `deprecated` transition (`20260906200000_capability_maps_deprecated_keeps_published_at.sql`): when a map was actually published is real provenance a supersession shouldn't erase. |

No `org_id`; product content. Readable by all authenticated users; directly writable only by service role (`scripts/loadCapabilityMaps.ts`) — Sprint U4-1 C6 adds one gated, indirect write path for an authenticated session: `atlas.export_capability_map_as_draft` (below), always producing `status = 'draft'`.

#### `capability_map_items`

| Column | Type | Constraints |
|---|---|---|
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `code` | text | not null; `unique (map_id, code)` |
| `parent_code` | text | nullable → `(map_id, code)` |
| `name` | text | not null |
| `description` | text | |
| `level` | int | not null, `check (level between 1 and 3)` |
| `item_order` | int | not null (Sprint U4-1 C1, `20260906300000_capability_map_item_order.sql`) — display order among siblings (same `parent_code`); independent of `code`, which stays a stable reference id. Named `item_order`, not `order` (a reserved SQL keyword). |

Trigger: `level = 1` ⇔ `parent_code is null`; parent's level = level − 1.

#### `capability_map_sources`

| Column | Type | Constraints |
|---|---|---|
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `citation` | text | not null |
| `url` | text | |
| `reviewed_by` | text | not null — a name, not a user id; reviewers are often external |
| `reviewed_at` | date | not null |

Seeding a model from a map (ADR-012) creates one `sources` row of kind `template` and one `template_seed` commit whose `element_create` deltas have `attributes.code`/`attributes.templateRef` set (plus `attributes.description`, copied from the map item's own description when it has one — Bug A2: this was silently dropped until Sprint U4-1, and `scripts/syncDescriptionsFromMap.ts`/its owner-action equivalent is the one-off fix for a model already seeded before then) and an `aliases` row of type `template_code` per element.

**Sprint U4-1 C6: export the other direction, and seeding a draft.** A
model's own tailored capability tree can become new starter content two
ways, both built on the same read/transform (`src/db/exportCapabilityMap.ts`'s
`buildCapabilityMapExport`: fresh, sequential codes from the tree's
resolved structure and display order, never a capability's own
`attributes.code`/`order` — that's this model's own seed provenance, not
something a new starter map should inherit) —

- `pnpm content:export-capability-map <org> <model> <sector> <version>`
  (`scripts/exportCapabilityMap.ts`) writes a real
  `content/capability-maps/<sector>/<version>.json` file (service role;
  read-only against model data) and regenerates
  `docs/review/capability-maps.md`, joining the ordinary hand-authored
  workflow from there (`content/capability-maps/README.md`).
- `atlas.export_capability_map_as_draft(p_model_id, p_sector, p_version,
  p_source_description, p_items, p_sources)` — security definer, granted
  to `authenticated`, gated owner/architect (ADR-015, same check
  `atlas.seed_from_map` uses) — is the same export for a browser session,
  which has no filesystem to write a content file to: it upserts
  `capability_maps`/`capability_map_items`/`capability_map_sources`
  directly, always as `status = 'draft'` regardless of what's passed, and
  refuses outright if `(sector, version)` already exists as anything but
  `draft` (a published or deprecated map is fixed history;
  `capability_map_items_guard_immutable` would reject the item writes
  regardless, but this function gives a clearer reason first).

`atlas.seed_from_map` itself now accepts a `draft` map, not just
`published` (`20260906320000_seed_from_draft_map.sql`, superseding
`20260906120000_seed_from_map.sql`'s original `<> 'published'` check) —
"draft maps are seedable into a model for review": an owner/architect can
seed their own (or a colleague's) fresh export into a real model to see
how it reads before deciding whether to publish it. `deprecated` is still
refused either way. The picker itself
(`src/db/capabilityMapTemplates.ts`'s `listSeedableCapabilityMaps`,
superseding `listPublishedCapabilityMaps`) lists both statuses, flagged
"Draft" in the UI — never indistinguishable from a reviewed, published
map.

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

`CommitEnvelope` in `delta.ts`: `id`, `branchId`, `parentCommitId`, `mergedBranchHeadCommitId`, `kind`, `title`, `body`, `deltas[]`.

**`message` was renamed to `title` in Sprint U4-1 (item B1), and `body` was added.** `title` is no longer a caller-typed string: for a `manual` commit it is generated from the commit's own deltas by `src/engine/describeEnvelope.ts`'s `describeEnvelope(deltas, nameLookup)` (e.g. "Add system PowerON", "Link PowerON supports Outage & Fault Management", "Set PowerON owner to Network Control") — `merge`/`template_seed`/`genesis` commits keep their own established, domain-specific phrasing instead ("Refresh from main, resolving N conflict(s)", "Seed from {sector} v{version}", "Genesis"). `body` is optional (nullable) free text a caller can supply alongside the generated title; nothing writes a real one yet — every current caller just carries forward what used to be its whole hand-typed `message` as `body`, verbatim — but the column exists so a future free-text note has somewhere to go without another migration. A one-off script (`scripts/backfillCommitTitles.ts`) regenerated `title` for every commit that existed before this sprint.

**`authorId` was removed from the wire contract in Sprint H1** (docs/AUDIT-2026-09-U2.md §2.E.3 item 15). It was never actually the source of `commits.author_id`/`deltas.created_by` — `atlas.commit_deltas` has always derived both from `auth.uid()`, ignoring whatever the envelope claimed — but it *was* still the untrusted source of `facts.asserted_by`/`facts.asserted_at` (§3.5), a real gap: a client could assert a fact under any identity it liked. `atlas.replace_main_head_projection` now derives both of those the same way everything else already did, joining each fact's `delta_id` back to `deltas.created_by`/`deltas.created_at` rather than trusting the payload. Nothing about who authored a commit is client-supplied anywhere in this product any more; `auth.uid()` is the only source, full stop.

Kinds:

- `genesis` — the one commit every model's main branch is born with (ADR-018), zero deltas, `depth = 0`, the only kind ever allowed a null `parentCommitId`. Inserted only by `atlas.on_model_created`, in the same transaction as the model itself — never by a client RPC, never by `atlas.commit_deltas` or `atlas.seed_from_map` (both require a real parent, unconditionally).
- `manual` — a person's edit on a change branch, or (owner/architect only, ADR-015) directly on main — including the model's first hand-added capability, which is an ordinary `manual` commit parented on the genesis commit like any other.
- `capture` — output of a capture job, on a `capture_draft` branch. Exactly one per capture branch.
- `template_seed` — a model seeded from a capability map, on main, parented on the genesis commit — the model's first *content-bearing* commit, but not its first commit (that's genesis). A model is seeded at most once: allowed only while main's head is still the genesis commit itself.
- `merge` — second parent set. On a change branch: a refresh (pull main in). On main: the merge of an approved change branch (created only by `atlas.merge_branch`).

### 5.2 Invariants

`COMMIT_INVARIANTS` in `delta.ts` is the list (C1–C17). They are checked in this order, and the first failure rejects the whole commit:

1. Shape: C1, C2, C3, C14.
2. Intra-commit: C4.
3. Against history: C5 (id never used), C13 (parent is current head), C12 (source in model).
4. Against parent head: C6 (previousDeltaId matches `facts`), C7 (exists/not-exists preconditions).
5. Against resulting head: C8, C9, C10, C11, C15, C17 (Sprint U4-1: at most one primary `supports`/`owns` edge per anchor element).
6. Validation level for the branch kind: C16 → §6.3.

C6 is the one that turns concurrent editing into a rejected commit rather than a lost update. Two people editing the same attribute of the same element on the same branch: the second submit fails C6 and must re-read.

### 5.3 Who writes commits

| Branch kind | Writer | Path |
|---|---|---|
| `capture_draft` | capture worker (service role) | direct insert, then `branches.head_commit_id` update |
| `change` | contributor+ via API | `atlas.commit_deltas` (security definer) — see implementation note below |
| `main` | owner/architect via API, permanently (ADR-015) | `atlas.commit_deltas`, same function, materialises the head too |

**Implementation note (Sprint U1 step 3a, superseding Sprint F1 step 6's version of this note):** `atlas.commit_deltas` (`supabase/migrations/20260906090000_facts_and_commit_deltas.sql`) is now the one function that writes a commit, of either branch kind, replacing the two-round-trip insert-then-compare-and-swap this section previously described. In one transaction: insert the commit and its deltas, advance `branches.head_commit_id` (still checked by `atlas.guard_branch_head_advance`, unchanged since Sprint F1 step 6 — the actual concurrency guarantee, which a lost race's unique `(branch_id, parent_commit_id)` index violation (§3.4) or the trigger's own check catches before anything is left half-written), and — only when the branch is `main` — materialise `elements_head`/`relationships_head`/`facts` for the new head via `atlas.replace_main_head_projection`, a second, narrower security-definer function with no grant to `authenticated` at all. `src/db/commits.ts` computes the resulting `Head` with the existing engine (as it already did for validation) and serialises it (`src/engine/projection.ts`) into the jsonb this writes verbatim — the fold/apply algorithm itself is not reimplemented in SQL; delta-apply directly against the existing projection rows, rather than shipping the whole materialised set on every commit, is the named upgrade path if the payload this sends ever needs it (ADR-015; §11 now gives it a firmer target than "if ever needed" — before Sprint K1's capture pipeline arrives). See ADR-015 for why this needed to be security definer (it advances `main`, which the plain `commits`/`branches` RLS was never written to allow), why owner/architect-only on `main` is a permanent rule and not a sprint-scoped one, and why the engine, not a second PL/pgSQL implementation, stays the one place fold/apply is defined.

The two-round-trip design's orphaned-commit tradeoff (a lost race leaving a permanent, harmless, unreferenced commit row) no longer applies: a lost race now fails the whole function call, and nothing is written at all, because a PL/pgSQL function body is one transaction.

**`p_kind` restriction (Sprint H1 item 3 — `supabase/migrations/20260906140000_commit_deltas_kind_restriction.sql`):** `atlas.commit_deltas` originally placed no restriction on `p_kind` at all — the `kind in ('manual', 'merge')` check on `commits_insert` (§9.3) only ever applied to a direct table insert, which this security-definer function bypasses. It now rejects `p_kind` values that don't fit the branch: `main` accepts `manual`/`merge`/`template_seed`; `change` accepts `manual` only. `merge` on `change` (a "refresh," S-11) is real design with no product path yet (no branch/review-queue UI); allowing it here ahead of anything that would produce one is deferred along with the rest of that UI, not silently permitted meanwhile.

**`base_commit_id` moves on refresh (Sprint C1-H item 2 — `supabase/migrations/20260906170000_merge_refresh_base_commit_id.sql`):** a refresh (`p_kind = 'merge'` on a `change` branch) always carries `p_merged_branch_head_commit_id` — main's own head at the moment of the refresh (§5.1's kinds list). Before this migration, `atlas.commit_deltas` only ever moved `branches.head_commit_id`; `base_commit_id` stayed pinned to the branch's original fork point for its whole life. `src/db/branchProjection.ts`'s As-is projection folds from `branch.base_commit_id` (UI-principles §6.2), so a branch that had refreshed once kept showing the *pre-refresh* main state as "As-is" — silently wrong the moment main moved again after that refresh, since nothing re-derives `base_commit_id` from the commit DAG on read. The fix: the same `update branches` that advances `head_commit_id` now also sets `base_commit_id = p_merged_branch_head_commit_id`, but only when `v_branch_kind = 'change' and p_kind = 'merge'` — every other case (a manual commit, anything on `main`) leaves `base_commit_id` exactly as it was.

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
| V3 | schema | every relationship's `(type, from.type, to.type)` is in `relationship_type_rules`; `max_per_from`, `max_primary_per_to`, and `max_primary_per_from` respected — as of Sprint U4-1, the triple-legality half (C9) and both primary-cardinality rules (`max_primary_per_to` for `owns`, `max_primary_per_from` for `supports`) are enforced in `apply()` as C17, on every fold, with a database partial-unique-index as backstop for each; `max_per_from` (a non-primary per-type count cap, unused by any seed row today) has no enforcement anywhere — see `relationship_type_rules`'s own correction note in §3.3 |
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

### 6.7 Reading a materialised head at scale

`elements_head`/`relationships_head`/`facts` are keyed `(commit_id, ...)` (§3.5) — every read of them is already scoped to one commit. A read that also needs "only these particular subjects" (an element's own relationships, a landscape's edges among its systems) must not add that second scoping by handing an arbitrary, caller-sized id list to postgrest-js's `.in()`: `.in()` is sent as a GET query parameter, so its URL grows with the list — Sprint C1-H item 1 found this concretely (`docs/AUDIT-2026-09-C1.md` §1.4): a 2,000-system landscape's edge query, `.in('from_element_id', systemIds).in('to_element_id', systemIds)`, produced a ~70KB+ URL that a proxy/server rejects outright (400/`ERR_FAILED`), not a slow query — the read never completed at all.

**Rule:** a `.in()` filter whose value list is caller-supplied and can grow with model size (element/subject/source/branch/commit ids — anything that isn't a small fixed enum like a status or type list) must stay at or under 50 values. `src/db/inFilterLimit.ts`'s `assertInFilterSize` enforces this at the point of call — a call site over the limit is a bug to fix, not a query to let run and hope stays small in practice. The fix is the same shape every time (`src/db/landscape.ts`'s `listLandscapeEdges`/`listSupportsEdgesForSystems`, rewritten this item): query the commit/model scope alone — no id-list filter at all — and narrow to the wanted subjects client-side, in memory, after the round trip. This trades a WHERE clause for a client-side `Set.has` filter.

**A second, distinct risk at the same read-at-scale boundary: `supabase/config.toml`'s `max_rows` (1000) silently truncates any unpaginated read past that many rows — no error, just fewer rows than actually exist.** This is not the same bug the `.in()` rule above guards against (that one fails loudly, with a 400/`ERR_FAILED`; this one doesn't fail at all) and fixing the `.in()` shape does not fix it — "the row count fetched is the same order of magnitude either way" (the previous paragraph's own reasoning for why the `.in()` rewrite is safe) is only true if that fetch itself returns every row, which `max_rows` doesn't guarantee once a commit's element/relationship/fact count exceeds 1000. Found concretely the same way as the `.in()` bug: `listSystemsForLandscape` (`src/db/landscape.ts`) returned exactly 1,000 of a 2,000-system fixture's systems, with no error, and the landscape rendered "1,000 systems" as if that were the whole model.

**Rule:** every read of `elements_head`/`relationships_head`/`facts`/`deltas`/`commits` that can return more than one row must go through `src/db/selectAll.ts`'s `selectAll`, never a bare `.select(...)`. `selectAll` loops `.range()` in `max_rows`-sized pages until a short page, and — because its query must be built with `.select(columns, { count: 'exact' })` — cross-checks the total rows collected against Postgres's own exact count, throwing rather than returning a partial result on a mismatch. `max_rows` stays at 1000: it is a safety cap on any accidentally-unbounded request, not a target application code should rely on staying under; the fix is to page past it deliberately, not to raise it. A query passed to `selectAll` must also carry a deterministic order over a column (or column combination) unique within its filtered scope — `.range()`-based pagination over an unordered or non-uniquely-ordered query can skip or duplicate rows across page boundaries — typically the table's own primary key (or the part of it not already pinned by an `.eq()`). `src/db/headTableReads.test.ts` enforces the "goes through `selectAll`" half of this rule directly against `src/db`'s own source, the same way `assertInFilterSize` enforces the `.in()` rule above; a single-row lookup by a unique key (`.maybeSingle()`/`.single()`) is exempt, since `max_rows` cannot truncate a result that's already at most one row.

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

**Approval** is enabled only when: no blocking class remains, `mergeBase(B) == main.head`, schema validation passes at the branch head, and the reviewer holds `architect` or `owner`. Approving sets `branches.status = 'approved'`; merging calls `atlas.merge_branch`, which re-checks all four conditions inside the transaction (they can go stale between the click and the commit), writes the `merge` commit on main, moves `branches.head_commit_id` for main, marks the request `merged` and the branch `merged`, and materialises the new main head. If main moved in between, the procedure returns without a commit and the request returns to `pending` (its branch to `proposed`) — see the implementation note below for why that's a `NULL` return, not a thrown `REFRESH_REQUIRED` error.

**Implementation note (Sprint C1 step 2, `supabase/migrations/20260906161000_merge_review_queue.sql`):** the whole request lifecycle — submit, request changes, approve, reject, merge — is five security-definer functions (`atlas.submit_merge_request`/`request_changes`/`approve_merge_request`/`reject_merge_request`/`merge_branch`), each moving `merge_requests.status` and `branches.status` together in one transaction, for the same reason `atlas.commit_deltas` replaced a plain RLS-gated insert for `commits` (S-17): two separate client writes could partially fail and leave the two disagreeing about whether a branch is under review. `atlas.merge_branch`'s `REFRESH_REQUIRED` outcome is a `NULL` return, deliberately not a raised exception — an exception would roll back the same transaction's reset of the request to `pending` and the branch to `proposed`, undoing the very recovery it's meant to leave in place. It re-derives `mergeBase(B) == main.head` via `atlas.branch_reaches_commit(branch_id, commit_id)` (is `commit_id` in the branch head's own ancestry — the same DAG `parent_commit_id`/`merged_branch_head_commit_id` walk as `src/engine/head.ts`'s `ancestry`, expressed as a membership test) rather than trusting a client-supplied claim; schema validation at the branch head is trusted from the engine exactly as every other commit path already trusts it, per §6.5's implementation note.

**Implementation note (Sprint C1 step 7, `src/db/mergeRequests.ts`, `src/engine/mergeResolution.ts`):** the review queue UI and its "resolve, refresh, resubmit" loop needed one function step 2 didn't have — `atlas.resubmit_merge_request` (`supabase/migrations/20260906162000_resubmit_merge_request.sql`) moves an already-open `changes_requested` request back to `pending` with a refreshed cached classification, since `submit_merge_request` can only ever *insert* a first row and the partial unique index on open `branch_id`s would reject a second one. `sources_insert`'s RLS (`20260906162100_merge_resolution_source.sql`) also needed extending to allow the `merge_resolution` kind the wire contract and `deltas.source_id` FK had already anticipated but nothing wrote until this step. Field-conflict resolution (the three-column card's "keep this change / keep main / enter a value") is a one-click action, built and unit-tested (`src/engine/mergeResolution.test.ts`) exactly per this section's wording, including C15 below (`unresolvedFieldConflictKeys` refuses a refresh with any FIELD_CONFLICT key left unresolved, rather than letting main's value silently win). The structural-conflict actions (keep retraction / keep element and their dependant cascade, duplicate-relationship survivor pick, cardinality primary pick) and identity's "merge now" (`atlas.merge_elements`, itself deferred past this sprint — §11) are not built this step: the dependency-closure cascade those need is a substantial, separable unit of work. The review UI gives a real path for every conflict class today regardless — reopen the branch (`request_changes`) and fix it with the ordinary branch editor (Sprint C1 steps 3-4), then push a refresh and resubmit — and names this explicitly on structural-conflict cards rather than omitting their actions silently. Partial merge (ADR-006 amendment's split-into-a-new-branch) is likewise not built this step; `atlas.merge_branch` always merges the branch's entire head.

**Implementation note (Sprint C1 step 8, `src/ui/reviews/BranchRebasePanel.tsx`, `useBranchRebase.ts`):** the conflict cards moved out of `ReviewRequestView.tsx` into `src/ui/reviews/ConflictCards.tsx` so a draft change's own page (`src/ui/changes/ChangeView.tsx`) can render the identical findings, with the identical one-click field-conflict resolution, *before* a merge request exists at all — "rebase branch on new main head with conflict surfacing" doesn't have to wait for review to start. It calls the same `pushRefresh` (and the same C15 guard) as a review request's refresh, just without the merge_requests bookkeeping there's nothing yet to update; shown only while no merge request is open — once one exists, refreshing goes back through the review request's own page, since that's the one place also resubmitting the cached classification. This step also fixed a real bug the request-scoped refresh had: it passed `request.requested_by` as the merge-resolution source's `created_by`, which `sources_insert`'s RLS (`created_by = auth.uid()`) would reject the moment someone other than the original requester pushed the refresh — both refresh paths now use the actual signed-in user.

### 7.5 Refresh

Conceptually, `atlas.refresh_branch(branch_id, resolutions[])` produces the `merge` commit on the branch: `parent = B.head`, `mergedBranchHead = main.head`, deltas = the supplied resolutions. C15 is checked: the set of fact keys in `resolutions` must equal the set of FIELD_CONFLICT keys (plus the deltas implied by structural choices). After refresh, `mergeBase(B) == main.head` by construction.

**Implementation note (Sprint C1 step 2):** this is not a distinct SQL procedure. A refresh is an ordinary commit through the same `src/db/commits.ts`/`atlas.commit_deltas` path every other commit takes — `commit_deltas` now accepts `kind = 'merge'` on a `change` branch (previously restricted to `manual` only, Sprint H1 item 3), so the client (having computed the resolution deltas and the resulting folded head with the engine, exactly as it already does for any commit) calls `commitToBranch` with `envelope.kind = 'merge'` and `mergedBranchHeadCommitId = main.head`. `atlas.guard_branch_head_advance`'s existing "only while `status = 'draft'`" check (S-18) is what actually gates this — a branch under review (`proposed`/`approved`) must first go through `atlas.request_changes` (§7.4's implementation note) to reopen it before a refresh commit is accepted, matching S-18's rule rather than adding a second one.

---

## 8. Matching (capture pipeline)

**Deferred to Q1, alongside `atlas.merge_elements` — see §11.** Nothing below is implemented: the capture pipeline this matching feeds (ADR-004) doesn't exist, so nothing yet produces a candidate for it to match. The GIN trigram index level 3 depends on is already migrated (`elements_head_name_trgm_idx`, §3.5).

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
  -- Sprint H1 fix (docs/AUDIT-2026-09-U2.md §2.E.3 item 6): the stray `;`
  -- inside this subquery made the quoted SQL invalid as written, even
  -- though the actual migrated function (supabase/migrations/
  -- 20260906071200_tenancy.sql and its sibling RLS migrations) never had
  -- the bug — this was a transcription error in this document only.
  select exists (
    select 1 from branches b
    where b.id = p_branch and (b.kind = 'main' or b.shared_for_review)
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

-- `or created_by = auth.uid()`: a creator can always see the organisation
-- they just created, true by construction (the trigger below makes them
-- its owner in the same transaction) — needed because
-- `.insert(row).select('*').single()` requires the inserted row to satisfy
-- this SELECT policy at RETURNING time, before that trigger has run
-- (Sprint C1-H item 1; the RETURNING-time check raises the same "new row
-- violates row-level security policy" error a failed WITH CHECK would).
create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id) or created_by = auth.uid());

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

-- The `or atlas.model_shared_with_me(id)` clause below is not migrated
-- (Sprint H1 note — docs/AUDIT-2026-09-U2.md §2.E.3 item 3): `model_shares`
-- (§3.6) and `atlas.model_shared_with_me` don't exist yet. The migrated
-- policy is `using (atlas.is_member(org_id))` alone — no cross-org sharing
-- is possible until `model_shares` is built; no target sprint named. (This
-- is unrelated to ADR-014/ADR-017's identity/tenancy question, which is
-- about whether Atlas shares its *identity tables* with a different
-- product entirely — `model_shares.shared_with_org_id` only ever
-- references another organisation inside this same product.)
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

-- Same gap as models_select above (Sprint H1 note — item 4): the migrated
-- policy has no `or atlas.commit_shared_with_me(id)` clause — that function
-- and the `model_shares` table it would query don't exist yet.
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
-- as the author. Never on main (this policy's own `b.kind = 'change'` check,
-- not S-17 — see that row's Sprint H1 note in §1) and never on capture_draft
-- (service role only). `atlas.commit_deltas` (§5.3) is a security-definer
-- function and is how main actually advances; it bypasses this policy
-- entirely rather than satisfying it, exactly like every other
-- security-definer writer below.
create policy commits_insert on commits
  for insert to authenticated
  with check (
    atlas.has_role(org_id, 'owner', 'architect', 'contributor')
    and author_id = auth.uid()
    and kind in ('manual', 'merge')
    -- `atlas.commit_deltas` bypasses this policy (security definer) and, as
    -- of Sprint H1, restricts `p_kind` itself instead — see §5.3's
    -- implementation note (docs/AUDIT-2026-09-U2.md §2.E.3 item 14).
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
-- `atlas.commit_deltas` (§5.3, Sprint H1) and `atlas.seed_from_map` (§3.10)
-- are security definer and are the only writers of commits whose branch is
-- main. `atlas.merge_branch`, named here in earlier drafts, does not exist —
-- ADR-005's multi-branch merge review workflow it would have belonged to is
-- deferred (docs/ADR-000-foundations.md's "Deferred to follow-up ADRs").
```

`deltas` follow `commits` exactly (select through the commit's visibility; insert only alongside a commit the same user may insert; no update/delete). The policy is the same predicate applied via `exists (select 1 from commits c where c.id = deltas.commit_id)` — the RLS on `commits` does the work.

### 9.4 `comments`, `comment_mentions`, `notifications`, `atlas.profiles` (Sprint M1a amendment)

The literal RLS SQL below is superseded — reproducing it here would drift the moment the migration does, so this section now points at the migration instead of re-embedding it: `supabase/migrations/20260906240000_comments.sql` (`comments`/`comment_mentions`/`notifications`) and `20260906230000_profiles.sql` (`atlas.profiles`) are the source of truth, with every decision's rationale in their own module comments.

The shape, summarised:

- **`atlas.comment_visible_to_viewer(org_id, anchor_type, anchor_id)`**: the one predicate both `comments_select` and `comment_mentions_select` use. Contributor+ see every comment in their org unconditionally (same as commits/deltas/views); a viewer additionally needs `atlas.anchor_visible_to_viewer` true for the comment's own anchor. `comments.branch_id` is deliberately **not** part of this predicate — see §3.8's own note on why gating on it too would leave a merged element's comments permanently invisible to viewers.
- **`atlas.anchor_visible_to_viewer(anchor_type, anchor_id)`**: `decision` → always true (no migrated table yet); `change` → `atlas.branch_visible_to_viewer(anchor_id)`; `version` → the tag exists; `element`/`relationship` → present in `elements_head`/`relationships_head` at a commit whose branch is main or `shared_for_review`.
- **`comments_insert`**: contributor+ only, `author_id = auth.uid()`, must start `open` with no resolution metadata.
- **`comments_update`**: RLS narrows to author, owner/architect, or (for a root comment only) any contributor; the real split — body only by its author, resolution state by owner/architect or by a contributor resolving their *own* thread, never someone else's — is enforced by trigger `atlas.guard_comment_update`, the same "narrow the grant, enforce the rest in a trigger" pattern `atlas.guard_tag_on_main` already uses.
- **`atlas.check_anchor`** (`before insert on comments`): the named anchor must exist in permanent history (`deltas`' `element_create`/`relationship_create` rows, `branches`, or `tags` — never `elements_head`/`relationships_head`, so a comment can be posted on something already retracted); a reply must point at a root (not another reply) and share that root's exact anchor.
- **`atlas.process_comment_mentions`** (`after insert on comments`): parses `@handle` out of the body against `atlas.profiles.handle`, one `comment_mentions` row and one `notifications` row per resolved fellow-org member, skipping the author's own handle.
- **`notifications`**: `user_id = auth.uid()` only, for both select and (the `read_at` column only) update — private per recipient, never org-shared like comments.
- **`atlas.profiles`**: readable by any fellow org member (any shared org, any role); updatable (`display_name`/`handle`/`avatar_url`) by its own user only; no insert/delete grant to `authenticated` — rows exist only via `atlas.ensure_profile`.
- **`atlas.unresolved_comment_counts(model_id, anchor_ids[])`**: a POST RPC (§6.7 — sidesteps the GET `.in()` URL-length hazard entirely, the reason it exists as an RPC rather than a client-side `.in()` read), `security invoker` so a caller's own `comments_select` RLS applies exactly as it would to any other read.

Comments never block a merge (ADR-006, UI-principles §7.3): `atlas.merge_branch`/`atlas.approve_merge_request` never reference `comments` at all, so an open, unresolved thread on a branch being merged has no effect on it whatsoever — confirmed by `src/db/comments.integration.test.ts`'s own merge-survival test, which posts an unresolved comment and merges anyway in the same test.

### 9.5 Pattern for every other table

Every remaining table uses one of three templates, chosen per table:

| Template | Select | Insert/Update | Tables |
|---|---|---|---|
| **Member-scoped** | `is_member(org_id)` (+ viewer restriction where the row can reveal draft content) | `has_role(org_id, 'owner','architect')` or contributor+ per table | `branches`, `tags`, `sources`, `aliases`, `views`, `view_annotations` (all five: insert-only, no update/delete policy or grant — Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 19: this table originally called the carve-out out for `tags` alone, but the migrations apply it identically to `sources`/`aliases`/`views`/`view_annotations` too; only `view_layouts`, below, genuinely has an update policy, since a position hint is meant to change), `view_layouts` (update allowed — position hints are mutable), `merge_requests`, `capture_jobs`, `decisions*`, `assumptions`, `evidence`, `validation_results` |
| **Commit-scoped** | visible iff `commits_select` would pass for `commit_id` | service role only | `elements_head`, `relationships_head`, `facts`, `deltas` |
| **Product content** | `to authenticated using (true)` | service role only | `type_schemas`, `relationship_type_rules`, `capability_maps`, `capability_map_items`, `capability_map_sources` |

`element_merges` and `resolved_conflicts`: member-scoped select, insert via procedure only.

**`merge_requests`' insert/update is function-only, not a plain `has_role`/contributor+ policy (Sprint C1 amendment):** submitting a request has to move `branches.status` to `proposed` in the same transaction, and approving/rejecting/merging both a request and its branch's status together — two separate RLS-gated client writes could partially fail and leave the two disagreeing about whether a branch is under review. `atlas.submit_merge_request`/`request_changes`/`approve_merge_request`/`reject_merge_request`/`merge_branch` (§7.4, §7.5) are the only writers, each still deriving its own role check from `auth.uid()` rather than trusting a client-supplied one — the same reasoning, and the same precedent, as `atlas.commit_deltas` superseding a plain RLS-gated insert for `commits` (S-17). `merge_requests` therefore has a select policy only; no insert/update policy or grant exists for `authenticated`.

**`tags`' select policy is exactly `using (atlas.is_member(org_id))`** (Sprint H1 note — docs/AUDIT-2026-09-U2.md §2.E.3 item 5), not yet the cross-org, tag-pinned sharing P-24 describes — the migration's own comment says as much: "Cross-org visibility of a specifically shared tag is added once model_shares lands." P-24 names the target behaviour once `model_shares` (§3.6) exists; until then it is not a passing test, it is a recorded intention, same as the `models_select`/`commits_select` gaps above.

`user_preferences`: **user-scoped** — `user_id = auth.uid()` on select/insert/update, no delete. The only table not scoped by `org_id`.

---

## 10. Tests that must exist before any UI is built

All property tests use generated inputs (fast-check or equivalent) with shrinking, and run against a real Postgres (testcontainers), not a mock. "Reference fold" means the §6.2 pseudocode implemented plainly, without caching, kept in the test tree.

### 10.1 Round-trip

| Id | Test |
|---|---|
| RT-1 | For every `DeltaKind`: arbitrary `Delta` → JSON → `Delta` is deep-equal; `Delta` → `deltas` row → `Delta` is deep-equal (the §4.4 mapping is a bijection on valid deltas). |
| RT-2 | Arbitrary valid `CommitEnvelope` → `atlas.commit_deltas` (Sprint H1 rename, matching the implementation — docs/AUDIT-2026-09-U2.md §2.E.3 item 13; this table named the aspirational `atlas.commit` before it existed) → read back commit + deltas ordered by `seq` → equals the envelope (ids and order preserved). |
| RT-3 | Arbitrary model with a tag → export (elements, relationships, facts at the tag) → import into a fresh model preserving ids → `head_hash` equal. |
| RT-4 | Seed a model from a `capability_maps` version → diff the seeded head against the map → empty; every seeded element has a `template_code` alias and `attributes.templateRef`. |
| RT-5 | `type_schemas.json_schema` generated from `src/contracts/delta.ts` equals the checked-in seed, and every arbitrary `ElementAttributesByType[T]` validates against the schema for `T` (and an arbitrary object with one required key removed does not). |
| RT-6 | `atlas.merge_elements(a, b)` then resolve `a` and `b` through `aliases` → same survivor; `deltas` and `relationships_head` rows that referenced `b` before the merge are byte-identical after it (history untouched); the survivor carries every relationship `b` had, deduplicated per S-6. |
| RT-7 | For an arbitrary `views` row: node and edge set returned by the view query is identical before and after deleting all `view_layouts` and `view_annotations` rows for it. |
| RT-8 | Comment anchored to an element on a change branch → merge the branch → the same comment is still listed on the element, unchanged, and becomes visible to a viewer who couldn't see it pre-merge (Sprint M1a amendment: anchored to the element's own id, never a delta or commit id — `src/db/comments.integration.test.ts`'s "survives merge" test). |
| RT-9 | Arbitrary `UserPreferences` → `user_preferences` row → `UserPreferences` is deep-equal; a user reads only their own row and cannot read, write or delete another user's (P-22 style matrix, user-scoped). |
| RT-10 | Comment anchored to an element on a change branch → refresh (pull main forward into the branch) → the same comment, unchanged, is still listed on the element (Sprint M1a, `src/db/comments.integration.test.ts`). |
| RT-11 | Comment anchored to an element → retract the element → the comment is still readable (rule 5) and flagged as anchored to a retracted subject; posting a *new* comment on an already-retracted element still succeeds (Sprint M1a). |
| RT-12 | A comment body containing `@handle` → one `comment_mentions` row and one `notifications` row per resolved fellow-org member, none for a handle mentioning the comment's own author, none for a handle with no matching profile in the org (Sprint M1a). |

### 10.2 Properties — fold and materialisation

| Id | Property |
|---|---|
| P-1 | `fold` is deterministic: two runs over the same DAG give the same `head_hash`. |
| P-2 | For arbitrary commit DAGs (branch, refresh, merge, tags, GC in between): `head_hash(materialise(c)) == head_hash(fold(c))` and the persisted rows equal the reference fold row-for-row. |
| P-3 | For two commits with disjoint fact-key sets, applying them in either order gives the same `head_hash`. |
| P-4 | `apply(apply(H, retract(x)), restore(x))` has the same elements/relationships/facts for `x` as `H`, and the recovered facts keep their original `delta_id`/provenance (not the restore's). |
| P-5 | For every live fact, following `previous_delta_id` terminates at a create delta for that subject; the chain length equals the number of updates to that key in the fact's ancestry; no chain has a cycle. |
| P-6 | Snapshot-and-replay: after GC, `main`'s current head and every tagged commit still has head rows (Sprint H1 correction: not "every branch head" — a `change` branch is never materialised at all, §3.5); no other commit does; `replayFromNearestRetained(c)` for any commit equals `fold(c)`. |
| P-7 | Tag creation recomputes from genesis: injecting a corrupted `elements_head` row for the tagged commit before tagging causes tag creation to fail. |

### 10.3 Properties — commit invariants and validation

| Id | Property |
|---|---|
| P-8 | For each invariant C1–C17 there is a generator that produces an otherwise-valid envelope violating exactly that invariant, and `atlas.commit_deltas` (Sprint H1 rename, see RT-2) rejects it naming that id. Valid envelopes are accepted. |
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
| P-23 | Viewer matrix: a viewer sees commits/heads/deltas on main, tagged commits, and `shared_for_review` branches, and nothing on draft or capture branches; sees a comment iff its anchor is visible to them (Sprint M1a amendment: `visibility`'s `team`/`internal` split is dropped for now — see §3.8/§9.4 — so this row is now purely about anchor visibility, not a visibility column). |
| P-24 | Share matrix: a member of a shared-with org sees exactly the pinned tag's commit and heads (tag-pinned) or main's commits and heads (unpinned), never branches, comments, decisions or sources; nothing after `expires_at`. |
| P-25 | Write matrix: contributor can insert commits on draft change branches only; viewer cannot insert anything model-bearing, including a comment (Sprint M1a: `comments_insert` requires contributor+); nobody with an application role can insert a commit on main, update or delete a commit, delta or tag; only architect+ can create tags or approve merge requests; a comment thread resolves by architect+ (any thread) or by a contributor (their own thread only, Sprint M1a's narrower matrix than the original architect+-only draft). |
| P-26 | Last owner: deleting or demoting the sole owner of an org fails. |

### 10.7 Properties — content

| Id | Property |
|---|---|
| P-27 | Capability map upgrade: seed v1, rename and re-parent arbitrary items, publish v2 with arbitrary additions/renames; the computed upgrade diff matches every renamed item through its `template_code` alias and creates no duplicates. |
| P-28 | `owns` cardinality: at most one `primary = true` owner per target survives V3; a second is a cardinality conflict at merge and a V3 failure on commit. |

A UI ticket may not be opened until RT-1…RT-9 and P-1…P-28 exist and pass in CI.

---

## 11. Deferred

Sprint H1 item 12 (docs/AUDIT-2026-09-U2.md's own deferred-items review, §7.2): every item this spec itself defers, in one place, rather than scattered across the sections that name them. Named explicitly so none is mistaken for settled, the same reasoning docs/ADR-000-foundations.md's own "Deferred to follow-up ADRs" section states for the ADR-level list.

| Item | What's deferred | Target | Why |
|---|---|---|---|
| Member directory and invite UI | Sprint M1a's `atlas.profiles` (§3.2) gives every member a handle/display name, and the RLS to read a fellow member's, but there is still no page listing an org's members, no invite flow, and no @mention autocomplete — mention resolution today is purely server-side text parsing (`atlas.process_comment_mentions`) against a handle the author already knows | **U4** | Real UI surface (a member list, an invite-by-email flow, a mention picker) that Sprint M1a's own scope ("plumbing track... no UI beyond what tests need") deliberately excluded — the backend it depends on (`atlas.profiles`) is done; the UI isn't started. |
| Notification tray UI | `notifications` (§3.8) and `src/db/notifications.ts` ship a full read/mark-read repository and an unread count; there is no inbox list, no in-app toast, no click-through to the mentioning comment | **U4** | Same sprint-scope decision as the member directory row above (asked and answered: "unread count only" for M1a) — grouped with it since both are the UI half of the same backend-complete, UI-deferred pattern U3b's "duplicates count wired to zero until Q1" already established. |
| `type_schemas` (§3.3, ADR-001/ADR-015) | The full TypeScript-type-to-JSON-Schema generator plus checked-in seed and validator (RT-5) | Sprint K1 | Real schema-validation infrastructure the element page never needed; Sprint K1's capture edge function is the first consumer outside the TypeScript runtime that will actually need it. Already deferred inline at §3.3; listed here too for one-place discoverability. |
| Delta-apply in SQL (§5.3's implementation note, ADR-015) | Teaching `atlas.commit_deltas` to apply just the *new* commit's deltas directly against the existing `elements_head`/`relationships_head`/`facts` rows, rather than receiving and replacing the whole materialised set on every commit | **Before Sprint K1** | The current design's real, measured cost (~8.45 MB per single-element edit against a 2,010-element/6,000-relationship/~16,000-fact model, budgeted at 12 MB — `e2e/landscape-perf.spec.ts`) is accepted today because this product's stated scale is one or two architects editing by hand, not a high-frequency writer. Sprint K1's capture pipeline is exactly that: an automated writer producing commits at a rate and volume manual editing never will. The payload-size tradeoff needs to be resolved *before* that new write pressure arrives, not discovered after a capture run is already timing out or exceeding the budget in production. |
| `atlas.merge_elements` and §8's name+type+context trigram identity matching | The SQL procedure that actually executes an identity merge (RT-6), and the fuzzy-matching algorithm (trigram similarity ≥ 0.6, structural context, P-19) that would ever produce a candidate pair for it to merge | **Q1** | Neither has a reason to exist independently of the other: `merge_elements` has nothing to merge until something proposes "these two elements might be the same," and the matching algorithm only matters once the capture pipeline (Sprint K1) produces draft elements to match against a model's existing ones. Both wait on that same upstream dependency, and both land together once Q1 actually does the identity-matching work — Sprint C1 closes without either, per this row's own retargeting. The GIN trigram index this depends on (`elements_head_name_trgm_idx`, §3.5) is already migrated — the index exists; nothing queries it for matching purposes yet. |
| Per-element accept/skip split, and the change page's split/delivered-remaining view (ADR-006's amendment) | `branches.split_from` exists (§3.4) and `atlas.merge_branch`/the review queue accept/reject a branch *whole*; nothing implements splitting an accepted subset into a new branch, its dependency-closure check, or the change page's "delivered / remaining" breakdown across an original branch and its splits | **C2** | ADR-006's amendment names the full design (dependency closure before confirmation, the change page and roadmap treating a split lineage as one logical change) — real, scoped work for its own sprint, not implied by anything C1 built. |
| Server-persisted identity-warning dismissals (P-18), and Playwright coverage for the review queue (`BranchRebasePanel`, `/review`) | `merge_requests.classification` already has the shape (§8's "keep both... recorded in classification"); today's dismissal is client-session-only (`src/ui/reviews/ReviewRequestView.tsx`'s own comment: "'Keep both' just dismisses the warning for this browser session") — a reload loses it, and no automated test exercises the review queue's UI at all | **C2** | Both wait on the same review-queue UI surface area C1 built but did not finish hardening; grouped here as one line of follow-up rather than two, since persisting the dismissal and testing the surface it lives on are the same piece of unfinished work. |
| Roadmap view (target-date timeline across changes, UI-principles' change-page cross-reference) | No roadmap page or query exists yet — `branches.target_date` (§3.4) is captured but nothing renders a timeline over it | **R1** | Depends on the split/closure work above for an accurate "one logical change" grouping (a split branch's target date should roll up to its original, not appear as a second entry) — sequenced after C2, not before. |
| Keyboard shortcuts for the As-is/To-be/Diff control (§8.8's `1`/`2`/`3`), and a propose-change element/type picker | `BranchViewModeControl.tsx`'s own doc comment names the shortcut gap explicitly; "propose a change" (creating a branch from an element/type picker rather than only from an existing element's own page) has no UI yet | **M1** | Both are real, self-contained UI gaps named at their own point of use (not implied to be broken, just not yet built) rather than tracked only in scattered comments. |
| A generated (typed) Supabase client, replacing the untyped `Client` (src/db/branches.ts's own module comment: "no generated `Database` schema") | Every `src/db` function casts `data`/`error` by hand at its own return point instead of getting the row shape from a generated schema | **H2** | A real correctness/maintenance improvement (a schema drift would surface as a type error, not a runtime surprise) with no urgency today — regenerating on every migration is upkeep work worth taking on deliberately, not mid-sprint, and Sprint H2 is the first point named for revisiting this project's own H1/H2 numbering scheme. |
| `relationship_type_rules` as a migrated table (§3.3) | A real `relationship_type_rules` table, as originally specified below | **Superseded — never.** | Sprint H1's `RELATIONSHIP_TYPE_RULES` constant (`src/contracts/relationshipTypeRules.ts`) already fully enforces C9/V3 — see §3.3's own note on this table. A migrated table would only ever be worth building if the ruleset needed to become live-editable product content without a code change (e.g. an admin screen for adjusting rules) — nothing today requires that, and none is planned. This is not "not yet"; it is a permanent design choice, recorded so a future request to migrate it has to argue against this decision rather than treat the gap as an oversight. |
| Landscape p5 fps, 30 → 45 (UI-principles §8.6, ADR-015) | Closing the gap between the measured p5 frame rate (~30fps, three clean runs — `e2e/landscape-perf.spec.ts`) and §8.6's actual ≥45fps target; the CI gate itself is 28, a no-regression baseline, not this target | **R-perf** | Sprint C1-H item 1d got this test running end to end for the first time (previously blocked by an `.in()`-filter-size bug, then a `max_rows` truncation bug — both fixed); the ~30fps p5 number it then produced is real and reproducible, not an artifact of either fix. Closing it is a rendering-performance investigation, not a read-path one — profile the worst frames first (which ones miss budget, and why) rather than guessing at a fix. |
| True drag-and-drop for capability map sibling reordering (Sprint U4-1 C1) | "Tailoring allows drag-to-reorder among siblings" ships as move buttons — left/right at L1, up/down at L2 — swapping `attributes.order` with an adjacent sibling, not a mouse drag gesture (`src/ui/capabilityMap/useCapabilityReorder.ts`'s own module comment: no drag-and-drop anywhere else in this codebase, no DnD library, and buttons stay keyboard-/screen-reader-operable, which a bare `draggable` element wouldn't be) | **U4-2** | Reviewed and accepted as the shipped behaviour for U4-1, not a gap to close before the item counts as done — the *effect* (a capability swaps places with an adjacent sibling) is identical either way. A real drag gesture is a genuine interaction upgrade once tailoring sees more day-to-day use, worth its own sprint rather than folded into C1 unreviewed. |

Everything else this document defers is named at its point of use, not repeated here: SPEC §2's `created_at` exceptions, §9's `model_shares`-dependent RLS clauses (§9.2/§9.3/§9.5, all three annotated "pending `model_shares`, no target sprint named"), and §3.6's `capture_job_id` FK (pending `capture_jobs`, Sprint K1) are documentation of an absent dependency, not a scheduled follow-up in the sense this section means.
