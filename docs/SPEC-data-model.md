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
| `element_type` | `capability`, `system`, `container`, `actor`, `value_stream` (S1 item 18 removed `component`, `20260913010000_remove_component_element_type.sql`; `deltas.element_type` itself moved from this enum to plain `text` in the same migration — that column's own historical rows are immutable, see the migration's own comment. ADR-023/F6 adds `value_stream` — a stream, or a stage when `parent_id` is set — via `alter type … add value` in `20260921070000_value_streams.sql`, the first addition to this enum since it was created) |
| `relationship_type` | `supports`, `uses`, `owns`, `flows_to`, `replaces` (ADR-001's "replaces" amendment, `20260921030000_relationship_type_replaces.sql`: from = the replacement, to = the retiring element), `enables` (ADR-023/F6: capability → stage) |
| `branch_kind` | `main`, `change`, `capture_draft` |
| `branch_status` | `draft`, `proposed`, `in_review`, `approved`, `merged`, `rejected`, `archived` |
| `commit_kind` | `genesis`, `manual`, `capture`, `merge`, `template_seed`, `preparation` (ADR-021 §2a amendment 1, C2b — written only by `atlas.refresh_branch`, never directly by a client, §5.1) |
| `delta_kind` | `element_create`, `element_update`, `element_retract`, `element_restore`, `relationship_create`, `relationship_update`, `relationship_retract`, `relationship_restore` |
| `subject_type` | `element`, `relationship` |
| `source_kind` | `document`, `spreadsheet`, `interview`, `capture_job`, `template`, `manual`, `merge_resolution`, `attestation` (ADR-025: a "Still accurate" confirmation — one per confirmation, `user_id` null) |
| `alias_type` | `name`, `code`, `external_ref`, `source_system_key`, `template_code`, `merged_id` |
| `merge_request_status` | `pending`, `changes_requested`, `approved`, `merged`, `rejected` |
| `capture_status` | `pending`, `parsed`, `reviewed`, `discarded` |
| `decision_status` | `proposed`, `accepted`, `superseded`, `rejected` |
| `argument_stance` | `for`, `against`, `neutral` |
| `assumption_status` | `open`, `validated`, `invalidated` |
| `evidence_kind` | `document`, `link`, `capture_job_ref`, `comment_ref` |
| `comment_status` | `open`, `resolved` |
| `anchor_type` | `element`, `relationship`, `change`, `decision`, `version` (Sprint M1a amendment — see §3.8; `comment_visibility`, `delta`, and `branch` from the original draft are gone: visibility is dropped for now, `branch` is renamed `change`, and `delta` has no replacement yet, so an attribute-level "comment on this value" anchor isn't reachable until it does) |
| `notification_kind` | `mention`, `reply` (Sprint M1a added `mention`; Sprint M1b added `reply` in its own migration, `20260906340000_notification_kind_reply.sql`, per the `commit_kind`/`genesis` precedent — extensible by name, not by schema) |
| `view_kind` | `landscape`, `context`, `container`, `capability_map` (S1 item 18 removed `component`, `20260913010000_remove_component_element_type.sql`) |
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
| `start_page` | text | nullable, no default, `check (start_page in ('home','capability-map','landscape'))` — `20261109010000_user_preferences_start_page.sql`; where the app opens when this person enters a model. Null means the role decides (owner/architect: home; everyone else: capability-map) |
| `inspector_collapsed` | boolean | not null default false — V2b, `20260917040000_inspector_collapsed_preference.sql`; the shared Inspector panel's resting collapse state (overridden live by focus — see that migration's own column comment) |
| `updated_at` | timestamptz | not null default now() |

(This table has grown further columns than this list currently shows in full — `landscape_colour_by`, the three `landscape_*_lane_keys` arrays, and the three `notify_on_*` booleans, each added by its own later migration and documented in that migration's own comment; `src/contracts/userPreferences.ts` is the up-to-date wire shape.)

No `org_id` (exception to S-20: the row is not org-bearing). RLS: `user_id = auth.uid()` for select, insert, update; no delete policy (a row is reset, not removed). Defaults in the UI when no row exists: architect door for `owner`/`architect` members, director door otherwise; the row is created on first change, not on sign-up. `capability_map_colour_by` is the one column here without a fixed default — unlike its three siblings, null (no override ever saved) resolves in the UI, not the schema: exposure for director home mode, coverage for architect, "none" while the model has no systems at all (`src/ui/capabilityMap/metrics.ts`'s `resolveDefaultColourBy`) — a saved value always wins over that computed default ("remember last choice per user").

#### `attribute_definitions` (F1, "custom attributes")
Org-defined attributes — core attributes stay code (§3.3's own note: "attribute order and per-type attribute definitions live in `src/contracts` as code," materialised as `ATTRIBUTE_SCHEMA_BY_TYPE`); the long tail becomes org-scoped data instead. A definition applies across every model in the organisation, never a single model — org-scoped like `organisations`/`model_shares`, not model-scoped like `models` itself.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | pk |
| `org_id` | uuid | → `organisations(id)` |
| `key` | text | not null, non-empty — the `attributes` jsonb key an `element.update_custom`/`relationship.update_custom` delta (§4.1) writes |
| `label` | text | not null, non-empty |
| `kind` | text | not null, `check (kind in ('text','number','date','boolean','select','link'))` |
| `options` | text[] | nullable — `kind = 'select'` only, the allowed values in display order |
| `applies_to` | text[] | not null, `check (array_length(applies_to,1) > 0 and applies_to <@ array['capability','system','container','actor'])` — relationship-scoped custom attributes are out of scope for now |
| `required` | boolean | not null default false |
| `description` | text | nullable |
| `order_index` | int | not null default 0 |
| `deprecated_at` | timestamptz | nullable — soft-disable, mirroring `models.archived_at`: a deprecated definition disappears from "add a value" pickers, but a value already set on an element keeps rendering unchanged |
| `created_by` | uuid | → `auth.users(id)` |
| `created_at` | timestamptz | not null default now() |

Unique `(org_id, key)` — a key is reused across every element type it applies to, never redefined twice for the same org. Index `(org_id, order_index)`.

RLS: select for any org member (`atlas.is_member(org_id)` — every member's element/browse pages need to read these to render/filter by them, not just an owner); insert/update owner-only (`atlas.has_role(org_id, 'owner')`), matching `organisation_settings.sql`'s own shape; no delete policy — deprecate is this table's only "retire" mechanism. Reorder (`order_index`) and deprecate (`deprecated_at`) are both plain, owner-gated column writes, not RPCs: neither needs an atomic cross-table effect (unlike `merge_requests`/`decisions`), and neither has a restrictive lifecycle state to gate *when* an edit is allowed (unlike `decisions`/`branches.intent`), so a guard trigger would add nothing a plain grant-list doesn't already cover.

A custom value is stored in the same `elements_head.attributes`/`relationships_head.attributes` jsonb as any core attribute, with the same provenance (`facts`, §3.6) — `element.update_custom`/`relationship.update_custom` (§4.1) are the only delta kinds that write one, deliberately kept separate from `element.update`/`relationship.update` rather than widening those kinds' own closed attribute-key union (see §4.1's own note). No engine-level (fold-time) validation exists for a custom attribute's value, matching — not exceeding — the bar core attributes are already held to: `atlas.commit_deltas`/`apply()` write the `attributes` jsonb verbatim regardless of kind; validation for both is client-side only, at the commit boundary (`src/contracts/attributeSchema.ts`'s `validateAttributeValue`/`validateCustomAttributeValue`), before a delta is ever built.

Promotion to core (the prompt's own "code change + data-migration commit") is a documented process, not an in-app feature: add the field to `delta.ts`/`attributeSchema.ts`, write a migration copying `attributes.<key>` values into wherever the newly-core field needs to live, retire the `attribute_definitions` row. Nothing in the product does this for you.

F8 ("export") lists its column set as "core attributes + custom attributes + provenance" — this table and its rendering/validation path are what make that literally satisfiable now; F8 itself is not otherwise touched by this sprint.

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

Primary key `(relationship_type, from_type, to_type)`. No `org_id`; product content. Seed rows (S1 item 18 removed the two `component` rows this table used to carry, `uses: component→component` and `uses: component→container`):

| relationship_type | from | to | max_per_from | max_primary_per_to | max_primary_per_from |
|---|---|---|---|---|---|
| supports | system | capability | | | 1 |
| supports | container | capability | | | 1 |
| uses | system | system | | | |
| uses | container | container | | | |
| uses | container | system | | | |
| uses | actor | system | | | |
| uses | actor | container | | | |
| owns | actor | capability | | 1 | |
| owns | actor | system | | 1 | |
| owns | actor | container | | 1 | |
| flows_to | system | system | | | |
| flows_to | container | container | | | |
| enables | capability | value_stream | | | |

**Amended (F6, ADR-023).** The `enables (capability, value_stream)` row
admits the whole `value_stream` type because this table has never
expressed anything finer than `(relationship_type, from_type, to_type)`;
"a stage, never a stream" (the target's own `parent_id` must be non-null)
is C22 (§5.2), an engine check alongside C18/C20, for the same reason
"Platforms and modules" below kept its parent-kind rule out of this table.
No cardinality in either direction.

**Amended ("Platforms and modules").** The new `supports (container, capability)`
row lets a `Container` support a capability directly — a platform system's own
children (`kind: 'platform'`, `src/contracts/delta.ts`'s `SystemKind`) are its
modules, and a module supports a capability, not the platform itself. Legal for
any container, not restricted to "only a platform's own module" — this table has
never expressed anything finer than `(relationship_type, from_type, to_type)`,
and a parent-kind-aware invariant would be more machinery than this feature
needs. Same `max_primary_per_from: 1` cardinality as the system row, enforced
identically: `checkPrimaryCardinality` (C17) is already generic on the anchor
element's id with no type check, and the existing partial unique index
(`relationships_head_one_primary_supports_per_system`, keyed on
`(commit_id, from_element_id)` with no type restriction) already covers a
container anchor too — no new migration.

**Amended (S1 item 11a, external actors).** Two new rows, `(uses, actor,
system)` and `(uses, actor, container)` — an actor (a person, team, or
external organisation) can now `uses` a system or container directly
("Ofgem uses the reporting system"), not only `owns` one. No cardinality
cap, same as every other `uses` row; no `flows_to` row for an actor
endpoint — that relationship stays System/Container-to-System/Container
only. See ADR-001's own amendment for the full picture (the new `owns`
constraint this item also adds, C20, is unrelated to this table — it
constrains an existing `(owns, actor, *)` row's own attribute value, not
which triples are legal at all).

**Amended (a platform's own modules can have their own owner).** A new row,
`(owns, actor, container)` — a platform's own modules are frequently owned
by a different business unit than the platform itself, or than each other
(Salesforce's CRM vs Field Service, SAP's FI vs PM); `uses (actor,
container)` above already treats a module as a first-class anchor, and
`owns` had no documented reason left to be the one relationship type that
still couldn't reach one directly — this was a gap, not a deliberate
exclusion. Same `max_primary_per_to: 1` cardinality as the system row,
enforced identically: `checkPrimaryCardinality`/`checkExternalOwnerRole`
(`src/engine/deltas.ts`) are already generic on the owned element's id with
no type check, and `relationship_type_rules` is a TypeScript constant, not
a real table yet (this section's own opening note) — no migration.

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
| `intent` | text | nullable, `check (intent is null or intent in ('record','propose','correct','explore'))`; prompt pack F0 — the change's own "why," set at creation, editable only while `status = 'draft'` (`atlas.guard_branch_intent_update`) |
| `created_by` | uuid | → `auth.users(id)` |
| `updated_at` | timestamptz | not null |

Partial unique index `(model_id) where kind = 'main'`. Index `(model_id, status)`. Index `(split_from) where split_from is not null`. Check: `kind = 'main'` ⇒ `status = 'draft'` (main is always open). Check: `kind = 'capture_draft'` ⇒ `status in ('draft','archived')`. Check: `split_from is not null` ⇒ `kind = 'change'`. Check: `(kind = 'change') = (intent is not null)` — every change branch carries an intent, main and capture_draft never do (F0). `atlas.split_branch` carries the split branch's own `intent` forward onto the new branch (a split is a subset of the same change, never a change of purpose). (ADR-018 removed the old kind-conditional `base_commit_id`/`head_commit_id` nullability checks — both columns are simply `not null` now, for every branch kind, so there is nothing left to check per-kind.)

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

Within `attributes`, `description` on `uses`/`flows_to` (`src/contracts/delta.ts`'s `UsesAttributes`/`FlowsToAttributes`) holds the connection's verb phrase (e.g. "withdraws cash using") and is required at creation — a UI-level requirement, not a NOT NULL, since `attributes` is a single jsonb column with no per-key constraints.

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
| `import_touched_element_ids` | uuid[] | nullable; not null iff `kind = 'spreadsheet'` — **added by F2-lite** (`20260918010000_import_touched_element_ids.sql`): every element id that import run's own rows matched or created, so a change page can recompute "not in file" (this model's own systems/platforms/modules minus this set) at any later time, not just while the file is still in memory. |
| `pending_aliases` | jsonb | not null, default `'[]'` — **added by the import close-out** (`20260919010000_pending_aliases.sql`): `{elementId, aliasValue}[]` staged from this import run's own same-as picks. A pick is a claim ("this row's name is another name for that existing element") that only becomes true once the change carrying it actually lands — so the alias itself is written only when `mergeApprovedRequest` (`src/db/mergeRequests.ts`) merges the branch these deltas belong to (found via `listOwnDeltas` over the branch's own commit range, by `sourceId`), never at import/commit time. Cleared (`clearPendingAliases`) right after those writes; a change that's cancelled or rejected instead leaves this array to rot on a `sources` row nothing ever reads again — no alias is ever written for it. |

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

**Amended (E7):** `atlas.merge_elements` (via `atlas.record_element_merge`) writes a *second* alias row alongside the `merged_id` one: an ordinary `alias_type = 'name'` row, `alias_value` the merged element's own former name, pointing at the survivor — resolved with the human directly, since the `merged_id` alias's own id-shaped value can never satisfy the E7 golden path's "old name found by search" (`loadSearchPool`, `src/db/elementSearch.ts`, both excludes `merged_id` from its pool and, being a substring match against an alias *string*, could never match a typed name against a UUID regardless). A name collision with an existing alias elsewhere in the model — the same unique constraint above already governs every other name alias — fails the whole `atlas.record_element_merge` call and rolls back both alias rows and the `element_merges` row (the merge commit itself has already succeeded by that point and stays live either way, per that function's own module comment).

**Amended ("Convert to a module of…", `src/engine/convertSystemToModule.ts`):** a system that turns out to have been built on an existing platform all along can be converted into one of its modules — a real import scenario (an element identified as a new, standalone system was really one more module of a platform already in the model), and a genuinely new kind of operation: `elementType` is compile-time immutable (`PromotedElementAttribute`, §5.1, only ever promotes `name`/`parentId`) and `element_merges` explicitly refuses two different element types (a system and a container can never be "the same real thing" in the merge sense), so neither existing mechanism could express it. One ordinary `manual` commit retracts the system, creates a fresh container in its place (parented on the chosen platform, carrying over every attribute `container` has room for, `disposition` included (F11) — `vendor`/`externalOrganisation`/`kind`/`supportEndsAt` have nowhere to go and are surfaced to the person converting, not silently dropped), and re-points every one of the system's own live relationships onto the new id — legal for all four relationship types today thanks to the platform/module rows this document's own §3.3 amendments already added (`supports`, `uses`, `owns` via `owns/actor/container`, `flows_to`). No new table: an ordinary `createAlias` call (`aliasType: 'name'`) records the system's former name onto the new container, the same "old name found by search" result E7's own amendment gives a merge, just without `element_merges`' own audit record or `merged_id` alias — this operation has no v1 undo (unlike a merge's `buildUndoMergeElementsDeltas`), so there is nothing yet that would need one.

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

Unique `(model_id, merged_element_id)` — an id is merged away at most once. Append-only. The procedure `atlas.merge_elements` writes this row, two `aliases` rows (`merged_id` and, per this table's own amendment above, `name`), and a commit on the chosen branch containing: retract of `merged_element_id`, retract+create for each relationship that touched it (re-pointed to the survivor, skipping duplicates per S-6), and re-parent updates for its children.

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

#### `duplicate_check_runs`
One duplicate-detection run against one model (F4, ADR-019 — `20260924010000_duplicates_schema.sql`).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `triggered_by` | uuid | → `auth.users(id)`, nullable — `null` means a scheduled (`pg_cron`) run, never a manual one |
| `status` | duplicate_check_status | not null default `running` |
| `candidate_count` | int | nullable until finished |
| `error` | text | nullable — set only on `status = 'failed'` |
| `finished_at` | timestamptz | nullable |

Index `(model_id, created_at desc)` — the report's own "last checked" reads the newest row per model.

#### `duplicate_candidates`
The current, re-computed-each-run set of plausible duplicate pairs for a model (F4, ADR-019).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `element_a_id`, `element_b_id` | uuid | not null, `check (element_a_id < element_b_id)` — one canonical row per unordered pair |
| `element_type` | element_type | not null, `check (element_type in ('system','container'))` — v1 scope; both sides always share this type by construction |
| `score` | numeric(4,3) | not null, `[0,1]` — a documented, tunable weighted combination of the signals below, never derived science |
| `name_similarity` | real | not null, `[0,1]` — the `pg_trgm` `%`-operator match that gates a pair's existence at all (`IDENTITY_TRIGRAM_THRESHOLD`, 0.6, SPEC §8 point 3) |
| `signals` | jsonb | not null default `'{}'` — `{sharedOwner, sharedVendor, sharedParent, sharedDescription, neighbourOverlapCount, matchedVia}`, the exact inputs `score` was computed from |
| `last_seen_check_run_id` | uuid | → `duplicate_check_runs(id)` |

Unique `(model_id, element_a_id, element_b_id)`. Index `(model_id, score desc)`. Re-computed wholesale by every `atlas.run_duplicate_check` call: a pair refreshed if it still qualifies, deleted if it no longer does — never left stale. The report's own read query (not this table alone) inner-joins both sides to `elements_head` at main's current head, so a merged-away or retracted element silently drops the pair with no cleanup RPC needed.

#### `duplicate_dismissals`
A human's permanent "not a duplicate" for one pair (F4, ADR-019).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `element_a_id`, `element_b_id` | uuid | not null, `check (element_a_id < element_b_id)` |
| `dismissed_by` | uuid | not null |

Unique `(model_id, element_a_id, element_b_id)`. Append-only in v1 — consulted by `atlas.run_duplicate_check` so a dismissed pair is never re-proposed; no un-dismiss action exists yet, and since this table isn't among CLAUDE.md rule 5's protected ones, adding one later is an ordinary feature addition, not a design change.

**`models.duplicates_check_enabled`** (boolean, not null, default `false`) — the per-model opt-in for the nightly `pg_cron` sweep over every enabled model, added alongside the three tables above. A plain column grant (`grant update (duplicates_check_enabled) on models to authenticated`), not a dedicated RPC: `models_update`'s own existing owner/architect RLS already gates it correctly, with none of the asymmetry that made `archived_at` withhold a blanket grant (`20260911040000_model_archive.sql`).

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

#### `notifications` (Sprint M1a, tray UI added Sprint M1b)
One in-app notification per mentioned member per comment, and (Sprint M1b) per thread participant on a reply. No email delivery. Sprint M1a shipped the record and an unread count only (`src/db/notifications.ts`); Sprint M1b built the tray UI this row used to defer to U4 — bell, inbox, "Mark all read", kind-dependent wording, deep link — `src/ui/components/NotificationTray/NotificationTray.tsx`, `src/ui/comments/useNotificationTray.ts`. See §11 for what that UI's own deep link still can't reach (a `relationship`/`version`/`decision`-anchored notification has no page to link to yet).

| Column | Type | Constraints |
|---|---|---|
| `user_id` | uuid | not null — the recipient |
| `kind` | notification_kind | not null — `mention` or `reply` (Sprint M1b added the second value) |
| `comment_id` | uuid | → `comments(id)` on delete cascade, nullable |
| `read_at` | timestamptz | nullable |

Index `(user_id, read_at)`. Written only by `atlas.process_comment_mentions`, alongside its `comment_mentions` row (mention) or on its own (reply — no `comment_mentions` row for a plain reply), in the same transaction as the comment itself — a mention/reply and its notification always exist together or not at all; a reply that also `@mentions` a participant writes one notification, not two ("mention wins" — the trigger's own dedup, checked against notifications already written earlier in the same statement). A person's own notifications are private: nobody else, not even an owner, reads another member's `notifications` rows.

#### `decisions`, `decision_arguments`, `decision_links`, `assumptions`, `evidence`, `decision_option_ratings`
Decision record (ADR-013, extended by ADR-022 for prompt pack F0/F3 — `supabase/migrations/20260913110000_decisions.sql`). Column lists as in ADR-013, with these additions: `decisions.superseded_decision_id → decisions(id)`; `decisions.owner_id → auth.users(id)` not null (ADR-022 — F3's own "owner," distinct from `decided_by`); `decisions.needed_by date` nullable (ADR-022 — the target date to close by); `decisions.source_finding_key text` nullable (ADR-022 — which health-finding check a "Start a decision" click traced back to, a stable string key, never a frozen snapshot of computed finding text); `decisions.lens_map_url text` nullable (ADR-022 — "may cite a Lens map by URL; no shared schema," a bare column, no FK); `decision_links` primary key `(decision_id, linked_type, linked_id)` with `linked_type` a text check over `('element','relationship','branch','assumption','evidence')` (an option, F3's own creation-form output, is a `decision_links` row with `linked_type='branch'` pointing at an `explore`-intent branch, F0 — no separate `decision_options` table); `assumptions.linked_review_pending boolean default false` — set true on linked decisions when an assumption's status changes (the "re-review nudge"); `evidence.source_id → sources(id)` nullable, so a piece of evidence that is also a capture source is the same row in both roles. `decisions.status`/`decided_by`/`decided_at`/`branch_id`/`superseded_decision_id` are set only by `atlas.choose_decision_option` (F3, a later PR) — and, for cancelling, by `atlas.cancel_decision` (2026-10-03, `20261005010000_cancel_decision.sql`): `proposed → rejected` (shown as "Cancelled"), with `decisions.cancel_reason text` (never blank; only on a `rejected` row — `decisions_cancel_reason_consistent`; set only by that RPC), `decided_by`/`decided_at` recording who closed it and when, and every `branch`-linked option still in `draft` cancelled. Every other `decisions` column is a plain, RLS-gated update while `status='proposed'`, refused by `atlas.guard_decision_update` once it isn't.

**`decision_option_ratings`** (ADR-022 amendment — decision criteria ratings, `supabase/migrations/20260929010000_decision_option_ratings.sql`): a decision's own judgement facts about its options, distinct in kind from the versioned model — "changes stay pure and know nothing about ratings," the same architectural split this table's own sibling `decision_arguments` already sits on. One row per `(decision_id, branch_id, criterion)`, that triple as the primary key (rating the same cell again is an update, not a second row — the table's own upsert target): `decision_id → decisions(id)`, `branch_id → branches(id)` (the option, the same `decision_links`-with-`linked_type='branch'` option an option already is elsewhere in this schema — `decision_option_ratings` does not re-derive or duplicate that link, it only requires, at write time, that the row it targets is one), `criterion text` checked over the five fixed keys `DECISION_CRITERIA` names in code (`src/contracts/decisionCriteria.ts` — cost/effort/deliveryRisk/timing/vendorFit; no admin surface, no per-org configuration, the same "small fully-known taxonomy, stays a constant" reasoning `relationship_type_rules` already gives for its own shape), `level text` checked over the three neutral, criterion-agnostic keys `favourable`/`acceptable`/`unfavourable` (each criterion's own display label for a level — e.g. cost's `favourable` reads "Low", timing's reads "Before end date" — lives in code, never in this column), `note text` nullable with a `length(btrim(note)) <= 200` check ("the one-line notes are not a documents feature"), `rated_by → auth.users(id)`, `rated_at timestamptz`. Read-only once the decision is no longer `proposed`: `decision_option_ratings_insert`/`_update`'s own RLS predicates both require `decisions.status = 'proposed'` at write time — the same "the database is the real gate, no snapshot step" mechanism `decisions`/`decision_links` already use for read-only-after-a-status-change, not a new one — so once `atlas.choose_decision_option` flips a decision to `accepted`, every further write here is refused and "the ratings in place at the time of choosing" is simply whatever is already stored. Permission tier: owner/architect/contributor, mirroring `decision_links_insert` (adding a rating is "contributing content to an open decision," the same tier as adding an option, not the narrower `decisions_update` tier reserved for the decision's own core fields).

Indexes: `decisions (model_id, status)`, `decisions (branch_id)`, `decision_links (linked_type, linked_id)`, `assumptions (model_id, status)`, `decision_option_ratings (decision_id)`.

#### `projects`, `project_links` (F10, ADR-024)
Project record (`docs/ADR-024-projects.md`, `supabase/migrations/20261002020000_projects.sql`) — the container for a piece of architecture work. A workflow record on the same tier as `decisions`: never a delta, never folded into a head, never in a version, and nothing can `support`/`use`/`own`/`flow_to` it (ADR-001's `project-or-programme` exclusion stands). `projects`: `id`, `org_id`, `model_id`, `title text not null` (non-blank), `purpose text not null default ''`, `owner_id → auth.users(id)` not null (accountable for delivery, distinct from any decision's owner), `status text` checked over `('active','on_hold','closed','cancelled')` default `'active'`, `start_date date`, `target_date date` (the project's own, distinct from each change's `branches.target_date`), `source_finding_key text` (same stance as `decisions.source_finding_key`), `closed_by`/`closed_at`/`close_reason` (set together, only on the way to `closed`/`cancelled`; `projects_closed_consistent`, and `projects_cancel_has_reason`), `created_by`, `created_at`. `project_links`: primary key `(project_id, linked_type, linked_id)`, `linked_type` checked over `('element','evidence')` — `element` is the declared scope (checked by `atlas.check_project_link` against permanent `element_create` history in the project's model, like a comment anchor), `evidence` an `evidence` row in the same model.

New columns elsewhere: `decisions.project_id → projects(id)` nullable (part of that project's decision log; null is a portfolio-level decision — written at insert or through `atlas.set_decision_project` only, never a plain update); `branches.project_id → projects(id)` nullable with `branches_project_only_for_change` (`project_id is null or kind = 'change'`), plain-updatable (`grant update (project_id)`) under `atlas.guard_branch_project`; `decision_links.linked_type` gains `'project'` (a decision constraining a project it is not part of — never its own, `atlas.check_decision_link`); `anchor_type` gains `'project'` (`20261002010000_anchor_type_project.sql`, its own migration because a new enum value can't be used in the transaction that adds it).

Consistency rules, enforced in the database: **P1** an option follows its decision — a `decision_links` `'branch'` row is refused unless the branch's `project_id` equals the decision's, an option's own project can't be changed directly, and `atlas.set_decision_project(decision, project)` (decision's creator or owner/architect, decision `proposed`) moves the decision and every option still in `draft` in one transaction, refusing if a non-draft option is in a different project. **P2** `branches.project_id` changes only while the change is `draft`/`proposed`/`in_review`/`approved`. **P3** `atlas.split_branch` copies `project_id`. **P4** `atlas.set_project_status(project, status, reason)` — `active ⇄ on_hold` freely; `closed`/`cancelled` refused (`OPEN_ITEMS`, errcode 55000) while the project has an open change or a `proposed` decision; `cancelled` needs a reason; both terminal. A project accepts a new decision or change only while `active`/`on_hold` (`atlas.assert_project_accepts_members`), so a closed project stays closed with nothing open in it. No project is ever deleted outside `atlas.delete_model`.

RLS: select for every member; insert for owner/architect/contributor (`created_by = auth.uid()`, status `active`, no `closed_*`, model in the same org); update of `title`/`purpose`/`owner_id`/`start_date`/`target_date` only (column grant) by the project's creator or owner or an org owner/architect, while `active`/`on_hold` (`atlas.can_edit_project`); `project_links` insert/delete by the same people while open. Indexes: `projects (model_id, status)`, `project_links (linked_type, linked_id)`, `decisions (project_id)`, `branches (project_id)` (both partial, non-null).

### 3.9 Views

#### `views`
A saved query, not a drawing (ADR-011).

| Column | Type | Constraints |
|---|---|---|
| `model_id` | uuid | → `models(id)` |
| `name` | text | not null |
| `kind` | view_kind | not null |
| `scope_element_id` | uuid | nullable; required for `context`/`container`, must be null for `landscape`/`capability_map` |
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

#### `capability_map_value_stream_items` (F6, ADR-023)

A map's value streams and their stages — the content file's optional `valueStreams` section (`src/contracts/capabilityMapContent.ts`). Not rows of `capability_map_items`: that table's `level 1–3`/`parent_code` trigger and every reader of it assume capabilities.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key — a seeded stream/stage's `attributes.templateRef` points here, exactly as a capability's points at `capability_map_items.id` |
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `code` | text | not null; `unique (map_id, code)` — the stream/stage's stable reference (its `template_code` alias once seeded), independent of `item_order` |
| `parent_code` | text | nullable → `(map_id, code)`; null for a stream, a stream's code for a stage |
| `name` | text | not null |
| `description` | text | |
| `item_order` | int | not null — display order among siblings |

Trigger: a row whose `parent_code` is non-null must name a row whose own `parent_code` is null (depth two, the same rule C22 enforces on the seeded elements). Same immutability guard as `capability_map_items` once the map is published.

#### `capability_map_value_stream_enables` (F6, ADR-023)

| Column | Type | Constraints |
|---|---|---|
| `map_id` | uuid | → `capability_maps(id)` on delete cascade |
| `stage_code` | text | not null → `capability_map_value_stream_items (map_id, code)`; must be a stage (trigger) |
| `capability_code` | text | not null → `capability_map_items (map_id, code)` |

Primary key `(map_id, stage_code, capability_code)`. The content file names the capability **by name** (a content author's vocabulary); `scripts/loadCapabilityMaps.ts` resolves it to `code` and refuses the file on zero or ambiguous matches, so this table only ever holds resolved codes.

Seeding a model from a map (ADR-012) creates one `sources` row of kind `template` and one `template_seed` commit whose `element_create` deltas have `attributes.templateRef` set (plus `attributes.description`, copied from the map item's own description when it has one — Bug A2: this was silently dropped until Sprint U4-1, and `scripts/syncDescriptionsFromMap.ts`/its owner-action equivalent is the one-off fix for a model already seeded before then) and an `aliases` row of type `template_code` per element. `attributes.code` is deliberately **not** set at seed time (ADR-020, amended from the original "sets `attributes.code`/`attributes.templateRef`" wording this line carried) — it's an organisation's own optional reference now, not a copy of the template's code, which stays reachable via `templateRef` and the `template_code` alias alone. **F6 (ADR-023):** the same `template_seed` commit also carries one `element_create` per value stream and stage (`attributes.templateRef`/`order`, a `template_code` alias each, stages parented on their stream) and one `relationship_create` (`enables`) per resolved `capability_map_value_stream_enables` row — `atlas.seed_from_map` gains `p_relationships_head` for that, the parameter every other head-writing RPC already takes.

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

### 3.11 Saved reports, saved copies and dashboards

Workflow records on the same tier as `projects` and `decisions` (ADR-027, `supabase/migrations/20261106010000_saved_reports.sql`): never a delta, never folded into a head, never in a version. Deleting every row of all four tables loses no model information (ADR-011's litmus test for the definitions; see `report_snapshots` for the one table that is a record rather than a hint). Contract: `src/contracts/reportSpec.ts` (`ReportSpec`, `parseReportSpec`); evaluator: `src/engine/reportQuery.ts`; rows and queries: `src/db/types.ts`, `src/db/reports.ts`.

Two visibility levels everywhere: `private` (the creator) and `organisation` (every member). Only an org owner/architect can set `organisation` (`atlas.guard_saved_report`, `atlas.guard_dashboard`).

#### `saved_reports`
A stored question, not data. Mutable.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key (caller-minted) |
| `org_id`, `model_id` | uuid | → `organisations`, `models`; fixed after insert |
| `name` | text | not null, non-blank |
| `description` | text | not null, default `''` |
| `spec` | jsonb | not null; an object whose `specVersion` equals `spec_version` |
| `spec_version` | int | not null, ≥ 1 |
| `visibility` | text | `private` (default) \| `organisation` |
| `created_by` | uuid | → `auth.users(id)`; fixed after insert |
| `created_at`, `updated_at` | timestamptz | `updated_at` set by trigger |

RLS: select for a member when `organisation` or own; insert owner/architect/contributor with `created_by = auth.uid()`; update (column grant: `name, description, spec, spec_version, visibility`) and delete by the creator, or by an owner/architect for an `organisation` report. A private report is its creator's alone. A report cannot return to private while a tile of an organisation-visible dashboard shows it.

#### `report_snapshots`
A frozen result, kept as a record. **Insert-only**: no update grant, and `atlas.report_snapshot_immutable` refuses any update except the FK's own `on delete set null` clearing `report_id`.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `org_id`, `model_id` | uuid | → `organisations`, `models` |
| `report_id` | uuid | → `saved_reports(id)` **on delete set null** |
| `name`, `spec`, `spec_version` | text, jsonb, int | copy of the report's name and definition when the copy was taken |
| `branch_id` | uuid | → `branches(id)`; must be the model's `main` branch (`atlas.guard_report_snapshot`) |
| `commit_id` | uuid | → `commits(id)`; must be on that branch |
| `columns`, `rows`, `groups`, `unknown_fields` | jsonb | the stored `ReportResult`; `rows` has at most 5,000 entries |
| `row_count` | int | not null, ≥ `jsonb_array_length(rows)` |
| `truncated` | boolean | not null |
| `visibility` | text | `private` \| `organisation`; `organisation` only if the generator is an owner/architect or the report is itself `organisation` |
| `generated_by`, `generated_at` | uuid, timestamptz | |

RLS: select for a member when `organisation` or own; insert owner/architect/contributor with `generated_by = auth.uid()`; delete by the generator, or by an owner/architect for an `organisation` copy. Reading a copy reads only these columns, never the live model.

#### `dashboards`
| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `org_id`, `model_id` | uuid | fixed after insert |
| `name` | text | not null, non-blank |
| `visibility` | text | `private` (default) \| `organisation` |
| `created_by`, `created_at`, `updated_at` | | as `saved_reports` |

Same RLS as `saved_reports` (update column grant: `name, visibility`). A dashboard cannot become `organisation` while a tile shows a private report.

#### `dashboard_tiles`
| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `dashboard_id` | uuid | → `dashboards(id)` on delete cascade |
| `report_id` | uuid | → `saved_reports(id)` on delete cascade |
| `position` | int | not null, ≥ 0; unique per dashboard (deferrable, so a reorder can swap in one statement) |
| `kind` | text | `kpi` \| `bar` \| `stackedBar` \| `donut` \| `table` |
| `size` | text | `one` (default) \| `two` \| `full` |
| `row_limit` | int | nullable, 1 to 50 |

A tile is visible exactly when its dashboard is, and editable by whoever may edit the dashboard. The report must be in the dashboard's model, visible to the person adding it, and (on an `organisation` dashboard) itself `organisation`. `position` and `size` are display hints (rule 3). `atlas.delete_model` deletes all four tables' rows before the rest.

---

## 4. The delta format

The authoritative definition is `src/contracts/delta.ts`. Summary:

### 4.1 Kinds

| Kind | Asserts fact | Required fields beyond base |
|---|---|---|
| `element.create` | `(elementId, $exists)` plus one fact per key in `attributes`, plus `name`, plus `parentId` | `elementId`, `elementType`, `name`, `parentId`, `attributes` |
| `element.update` | `(elementId, attribute)` | `elementId`, `elementType`, `attribute`, `value`, `previousDeltaId` |
| `element.update_custom` (F1) | `(elementId, attribute)`, `attribute` an org-defined `attribute_definitions.key` | `elementId`, `elementType`, `attribute`, `value`, `previousDeltaId` |
| `element.retract` | withdraws `(elementId, $exists)` | `elementId`, `elementType`, `previousDeltaId` |
| `element.restore` | re-asserts `(elementId, $exists)` | `elementId`, `elementType`, `previousDeltaId` |
| `relationship.create` | `(relationshipId, $exists)` plus one per attribute; endpoints are part of the existence fact | `relationshipId`, `relationshipType`, `fromElementId`, `toElementId`, `attributes` |
| `relationship.update` | `(relationshipId, attribute)` | `relationshipId`, `relationshipType`, `attribute`, `value`, `previousDeltaId` |
| `relationship.update_custom` (F1) | `(relationshipId, attribute)`, `attribute` an org-defined `attribute_definitions.key` | `relationshipId`, `relationshipType`, `attribute`, `value`, `previousDeltaId` |
| `relationship.retract` | withdraws `$exists` | `relationshipId`, `relationshipType`, `previousDeltaId` |
| `relationship.restore` | re-asserts `$exists` | `relationshipId`, `relationshipType`, `previousDeltaId` |

Base fields on every delta: `id`, `sourceId`, `sourceRef?`, `effectiveDate?`, `confidence`.

**F1 note.** `element.update_custom`/`relationship.update_custom` are deliberately separate kinds, not `element.update`/`relationship.update` with a widened `attribute` type: `ElementUpdate<T>`'s own `attribute` is a distributive conditional type keyed by a *closed* literal union (every core attribute key for `T`), so a typo'd or removed core key is a compile error — widening it to accept an arbitrary org-defined string would lose that guarantee for every element update, core included. Keeping the two kinds apart also means a custom key that happens to be spelled `name`/`parentId` (element) or is otherwise mistaken for a promoted column is never special-cased the way the real `name`/`parentId` update path is (`src/engine/deltas.ts`'s `apply()`) — a custom key always writes straight into the `attributes` jsonb, never the row's own promoted columns.

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
- `preparation` (ADR-021 §2a amendment 1, C2b) — the first of up to two commits `atlas.refresh_branch` writes atomically on a change branch, immediately before the `merge` commit that follows it (`M.parent_commit_id = P.id`), sharing its `merge_resolution` source (C21, §5.2). Written only when a structural finding needs one; most refreshes have no `preparation` commit at all. Contains only the deltas ADR-021 §3.3's preparation table derives mechanically from the findings — never a reviewer's decision, which lives entirely in the following `merge` commit's own deltas. Never written directly by a client (`atlas.commit_deltas` accepts `preparation` on a `change` branch only when called from `refresh_branch` — the same restriction `genesis` has via `on_model_created`); the activity feed and `describeEnvelope` label it as a step of the refresh that follows, never as an independent edit.

### 5.2 Invariants

`COMMIT_INVARIANTS` in `delta.ts` is the list (C1–C22 as of ADR-023/F6's own C22; C1–C21 as of ADR-021/C2b's own C21 — this list was already stale at C1–C17 before S1 item 11a's C20, having missed C18/C19; corrected here rather than left to drift further). They are checked in this order, and the first failure rejects the whole commit:

1. Shape: C1, C2, C3, C14.
2. Intra-commit: C4.
3. Against history: C5 (id never used), C13 (parent is current head), C12 (source in model).
4. Against parent head: C6 (previousDeltaId matches `facts`), C7 (exists/not-exists preconditions).
5. Against resulting head: C8, C9, C10, C11, C15, C17 (Sprint U4-1: at most one primary `supports`/`owns` edge per anchor element), C18 (`via` references a live `integration_platform`, or — ADR-026 — a live interface on one: a container whose parent is such a system), C20 (an external actor's `owns` role is always `service`), C21 (a `preparation`-kind commit carries only ADR-021 §3.3's preparation deltas), C22 (a `value_stream`'s parent is a live parentless `value_stream`; an `enables` edge targets a stage).
6. Validation level for the branch kind: C16 → §6.3.

**C15 (amended, ADR-021 §6):** a merge commit's own deltas are exactly: one resolution per FIELD_CONFLICT key (as originally specified), plus — for a refresh resolving a blocking structural finding — the decision deltas ADR-021 §4 derives from the reviewer's choice (keep-retraction/keep-element cascade, duplicate-relationship survivor, cardinality primary/role pick), plus nothing else. Every blocking structural finding needs a choice before a refresh can be pushed (`unresolvedStructuralFindings`, extending the existing `unresolvedFieldConflictKeys` guard); a converged retraction (both sides retract the same element) is resolved implicitly by the builder and never needs one.

**C21 (new, ADR-021 §6 — numbered here rather than "C18," the id the ADR's own early draft used before finding it already taken by the unrelated `via`/integration-platform check; see ADR-021 §2a amendment 3):** a `preparation`-kind commit contains only the deltas ADR-021 §3.3's preparation table derives from the findings — restores of elements the branch retracted and main touched, retracts of the branch's own relationships to elements main retracted, demotions of the branch's primaries that main's primaries collide with — and no other commit kind may carry them. Checked by the engine before `atlas.refresh_branch` is called; the RPC itself checks the kind, the adjacency (`M.parent_commit_id = P.id`) and the shared `merge_resolution` source.

**C22 (new, ADR-023/F6):** two cross-entity checks `RELATIONSHIP_TYPE_RULES` can't express (§3.3), checked against the head as it stands when the delta is applied, at `create`/`update` and — matching C18 and C20's own convention — never re-run at `restore`: (a) an `element.create` of a `value_stream` with a non-null `parentId`, or an `element.update` of `parentId` on one, requires the parent to be a live `value_stream` whose own `parentId` is null (depth exactly two — a stage never has children); (b) a `relationship.create` of `enables` requires `toElementId` to be a live `value_stream` with a non-null `parentId` (a stage, never a stream). No database backstop, for C18's own reason: a cross-table dependency Postgres has no plain `CHECK` or index for, and engine-only enforcement is this taxonomy's accepted answer to that shape of rule.

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


### 5.6 Copying a model (ADR-030)

`atlas.copy_model` is the one operation that writes a commit into a model on behalf of a *different* model's content: owner-only (`has_role(org, 'owner')`, checked in the function), same organisation, one ordinary `manual` commit titled "Copied from <name>" whose deltas carry each copied fact's original provenance against re-keyed `sources` rows. It refuses if the source's main head moved after the client read it. History, changes, decisions, comments, private reports and shares are not copied. See `docs/ADR-030-copy-model.md`.

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
  if c.kind == 'merge' and c.parent in ancestry(c.mergedBranchHead):
    H = fold(c.mergedBranchHead)                           // C19: fast-forward — see amendment below
  else if c.kind == 'merge':
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

**Amended (C19, ADR-021 §2.1/§5 item 1):** `fold`'s first branch above — a merge commit whose first parent is already in the ancestry of its second parent folds to the second parent's own state, plus this commit's own deltas — is the final merge onto main, whose precondition `mergeBase(B) == main.head` (§7.1) guarantees the condition. This is not only an optimisation that happens to land on the same answer: replaying `exclusive(mergedBranchHead, parent)` in commit order (the second, ordinary-replay branch) can throw when a resolution recorded in a later commit was needed to make an earlier one applicable (ADR-021 §1.2's own failing case, left for C2b's structural-resolution work to actually produce); re-folding the second parent's own history through its own parent/merge structure sidesteps that ordering problem entirely, and matches what `mergeApprovedRequest` already materialises as main's new projection. A refresh commit (`parent` = the branch's own head, `mergedBranchHead` = main's head) essentially never satisfies the fast-forward condition — the branch's own commits since forking are not, in general, reachable from main — so it keeps folding by the ordinary replay branch; the one exception (a branch with no own commits since forking) gives the same answer either way.

`fact(d, value)` copies `d.id, d.sourceId, d.sourceRef, d.effectiveDate, d.confidence, commit.authorId, commit.createdAt`.

A tombstone `$exists` fact with `live = false` is kept in memory for C7 checks and dropped from the `facts` table on persist (the table holds live facts only; the retract delta is found via `deltas.previous_delta_id` chains).

### 6.3 Validation gate (on the folded head)

| Rule | Level | Check |
|---|---|---|
| V1 | schema | every `elements_head.attributes` and `relationships_head.attributes` validates against `type_schemas` for `(type, models.schema_version)`; required attributes present |
| V2 | structural | every `parent_id` references an element in the same head with the required type: capability→capability, container→system; capability/system/actor parents are null or (capability only) a capability. Every relationship endpoint references an element in the same head. |
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

1. **Property test P-2** (every CI run): for random commit DAGs, `head_hash(materialise(c)) == head_hash(fold(c))` where `fold` is the §6.2 reference implementation with no caching. **Amended (C19, ADR-021 §2.1/§5 item 1):** covers both of `fold`'s merge shapes — the fast-forward branch (a main-merge commit, `mergeBase(B) == main.head`) and the ordinary replay branch (a refresh commit) — not just whichever one a graph generator happened to produce before.
2. **Integrity job** (nightly, per model): for every retained commit `c`, recompute `fold(c)` from genesis and compare to `commits.head_hash` and to the persisted rows (row-by-row, not just hash). Any mismatch: raise an incident, mark `validation_results` for `c` as `fail` with rule `HASH`, and refuse merges on that model until repaired.
3. **On tag creation**: `fold(commit)` is recomputed from genesis before the tag row is inserted. A tag is the one moment the cost is always paid, so that anything a version is cited for was verified from first principles.

Order-independence (P-3) is a second obligation: for commits whose delta fact-key sets are disjoint, applying them in either order yields the same `head_hash`. This is what makes `topo`'s tie-break irrelevant for correctness and only relevant for determinism.

### 6.7 Reading a materialised head at scale

`elements_head`/`relationships_head`/`facts` are keyed `(commit_id, ...)` (§3.5) — every read of them is already scoped to one commit. A read that also needs "only these particular subjects" (an element's own relationships, a landscape's edges among its systems) must not add that second scoping by handing an arbitrary, caller-sized id list to postgrest-js's `.in()`: `.in()` is sent as a GET query parameter, so its URL grows with the list — Sprint C1-H item 1 found this concretely (`docs/AUDIT-2026-09-C1.md` §1.4): a 2,000-system landscape's edge query, `.in('from_element_id', systemIds).in('to_element_id', systemIds)`, produced a ~70KB+ URL that a proxy/server rejects outright (400/`ERR_FAILED`), not a slow query — the read never completed at all.

**Rule:** a `.in()` filter whose value list is caller-supplied and can grow with model size (element/subject/source/branch/commit ids — anything that isn't a small fixed enum like a status or type list) must stay at or under 50 values. `src/db/inFilterLimit.ts`'s `assertInFilterSize` enforces this at the point of call — a call site over the limit is a bug to fix, not a query to let run and hope stays small in practice. The fix is the same shape every time (`src/db/landscape.ts`'s `listLandscapeEdges`/`listSupportsEdgesForSystems`, rewritten this item): query the commit/model scope alone — no id-list filter at all — and narrow to the wanted subjects client-side, in memory, after the round trip. This trades a WHERE clause for a client-side `Set.has` filter.

**A second, distinct risk at the same read-at-scale boundary: `supabase/config.toml`'s `max_rows` (1000) silently truncates any unpaginated read past that many rows — no error, just fewer rows than actually exist.** This is not the same bug the `.in()` rule above guards against (that one fails loudly, with a 400/`ERR_FAILED`; this one doesn't fail at all) and fixing the `.in()` shape does not fix it — "the row count fetched is the same order of magnitude either way" (the previous paragraph's own reasoning for why the `.in()` rewrite is safe) is only true if that fetch itself returns every row, which `max_rows` doesn't guarantee once a commit's element/relationship/fact count exceeds 1000. Found concretely the same way as the `.in()` bug: `listSystemsForLandscape` (`src/db/landscape.ts`) returned exactly 1,000 of a 2,000-system fixture's systems, with no error, and the landscape rendered "1,000 systems" as if that were the whole model.

**Rule:** every read of `elements_head`/`relationships_head`/`facts`/`deltas`/`commits` that can return more than one row must go through `src/db/selectAll.ts`'s `selectAll`, never a bare `.select(...)`. `selectAll` loops `.range()` in `max_rows`-sized pages until a short page, and — because its query must be built with `.select(columns, { count: 'exact' })` — cross-checks the total rows collected against Postgres's own exact count, throwing rather than returning a partial result on a mismatch. `max_rows` stays at 1000: it is a safety cap on any accidentally-unbounded request, not a target application code should rely on staying under; the fix is to page past it deliberately, not to raise it. A query passed to `selectAll` must also carry a deterministic order over a column (or column combination) unique within its filtered scope — `.range()`-based pagination over an unordered or non-uniquely-ordered query can skip or duplicate rows across page boundaries — typically the table's own primary key (or the part of it not already pinned by an `.eq()`). `src/db/headTableReads.test.ts` enforces the "goes through `selectAll`" half of this rule directly against `src/db`'s own source, the same way `assertInFilterSize` enforces the `.in()` rule above; a single-row lookup by a unique key (`.maybeSingle()`/`.single()`) is exempt, since `max_rows` cannot truncate a result that's already at most one row.

### 6.8 Changing existing data (attribute renames, backfills): data changes are commits, never row rewrites

Prompt 7k item 2 (`owns.primary: boolean` → `owns.role`) is the first attribute-shape change to an already-shipped field this product has made, and it surfaced a rule worth stating explicitly rather than re-deriving the next time this happens: **an existing fact is changed by writing a real delta through a real commit (`atlas.commit_deltas`), never by a migration hand-editing `deltas`, `relationships_head`, or `elements_head` directly.**

Two independent reasons make a raw row edit the wrong tool here, not just a stylistic preference:

- **Replay would silently undo it.** `relationships_head`/`elements_head` are materialised projections, folded from `deltas` (§6.1–§6.2) — `deltas` is the source of truth, the projection is a cache of it. A migration that rewrites only the projection leaves the underlying `deltas` rows holding the *old* shape; the next `rebuildHead`/`foldFromGenesis` replay (§6.6's own integrity job, or any future repair run) re-derives the projection from those unchanged `deltas` rows and regenerates the old shape right back — the "fix" silently reverts the moment anyone re-materialises from genesis. Only rewriting `deltas` as well would close that gap, but:
- **`commits.head_hash` cannot be reconciled by SQL alone.** `head_hash` (§6.4) is computed once, at commit-creation time, from the *folded* head at that point, and is never recomputed afterward except for comparison (the integrity job reads it back for a mismatch check; nothing writes a corrected value to it). Rewriting a delta's stored value changes what a fresh fold of that history produces — the hash a future fold computes would then legitimately differ from the `head_hash` stored on every commit downstream of the changed delta, and there is no existing mechanism (SQL or otherwise) to recompute and rewrite `head_hash` for that whole downstream chain. A migration cannot fix this half at all without re-running the real TypeScript fold/hash pipeline, which a plain `.sql` migration file has no access to.

A real commit sidesteps both: it's a new `relationship.update`/`element.update` delta, applied through the same `apply()`/`commit_deltas` path any other edit takes, so the resulting head folds correctly from genesis forever after, and `head_hash` is computed fresh and correctly for the new commit exactly as it is for any other. The pattern (`src/db/backfillOwnsRole.ts`, `scripts/backfillOwnsRole.ts`): a small, idempotent, one-off script that reads the current state, builds the update deltas needed (one per changed fact key, correctly `previousDeltaId`-linked — an attribute that was never asserted before anchors on the subject's own `exists_delta_id`, the same fallback `RelationshipCreateDemotion`'s own doc comment already uses), and writes them as one real commit per model, signed in as a real member (never service-role — `atlas.commit_deltas` is `auth.uid()`-driven by design, ADR-015/ADR-007). It prints what it changed, and running it again on an already-migrated model is a safe no-op.

A schema migration may still add/drop a column, index, or constraint (as `20260911070000_owns_role.sql` does for the new cardinality backstop) — this rule is about *row content*, not schema shape. A field kept on its contract type as `@deprecated` (rather than removed outright) after such a rename, so a not-yet-migrated model's stored data still reads back sensibly, is the expected shape until every model has been backfilled.

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
| `owns.role` (any value) created on both sides for the same target and role, or `supports.role = 'primary'` created on both sides for the same anchor — created-vs-created or created-vs-promoted-existing, either shape (ADR-021 §5 item 2) | **structural: cardinality** (V3/C17 would fail) | yes |
| Both sides retract the same element (converged existence, ADR-021 §1.3.1) | **structural: converged-retract** | no — auto-resolved by the builder (ADR-021 §4.1) |
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

**Structural conflicts** (one card per retracted element, real actions per ADR-021 §4, C2b):
- the retract (which side, by whom, source) and every dependent change on the other side, with the computed cascade spelled out in the consequences text before the reviewer commits to a choice
- actions: *keep retraction* (a cascade retracting the dependants / re-parenting children to the retracted element's own parent) or *keep element* (restores it via `element.restore`, overlaid by whichever side's changes the replay carries — ADR-021 §4.1's Case A/B). Duplicate relationships: pick which id survives; the loser is retracted (§4.2). Cardinality: pick the primary/role owner; the loser is reassigned to the one other state (`supports`) or, for `owns`, per whatever `buildStructuralResolutions` decides for that open sub-question (§4.3) — retract the loser's edge outright, or prompt for a reassigned role. A converged retraction (both sides retracted the same element) never renders a card at all — the builder resolves it automatically.
- **Mechanically, every choice is carried out as "prepare, replay, decide" (ADR-021 §2, §3.3):** the reviewer's choice never patches the fold after the fact — it produces, via `atlas.refresh_branch`, an optional `preparation` commit (the minimal own deltas that make main's replay applicable at all — a restore where the branch retracted something main touched, a demotion where the branch's primary would otherwise collide) immediately followed by the `merge` commit that replays main and carries the reviewer's actual decision deltas. Both are one atomic write; `resolved_conflicts` rows reference deltas in either commit. §7.5 has the exact mechanics and why this two-commit split is necessary rather than optional.

**Identity warnings** (one card per pair): both elements side by side with the match score and the matching context; actions: *merge now* (runs `atlas.merge_elements` on the branch, survivor chosen by the reviewer) or *keep both* (dismiss; recorded in `classification` so it does not reappear). Never blocks approval. **`atlas.merge_elements` itself now exists (E7, §11)** — `src/db/elementMerges.ts`'s `mergeElements`; this card's own *merge now* button wiring it in, and the exact-match-only "identity" finding's own upgrade to fuzzy trigram matching (§8), are still open (§11).

**Approval** is enabled only when: no blocking class remains, `mergeBase(B) == main.head`, schema validation passes at the branch head, and the reviewer holds `architect` or `owner`. Approving sets `branches.status = 'approved'`; merging calls `atlas.merge_branch`, which re-checks all four conditions inside the transaction (they can go stale between the click and the commit), writes the `merge` commit on main, moves `branches.head_commit_id` for main, marks the request `merged` and the branch `merged`, and materialises the new main head. If main moved in between, the procedure returns without a commit and the request returns to `pending` (its branch to `proposed`) — see the implementation note below for why that's a `NULL` return, not a thrown `REFRESH_REQUIRED` error.

**Implementation note (Sprint C1 step 2, `supabase/migrations/20260906161000_merge_review_queue.sql`):** the whole request lifecycle — submit, request changes, approve, reject, merge — is five security-definer functions (`atlas.submit_merge_request`/`request_changes`/`approve_merge_request`/`reject_merge_request`/`merge_branch`), each moving `merge_requests.status` and `branches.status` together in one transaction, for the same reason `atlas.commit_deltas` replaced a plain RLS-gated insert for `commits` (S-17): two separate client writes could partially fail and leave the two disagreeing about whether a branch is under review. `atlas.merge_branch`'s `REFRESH_REQUIRED` outcome is a `NULL` return, deliberately not a raised exception — an exception would roll back the same transaction's reset of the request to `pending` and the branch to `proposed`, undoing the very recovery it's meant to leave in place. It re-derives `mergeBase(B) == main.head` via `atlas.branch_reaches_commit(branch_id, commit_id)` (is `commit_id` in the branch head's own ancestry — the same DAG `parent_commit_id`/`merged_branch_head_commit_id` walk as `src/engine/head.ts`'s `ancestry`, expressed as a membership test) rather than trusting a client-supplied claim; schema validation at the branch head is trusted from the engine exactly as every other commit path already trusts it, per §6.5's implementation note.

**Implementation note (Sprint C1 step 7, `src/db/mergeRequests.ts`, `src/engine/mergeResolution.ts`):** the review queue UI and its "resolve, refresh, resubmit" loop needed one function step 2 didn't have — `atlas.resubmit_merge_request` (`supabase/migrations/20260906162000_resubmit_merge_request.sql`) moves an already-open `changes_requested` request back to `pending` with a refreshed cached classification, since `submit_merge_request` can only ever *insert* a first row and the partial unique index on open `branch_id`s would reject a second one. `sources_insert`'s RLS (`20260906162100_merge_resolution_source.sql`) also needed extending to allow the `merge_resolution` kind the wire contract and `deltas.source_id` FK had already anticipated but nothing wrote until this step. Field-conflict resolution (the three-column card's "keep this change / keep main / enter a value") is a one-click action, built and unit-tested (`src/engine/mergeResolution.test.ts`) exactly per this section's wording, including C15 below (`unresolvedFieldConflictKeys` refuses a refresh with any FIELD_CONFLICT key left unresolved, rather than letting main's value silently win). The structural-conflict actions (keep retraction / keep element and their dependant cascade, duplicate-relationship survivor pick, cardinality primary pick) and identity's "merge now" (`atlas.merge_elements`, itself deferred past this sprint — §11) are not built this step: the dependency-closure cascade those need is a substantial, separable unit of work. The review UI gives a real path for every conflict class today regardless — reopen the branch (`request_changes`) and fix it with the ordinary branch editor (Sprint C1 steps 3-4), then push a refresh and resubmit — and names this explicitly on structural-conflict cards rather than omitting their actions silently. Partial merge (ADR-006 amendment's split-into-a-new-branch) is likewise not built this step; `atlas.merge_branch` always merges the branch's entire head. **Superseded by C2b (ADR-021, issue #76).** §7.4's "Structural conflicts" bullet above and §7.5 below describe the real actions and the "prepare, replay, decide" mechanism that replaces "reopen and fix by hand" as the only path — implemented: `src/engine/structuralFindingGroups.ts` groups the findings into one card per retracted element (or duplicate/cardinality pair), `src/ui/reviews/ConflictCards.tsx`'s `RetractionConflictCard`/`PairConflictCard` render the real actions, `useBranchRebase.ts`/`useReviewRequest.ts` stage the choices, and `pushRefresh` (`src/db/mergeRequests.ts`) builds and commits the resolution via `atlas.refresh_branch`. This note stays as the historical record of why it wasn't built in Sprint C1.

**Implementation note (Sprint C1 step 8, `src/ui/reviews/BranchRebasePanel.tsx`, `useBranchRebase.ts`):** the conflict cards moved out of `ReviewRequestView.tsx` into `src/ui/reviews/ConflictCards.tsx` so a draft change's own page (`src/ui/changes/ChangeView.tsx`) can render the identical findings, with the identical one-click field-conflict resolution, *before* a merge request exists at all — "rebase branch on new main head with conflict surfacing" doesn't have to wait for review to start. It calls the same `pushRefresh` (and the same C15 guard) as a review request's refresh, just without the merge_requests bookkeeping there's nothing yet to update; shown only while no merge request is open — once one exists, refreshing goes back through the review request's own page, since that's the one place also resubmitting the cached classification. This step also fixed a real bug the request-scoped refresh had: it passed `request.requested_by` as the merge-resolution source's `created_by`, which `sources_insert`'s RLS (`created_by = auth.uid()`) would reject the moment someone other than the original requester pushed the refresh — both refresh paths now use the actual signed-in user.

### 7.5 Refresh

Refresh is "prepare, replay, decide" (ADR-021 §2 item 2, §3.3, C2b): up to two commits on the branch, written atomically by one RPC.

```
atlas.refresh_branch(
  p_branch_id, p_expected_head_commit_id,   -- C13: O, the branch's own head
  p_main_head_commit_id,                    -- T; must be on main
  p_prep_commit,                            -- {id, title, deltas[]} or null
  p_merge_commit,                           -- {id, title, deltas[]}
  p_resolved_conflicts                      -- rows referencing deltas in either commit
) returns jsonb   -- {status: 'ok', prepCommitId, mergeCommitId} | {status: 'stale_head'} | {status: 'invalid', reason}
```

`P` (kind `preparation`, §3.1/§5.1) is written first, only when a structural finding needs it — the minimal own deltas that make every delta of `X` (main's exclusive commits) applicable to `O`: `element.restore` where the branch retracted something main touched, `relationship.retract` on the branch's own dangling relationships where main retracted their other endpoint, or a demotion where the branch's own primary would otherwise collide with main's replay (ADR-021 §3.3's preparation table has the exact mapping from finding to delta). `P` is mechanical, derived from the findings alone — it is never where the reviewer's choice lives. `M` (kind `merge`, `parent = P` or `O` if `P` is empty, `mergedBranchHead = T`) then replays `X` unconditionally exactly as `fold` always has (§6.2), followed by its own deltas: the reviewer's actual decision (retract again, re-parent, demote, retract the losing duplicate — ADR-021 §4) plus every field-conflict resolution, as today. C15 (amended, §5.2) is checked: `M`'s own deltas are exactly one resolution per FIELD_CONFLICT key plus the decision deltas ADR-021 §4 derives for every blocking structural finding, nothing else — `unresolvedStructuralFindings` extends the existing `unresolvedFieldConflictKeys` guard so no blocking finding can be left without a choice. `resolved_conflicts` rows may reference a delta in `P` or `M`, one shared `merge_resolution` source for both. After refresh, `mergeBase(B) == main.head` by construction.

Why two commits rather than one: `fold`'s replay of `X` happens *before* a merge commit's own deltas (§6.2) — a resolution delta can never protect an earlier delta of `X` from throwing during the same fold. Recording the fix-up as a preceding, ordinary commit `P` (rather than teaching `fold` to consult a resolution mid-replay, or skip/discard a delta) needs no change to `apply`'s C8/C9/C17 checks, no new input to `head == fold(deltas)` (§6.6), and preserves rule 5/S-10/P-5 exactly: every existence change is a real `restore`/`retract` delta with real provenance, nothing is silently voided. See ADR-021 §3 for the two designs considered and rejected (resolution consulted during the fold; a two-phase refresh with no preceding commit) and why they were rejected.

**Implementation note (Sprint C1 step 2; superseded by C2b's `atlas.refresh_branch`, ADR-021 §5 item 5):** a refresh was originally (and still is, for the common case where `P` is empty) an ordinary commit through the same `src/db/commits.ts`/`atlas.commit_deltas` path every other commit takes — `commit_deltas` accepts `kind = 'merge'` on a `change` branch (previously restricted to `manual` only, Sprint H1 item 3). `atlas.refresh_branch` wraps this: it calls `atlas.commit_deltas` twice in one transaction (kinds `preparation` then `merge`), verifying kind, the adjacency `M.parent_commit_id = P.id`, and the shared source (C21, §5.2) — `commit_deltas` itself is unchanged, and `20260906170000_merge_refresh_base_commit_id.sql`'s "move `base_commit_id` on a change-branch merge" applies to `M` exactly as before; `P` never moves it. `src/db/mergeRequests.ts`'s `pushRefresh` is a wrapper that builds both envelopes with the engine and calls this RPC. `atlas.guard_branch_head_advance`'s existing "only while `status = 'draft'`" check (S-18) is what actually gates this — a branch under review (`proposed`/`approved`) must first go through `atlas.request_changes` (§7.4's implementation note) to reopen it before a refresh commit is accepted, matching S-18's rule rather than adding a second one.

---

## 8. Matching (capture pipeline)

**Deferred to Q1, alongside `atlas.merge_elements` — see §11.** Nothing below is implemented: the capture pipeline this matching feeds (ADR-004) doesn't exist, so nothing yet produces a candidate for it to match. The GIN trigram index level 3 depends on is already migrated (`elements_head_name_trgm_idx`, §3.5).

Order, first hit wins:

1. **Exact id** — the source carries an Atlas element id (a round-tripped export). Match if the id exists in `elements_head` at main's head or in `aliases` as `merged_id` (resolve to the survivor).
2. **Alias** — normalised token (`lower`, collapse whitespace, strip punctuation) equals `lower(alias_value)` for the model. `aliases` uniqueness guarantees one hit.
3. **Name + type + context** — trigram similarity of normalised name ≥ 0.6 against `elements_head.name` where `element_type` matches **and** the structural context matches: for a container the proposed parent resolves to the same parent; for a capability the proposed parent code/name resolves to the same parent; for systems and actors the context is the type alone. Multiple hits above threshold → propose the best but flag `ambiguous` in `capture_jobs.stats` and in the delta's `sourceRef`.
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
-- `or atlas.org_shares_a_model_with_me(id)`: Sprint F7 item 7
-- (`20260916040000_shared_model_access_fixes.sql`) — a member of an org a
-- model has been shared into needs to resolve the *owning* organisation's
-- name (OrgHome's "Shared with us" section, `listModelsSharedWithOrg`'s own
-- second query); without this clause that read silently returns nothing
-- and the shared model drops out of the list entirely.
create policy organisations_select on organisations
  for select to authenticated
  using (atlas.is_member(id) or created_by = auth.uid() or atlas.org_shares_a_model_with_me(id));

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

-- The `or atlas.model_shared_with_me(id)` clause below is migrated in
-- Sprint F7 item 4 (`supabase/migrations/20260916020000_model_shares.sql`),
-- which also adds `model_shares` (§3.6) and `atlas.model_shared_with_me`
-- itself. (This is unrelated to ADR-014/ADR-017's identity/tenancy
-- question, which is about whether Atlas shares its *identity tables* with
-- a different product entirely — `model_shares.shared_with_org_id` only
-- ever references another organisation inside this same product.)
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

-- Same migration as models_select above: the `or atlas.commit_shared_with_me(id)`
-- clause and `atlas.commit_shared_with_me` itself both land in Sprint F7
-- item 4 (`supabase/migrations/20260916020000_model_shares.sql`).
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
- **`atlas.thread_counts(model_id, anchor_ids[])`**: a POST RPC (§6.7 — sidesteps the GET `.in()` URL-length hazard entirely, the reason it exists as an RPC rather than a client-side `.in()` read), `security invoker` so a caller's own `comments_select` RLS applies exactly as it would to any other read. Replaces the M1a-era `atlas.unresolved_comment_counts` (M1 close-out item 1, `20260911010000_thread_counts.sql`): returns `(anchor_id, open_count, total_count)` via conditional aggregation (`count(*) filter (where status = 'open')` alongside a plain `count(*)`) rather than filtering to `status = 'open'` before grouping, so an anchor with every thread resolved (`open_count = 0`, `total_count > 0`) is distinguishable from one with no comments at all (still simply absent from the result either way) — the exact gap §11's own "hollow marker" row below used to name as unscheduled.

Comments never block a merge (ADR-006, UI-principles §7.3): `atlas.merge_branch`/`atlas.approve_merge_request` never reference `comments` at all, so an open, unresolved thread on a branch being merged has no effect on it whatsoever — confirmed by `src/db/comments.integration.test.ts`'s own merge-survival test, which posts an unresolved comment and merges anyway in the same test.

### 9.5 Pattern for every other table

Every remaining table uses one of three templates, chosen per table:

| Template | Select | Insert/Update | Tables |
|---|---|---|---|
| **Member-scoped** | `is_member(org_id)` (+ viewer restriction where the row can reveal draft content) | `has_role(org_id, 'owner','architect')` or contributor+ per table | `branches` (Sprint F7 item 7 exception: `atlas.get_shared_main_branch`, a narrow RPC — not a `branches_select` clause — returns the real main-branch row to a shared-with viewer holding an unpinned share; `branches_select`'s own RLS is otherwise unchanged, so a change branch, `capture_draft`, and everything else on this table stay exactly as invisible to a non-member as before), `tags`, `sources`, `aliases`, `views`, `view_annotations` (all five: insert-only, no update/delete policy or grant — Sprint H1 note, docs/AUDIT-2026-09-U2.md §2.E.3 item 19: this table originally called the carve-out out for `tags` alone, but the migrations apply it identically to `sources`/`aliases`/`views`/`view_annotations` too; only `view_layouts`, below, genuinely has an update policy, since a position hint is meant to change), `view_layouts` (update allowed — position hints are mutable), `merge_requests`, `element_merges` (E7 — select only, no insert/update/delete grant to `authenticated` at all: `atlas.record_element_merge` is the one writer, the same "function-only" shape `merge_requests` already uses below), `llm_proxy_requests` (E4, ADR-014 — select only, no insert/update/delete grant to `authenticated` at all: the `llm-proxy` edge function is the one writer, via the service-role key rather than a security-definer procedure — the same function-only shape, a different kind of function), `capture_jobs`, `decisions*`, `assumptions`, `evidence`, `validation_results` |
| **Commit-scoped** | visible iff `commits_select` would pass for `commit_id` | service role only | `elements_head`, `relationships_head`, `facts`, `deltas` |
| **Product content** | `to authenticated using (true)` | service role only | `type_schemas`, `relationship_type_rules`, `capability_maps`, `capability_map_items`, `capability_map_sources` |
| **Service-role only (no client access at all)** | none — RLS enabled, zero policies, no grant to `authenticated`/`anon` | service role only | `platform_config` (E4 follow-up — a row may hold a live secret, e.g. `key = 'llm'`'s optional `apiKey`; unlike "Product content" above, not even select is safe to expose) |
| **Self-row-only** | `user_id = auth.uid()` only — a caller can never see another row | no insert/update/delete grant to `authenticated` at all | `platform_admins` (Platform administrator amendment — Atlas's first cross-org role; granting/revoking is service-role/SQL only, `docs/PLATFORM-ADMIN.md`) |

`element_merges` and `resolved_conflicts`: member-scoped select, insert via procedure only. `llm_proxy_requests` (E4): the same shape, but its one writer is the `llm-proxy` edge function's own service-role client, not a `security definer` procedure — there is no client-callable insert path of either kind. `platform_config` goes one step further (no select either) — see the template row above. `atlas.get_platform_llm_config`/`atlas.set_platform_llm_config` (both `security definer`, both re-deriving `atlas.is_platform_admin()` themselves) are `platform_config`'s own only other client-reachable path, alongside the `llm-proxy` edge function's service-role client — `platform_config` itself still has no RLS policy of its own.

**`merge_requests`' insert/update is function-only, not a plain `has_role`/contributor+ policy (Sprint C1 amendment):** submitting a request has to move `branches.status` to `proposed` in the same transaction, and approving/rejecting/merging both a request and its branch's status together — two separate RLS-gated client writes could partially fail and leave the two disagreeing about whether a branch is under review. `atlas.submit_merge_request`/`request_changes`/`approve_merge_request`/`reject_merge_request`/`merge_branch` (§7.4, §7.5) are the only writers, each still deriving its own role check from `auth.uid()` rather than trusting a client-supplied one — the same reasoning, and the same precedent, as `atlas.commit_deltas` superseding a plain RLS-gated insert for `commits` (S-17). `merge_requests` therefore has a select policy only; no insert/update policy or grant exists for `authenticated`.

**`tags`' select policy gains its cross-org, tag-pinned clause in Sprint F7 item 4** (`supabase/migrations/20260916020000_model_shares.sql`), matching P-24's own wording exactly: only a *specifically shared* tag becomes visible to a shared-with org, never every tag on a model with any share — an unpinned (main-only) share grants no tag visibility at all. Before this migration the policy was exactly `using (atlas.is_member(org_id))` (Sprint H1 note — docs/AUDIT-2026-09-U2.md §2.E.3 item 5); P-24 is now a passing test (`src/db/modelShares.integration.test.ts`), not a recorded intention.

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
| RT-6 | `atlas.merge_elements(a, b)` then resolve `a` and `b` through `aliases` → same survivor; `deltas` and `relationships_head` rows that referenced `b` before the merge are byte-identical after it (history untouched); the survivor carries every relationship `b` had, deduplicated per S-6. **Implemented, E7:** the dedup/no-history-rewrite half is `src/engine/mergeElements.property.test.ts`'s own property (P-33's neighbour, same file); the `aliases` resolution half is `src/db/elementMerges.integration.test.ts`, against real Supabase, not executed in this sandbox. |
| RT-7 | For an arbitrary `views` row: node and edge set returned by the view query is identical before and after deleting all `view_layouts` and `view_annotations` rows for it. |
| RT-8 | Comment anchored to an element on a change branch → merge the branch → the same comment is still listed on the element, unchanged, and becomes visible to a viewer who couldn't see it pre-merge (Sprint M1a amendment: anchored to the element's own id, never a delta or commit id — `src/db/comments.integration.test.ts`'s "survives merge" test). |
| RT-9 | Arbitrary `UserPreferences` → `user_preferences` row → `UserPreferences` is deep-equal; a user reads only their own row and cannot read, write or delete another user's (P-22 style matrix, user-scoped). |
| RT-10 | Comment anchored to an element on a change branch → refresh (pull main forward into the branch) → the same comment, unchanged, is still listed on the element (Sprint M1a, `src/db/comments.integration.test.ts`). |
| RT-11 | Comment anchored to an element → retract the element → the comment is still readable (rule 5) and flagged as anchored to a retracted subject; posting a *new* comment on an already-retracted element still succeeds (Sprint M1a). |
| RT-12 | A comment body containing `@handle` → one `comment_mentions` row and one `notifications` row per resolved fellow-org member, none for a handle mentioning the comment's own author, none for a handle with no matching profile in the org (Sprint M1a). |
| RT-13 | A reply to a thread → one `notifications` row (`kind = 'reply'`) per prior participant (root author plus anyone else who already replied), none for the replying author themselves; a reply that also `@mentions` a prior participant → exactly one notification for them (`kind = 'mention'`, not two) — "mention wins" (Sprint M1b, `src/db/comments.integration.test.ts`'s "a reply notifies the thread's other participants" test). |
| RT-14 (ADR-023/F6) | RT-1/RT-2 with the generators widened to `value_stream` elements (stream and stage) and `enables` relationships: arbitrary `Delta` → JSON → `Delta` and `Delta` → `deltas` row → `Delta` deep-equal; an envelope creating a stream, a stage under it and an `enables` edge onto the stage commits through `atlas.commit_deltas` and reads back equal; the resulting `elements_head` row carries `element_type = 'value_stream'` and `relationships_head` `relationship_type = 'enables'` (the two widened enums). |
| RT-15 (ADR-023/F6) | Arbitrary `valueStreams` content section → `capability_map_value_stream_items`/`capability_map_value_stream_enables` rows (via the loader's resolution of capability names to codes) → the same section, deep-equal modulo name→code resolution; a stage under a stage, an `enables` onto a stream, and an `enables` naming zero or two capabilities are each refused; the immutability guard rejects any write once the map is published. |

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
| P-30 (ADR-021 §2.1/§5 item 1 — implemented, `src/engine/head.property.test.ts`) | Fast-forward rule: for any branch with `mergeBase(B) == main.head`, `headHash(fold(mainMergeCommit)) == headHash(fold(B.head))`; for any refresh commit with no structural findings, the new `fold` equals the old replay bit for bit. Missing its own §10 row until now — added retroactively; the test itself has existed since E1 landed. |

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
| P-13 | Swapping ours and theirs swaps OURS↔THEIRS and leaves the set of FIELD_CONFLICT, structural and identity keys unchanged. **Extended (ADR-021 §7, C2b):** also covers cardinality (both `supports`/`owns` shapes) and converged-retract findings — swapping ours/theirs swaps the direction of every structural finding and leaves the set of finding subjects unchanged. |
| P-14 | For an arbitrary branch and main with generated divergence: the set of FIELD_CONFLICT keys equals the set of keys changed on both sides to non-equal values; CONVERGED keys are exactly those changed on both sides to deep-equal values. |
| P-15 | For every blocking class there is a generator; the resulting union head fails at least one of V2/V3/V6 when the class is structural, and never fails them when the class is field-only. |
| P-16 | Refresh with resolutions covering exactly the FIELD_CONFLICT set passes C15; any missing or extra key is rejected; after refresh `mergeBase(B) == main.head`. |
| P-17 | `atlas.merge_branch` on a branch with `mergeBase(B) == main.head` and no blocking classes produces a merge commit with zero deltas whose head equals `ours`; on a branch where main has since advanced it fails with `REFRESH_REQUIRED` and changes nothing. |
| P-18 | Identity warnings never prevent approval or merge; dismissing one persists in `classification` and it is not raised again for the same pair. |
| P-29 (ADR-021 §7, C2b) | For generated `(base, ours, theirs)` triples covering every structural class (both directions), converged retractions, both cardinality types and both cardinality shapes, and every legal choice: `buildStructuralResolutions` yields `P`, `M` such that `fold(O) ⊕ P ⊕ replay(X) ⊕ M` never throws; the result passes V2, V6 and C17; it equals a directly constructed oracle head for that choice (element present/absent, relationships present/absent, primaries as chosen, children re-parented); every `resolved_conflicts` row references delta ids that exist in `X`, `O`'s ancestry, `P` or `M`; and C21 holds for `P`. |
| P-31 (ADR-021 §7, C2b) | Determinism (rule 6): two runs of `buildStructuralResolutions` over the same inputs with the same id minter produce identical `P`, `M`, and `resolved_conflicts` rows. |
| P-32 (ADR-021 §7, C2b) | Split after a resolved refresh: for any accepted subset, `buildSplitDeltas` folds over the merge base and passes C8/C9 — the existing split-closure property (§10, RT/P rows above it), with resolved refreshes now included in the generators, exercising the dependency-ordered replay ADR-021 §5 item 4 adds. |
| P-33 (ADR-019, E7) | Merge then undo is the identity: for a wide range of relationship/cardinality-collision/self-loop/child combinations, `buildMergeElementsDeltas` then `buildUndoMergeElementsDeltas` (`src/engine/mergeElements.ts`) restores a head identical to the one before the merge — element and relationship existence, attributes, and parenting, compared independently of the specific delta ids involved (minted fresh on every write, by this schema's own design, never reused). Also asserts the merge itself never leaves a duplicate relationship (V6) or a cardinality violation (`supports.role='primary'` per `fromElementId`; one `owns` edge per `(toElementId, role)`) live — checked independently of whatever `apply()` itself does or doesn't (cardinality always has, via C17; V6 now also does inline, Sprint U4-1 findings item 5 — this assertion stays as the oracle-independent check regardless). |

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

### 10.8 Properties — rollups

| Id | Property |
|---|---|
| P-34 (ADR-023/F6) | Value-stream rollup: for an arbitrary head with streams, stages, capabilities at any level, `supports` edges with arbitrary supporter lifecycle states and planned replacements, and arbitrary `enables` edges — a stage's tone equals the worst (`warn > neutral > info > ok`) of its enabling capabilities' own `CapabilityTileData.tone` as `buildCapabilityTiles` computes them, or `neutral` when nothing enables it; a stream's tone equals the worst of its stages'; a stage's/stream's `fitForPurpose` equals the worst across the same set and is never an input to the tone; an inactive stream is computed identically to an active one. |

A UI ticket may not be opened until RT-1…RT-9 and P-1…P-28 exist and pass locally (`pnpm test` — CLAUDE.md's "Verification (all local)": there is no test CI to pass in).

---

## 11. Deferred

Sprint H1 item 12 (docs/AUDIT-2026-09-U2.md's own deferred-items review, §7.2): every item this spec itself defers, in one place, rather than scattered across the sections that name them. Named explicitly so none is mistaken for settled, the same reasoning docs/ADR-000-foundations.md's own "Deferred to follow-up ADRs" section states for the ADR-level list.

| Item | What's deferred | Target | Why |
|---|---|---|---|
| ~~Member directory page and invite-by-email flow~~ | **Closed, Sprint 7j items 2 and 4.** Sprint M1a's `atlas.profiles` (§3.2) gave every member a handle/display name and the RLS to read a fellow member's; Sprint M1b built the @mention **autocomplete** this row used to also defer (`src/ui/comments/mentionAutocomplete.ts`, `src/db/profiles.ts`'s `listOrgMemberProfiles`). **Member directory (item 2):** `src/ui/routes/OrganisationSettingsPage.tsx`/`src/ui/orgs/OrganisationSettingsView.tsx` (`/o/:org/settings`) lists every member with profile, role and joined date, and lets an owner change a role or remove a member — `src/db/organisations.ts`'s `listMembers`/`changeMemberRole`/`removeMember`, the narrowed `members`/`organisations` grants in `20260911050000_organisation_settings.sql`. `atlas.guard_last_owner` (pre-existing, §3.2) still refuses any demotion/removal that would leave the org with zero owners; that sprint item only surfaces that refusal in the UI, it adds no new server-side rule. **Invite by email (item 4):** a new `invites` table (`20260911060000_invites.sql`) an owner writes to from the same settings page (`src/db/invites.ts`); no email is ever sent (this product has no email-sending mechanism anywhere), an invite is consumed automatically instead — by a real `after insert on auth.users` trigger (the first trigger in this schema on `auth.users` itself) for a fresh signup, and by a `security definer` RPC (`atlas.consume_my_invites`) `AuthProvider.tsx` calls on every sign-in for an email that already had an account before the invite existed, which the signup trigger alone can't see. Both closed pieces are integration-tested against real RLS/RPC/trigger behaviour (`src/db/organisationSettings.integration.test.ts`, `src/db/invites.integration.test.ts`) and covered end-to-end (`e2e/org-settings-members.spec.ts`, `e2e/org-settings-invite.spec.ts`), though — same sandbox limitation named throughout this sprint's other PRs — neither suite was executed in this environment. | — | — |
| ~~Notification tray deep link: `relationship`/`version`/`decision` anchors~~ | **`decision` closed, prompt pack F3 PR4** — `App.tsx`'s route table now has a real `/decisions/{id}` page, so a `decision`-anchored `mention`/`reply` notification deep-links to it with the decision's own title as the subject name (`src/ui/comments/useNotificationTray.ts`). `relationship`/`version` remain undeferred — those two still have no page to link to, so those anchor kinds still render (author, body, age) without a subject name or a link. | **Unscheduled** (for the remaining two) | Not a shortcut — the pages `relationship`/`version` would link to don't exist yet at all, for reasons unrelated to comments; a real link needs a real destination page first, and neither has one scheduled today. |
| ~~"Start a decision" from a health finding, "why is this here" reverse lookup, ADR markdown export~~ | **Closed, prompt pack F3 PR6** (`docs/ADR-022-decisions-schema.md`'s own "Closed by PR6" paragraph has the full detail). "Start a decision" reached `ArchitectHome.tsx`'s `critical-support-end` Assurance check and `DirectorHome.tsx`'s weak-capability tile — F3's two named golden paths — via a pre-filled `/decisions` link (`src/ui/decisions/decisionPrefill.ts`). **Widened, architect-door layout prompt (per-item-actions follow-up):** two more decision-shaped findings, `critical-exposed` and the newly-added `capability-no-supporters` (`findCapabilitiesWithNoSupporters`, `src/db/healthFindings.ts`); a single-item decision-shaped finding gets a direct "Start a decision" on its own door card, a multi-item one instead opens the finding's own browse-table filter, where each row now carries its own pre-filled "Start a decision" (`ElementBrowseTable.tsx`'s `decisionRowAction`, wired per-filter in `ElementsPage.tsx`). "Why is this here" — `ElementPage.tsx`'s "Decisions" section (`src/db/decisions.ts`'s `listDecisionsLinkingElements`, `src/ui/components/ElementDecisionsSection/`), replacing the hardcoded `<EmptyState>` Prompt 7h bug B6 left there. ADR export — `src/ui/decisions/exportDecisionAsAdr.ts`, copied to the clipboard. | — | — |
| "Start a decision" on the capability map's own L2/L3 tiles | `CapabilityMapView.tsx`'s shared `CapabilityTile.tsx` (used by `CapabilityMapPage.tsx`) has no `role` prop today and its colour-by/reorder/expand state is already tightly coupled — PR6 deliberately narrowed "Start a decision" to the two named golden-path entry points (`ArchitectHome.tsx`'s health finding, `DirectorHome.tsx`'s weak-capability tile), leaving this third possible entry point unbuilt rather than widening the PR to thread a new prop through a large, sensitive shared component for a case neither golden path exercises. | **Unscheduled** | A deliberate PR6 scope call, named here rather than left silent (CLAUDE.md rule 7) — see `docs/ADR-022-decisions-schema.md`'s own "Closed by PR6" paragraph for the full reasoning. |
| Programmes (a project containing projects) | ADR-024: one level of project only | **Unscheduled** | One level is enough until a real team asks. |
| Project budget, phases/gates, dependencies between projects | ADR-024's own deferred list | **Unscheduled** | A budget would be banded like `annualRunCost`, never a figure; gates and dependencies wait for evidence they're needed. |
| Field-level history for project fields | ADR-024 accepted risk: `title`/`purpose`/dates are overwritten in place while open | **Unscheduled** | Status transitions keep who and when; a full audit trail of a project's own fields would need a history table. |
| Project pack export | One document of a project's scope, decision log, target state and evidence | **F13** (exports) | Depends on F10's project page. |
| `assumptions`/`evidence` authoring UI | Both tables (ADR-013, extended by ADR-022) ship schema-complete with select/insert RLS — `decision_links` needs both as legal link targets — but no form anywhere creates or edits a row in either; F3's own two named golden paths never author one | **Unscheduled** | Not named in any PR of the F0+F3 sprint's own plan — recorded here so a later request to add "cite evidence" or "record an assumption" UI is picking up a real, already-flagged gap rather than rediscovering that the tables have no authoring surface. |
| `type_schemas` (§3.3, ADR-001/ADR-015) | The full TypeScript-type-to-JSON-Schema generator plus checked-in seed and validator (RT-5) | Sprint K1 | Real schema-validation infrastructure the element page never needed; Sprint K1's capture edge function is the first consumer outside the TypeScript runtime that will actually need it. Already deferred inline at §3.3; listed here too for one-place discoverability. |
| ~~Delta-apply in SQL (§5.3's implementation note, ADR-015)~~ | **Closed, E3** (`supabase/migrations/20260913130000_delta_apply_in_sql.sql`). `atlas.apply_deltas_to_main_projection` applies just the *new* commit's own deltas directly against the existing `elements_head`/`relationships_head`/`facts` rows; `atlas.commit_deltas` calls it whenever the caller omits a full computed projection, falling back to the old full-replace path (`atlas.replace_main_head_projection`) only for a commit containing a `restore` delta (a deliberate, disclosed scope cut, not an oversight). `src/db/commits.ts` sends deltas only for every other main commit. The payload-size budget this row used to worry about dropped from the measured ~8.45 MB to under 200 KB for a single edit at 2,000 elements (`e2e/landscape-perf.engine.spec.ts`'s own budget assertion, `deltaApplyInSql.integration.test.ts`) — this row and the prompt pack's own register had never been updated to say so until F2's own prep work closed them out. | — | — |
| ~~§8's name+type+context trigram identity matching, and the same upgrade to `classifyMerge`'s own "identity" finding~~ | **Classifier half closed, E7.** `src/engine/trigram.ts`'s `trigramSimilarity` reimplements `pg_trgm`'s own padding (two leading spaces, one trailing) and Jaccard-index formula in pure TypeScript — `classifyMerge` (`src/engine/merge.ts`) has no database round trip available to it, comparing two already-folded, in-memory `Head`s instead. The weak "identity" finding now fires on `trigramSimilarity(normalizedName) ≥ IDENTITY_TRIGRAM_THRESHOLD` (0.6, the same value SPEC §8 point 3 fixes) rather than exact name equality; an exact match (similarity 1) keeps the pre-existing same-`parentId` rule unchanged, while a genuinely fuzzy match additionally requires context corroboration — the same `parentId` for a container/capability (SPEC §8's own "the proposed parent resolves to the same parent"), or, for a system/actor (§8's own "the context is the type alone" — no parent worth comparing), a shared `vendor`, a shared `description`, or a common owning actor (an `owns` relationship into both elements) — any one signal is enough. Unit-tested in isolation (`src/engine/trigram.test.ts`) and through `classifyMerge` (`src/engine/merge.test.ts`'s own "identity (weak: name + type + context)" cases: typo-tolerant match, below-threshold rejection, and one case per context signal). §8's own capture-matcher half is unaffected and still targets **Sprint K1** — it needs the capture pipeline's draft elements to match against, which `classifyMerge` never did. | — | — |
| ~~Per-element accept/skip split, and the change page's split/delivered-remaining view (ADR-006's amendment)~~ | **Closed, Sprint C2 (Prompt 7b steps 1/2/3/5/6).** `src/engine/splitClosure.ts`'s `computeSplitClosure` (dependency closure: pull-in for new relationship endpoints and new-child parents, block for a retract whose dependent isn't also accepted) + `atlas.split_branch` (`20260911020000_split_branch.sql`) + the review queue's own accept/skip UI (`SplitReviewPanel.tsx`) + the change page's delivered/remaining panel (`ChangeView.tsx`, already built against `resolveChangeLineage` — real data now that something creates a split). Property-tested (folding the closure's own result over the merge base never violates C8/C9 — checked by actually folding, not a hand-rolled re-check), integration-tested against a real Supabase, and covered end-to-end by `e2e/split-branch.spec.ts`. | — | — |
| ~~Server-persisted identity-warning dismissals (P-18)~~ | **Closed, Sprint C2 step 7.** `atlas.dismiss_identity_pair` (`20260911030000_persist_identity_dismissals.sql`) — a dedicated `merge_requests.dismissed_identity_pairs` column, not folded into `classification` itself (which is wholly recomputed on every refresh/resubmit and would silently drop a dismissal recorded there). `useReviewRequest.ts`'s own `isIdentityPairDismissed`/`dismissIdentityPair` now read/write it instead of local-only React state. Integration-tested (`src/db/reviewQueueHardening.integration.test.ts`): persists across a fresh fetch, idempotent on a repeat dismissal. | — | — |
| Playwright coverage for the review queue (`BranchRebasePanel`, `/review` list) | No automated test exercises `BranchRebasePanel.tsx`'s own pre-review-request rebase flow, the `/review` queue list page, or a branch-ref visit to Context/Container asserting the As-is/To-be/Diff mode control renders there | **C2b, in progress (#76)** | Grouped with C2b rather than shipped alone — the same review-queue UI surface both touch, and C2b's own structural-conflict actions are the more natural thing for this coverage to exercise once they exist, rather than writing throwaway coverage now that would need rewriting once C2b lands. ADR-021 §7's own Playwright list has the exact scenarios. |
| ~~Structural-conflict bespoke resolution actions (docs/AUDIT-2026-09-C1.md §7)~~ | **Closed, ADR-021/C2b (issue #76).** Retract-cascade (keep-retraction/keep-element with the dependant cascade, Case A and B, ADR-021 §4.1), duplicate-relationship survivor pick (§4.2), cardinality primary/role pick (§4.3) all resolve with real actions now: `src/engine/mergeResolution.ts`'s `buildStructuralResolutions` builds the preparation+merge delta pair, `src/engine/structuralFindingGroups.ts` groups findings into one card per retracted element or pair, `src/ui/reviews/ConflictCards.tsx`'s `RetractionConflictCard`/`PairConflictCard` render them, `useBranchRebase.ts`/`useReviewRequest.ts` stage the choices, `atlas.refresh_branch` (`20260913150000_refresh_branch.sql`) commits atomically. Verified against real Supabase (`src/db/refreshBranch.integration.test.ts`), including the issue's own original failing scenario. **P-29, P-31 and the P-13 extension now generative** (`src/engine/mergeResolution.structural.property.test.ts`): six fast-check generators (retract-vs-modify Case A/B with randomised dangling-endpoint/dangling-parent cascade sizes, converged-retract, duplicate-relationship, cardinality on both `supports` and `owns`) drive `buildStructuralResolutions`, asserting the fold never throws, V2/V6 hold (V2 is still never checked by `apply()` itself — this is the one thing this property adds beyond "didn't throw" for that rule; V6 now also is, inline, Sprint U4-1 findings item 5 — this assertion stays as the oracle-independent check regardless), every `resolved_conflicts` row references a real delta id, C21 holds for `P`, the result matches each scenario's own independently-computed oracle, two runs with the same inputs/mintId sequence produce identical output (P-31), and `classifyMerge` finds the same findings direction-normalised under an ours/theirs swap (P-13 extended). Still open: the deferred Playwright coverage below. | — | — |
| ~~`atlas.merge_elements` (identity "merge now")~~ | **Closed, E7 (`supabase/migrations/20260916050000_element_merges.sql`).** `element_merges` migrated exactly per §3.6; `src/engine/mergeElements.ts`'s `buildMergeElementsDeltas` computes the retract-and-repoint commit (an ordinary `manual` commit through `commitToBranch`, needing no new commit kind — ADR-019's own amendment has the full reasoning, including the two collision conventions reused from ADR-021 §4.3), `atlas.record_element_merge` records `element_merges`/the `merged_id` alias atomically alongside it. A genuine undo (`buildUndoMergeElementsDeltas`, `undoElementMerge`) ships too, past what this row's own text originally asked for — the E7 prompt's own "merge then undo is the identity" requirement, verified generatively (P-33, §10). `src/db/elementMerges.integration.test.ts` covers the RLS/RPC/alias-resolution half against real Supabase, not executed in this sandbox (same limitation as every other integration suite here). `atlas.record_element_merge` also writes a `name`-type alias for the loser's own former name (resolved with the human directly, §3.6's own amendment) — the id-shaped `merged_id` alias alone could never satisfy "old name found by search." The "Merge into…" UI action is closed too: `ElementHeader.tsx`'s `onMerge` (omitted-not-disabled, gated on `canEditBranch` like every sibling action here), `MergeIntoAction.tsx` (target picker via `useRelationshipTargetSearch`, restricted to the same element type; a required rationale, CLAUDE.md rule 4), `useMergePreview.ts` (a live confirmation preview folding the real head and calling `buildMergeElementsDeltas` as a dry run — CLAUDE.md rule 7, no stand-in confirmation UI, reading `MergeEffect`, `buildMergeElementsDeltas`'s own new structured return alongside its deltas, the exact classification the real commit uses, never a second hand-written approximation), `useElementMerge.ts` (commits, then reports a save toast with a real, working "Undo" action — `toastStore.ts`'s new optional `action` field, `ToastHost.tsx`'s second button). The golden path itself is closed too: `e2e/golden-path-merge-elements.spec.ts` (click-only from Home, at 1280 and 390 per `playwright.config.ts`'s own project matrix) merges two near-duplicate systems, confirms the old name resolves to the survivor by search, undoes the merge, and confirms the original is reachable by that name again — written and reasoned through against the real UI, not executed in this sandbox (same Docker limitation as every integration/Playwright suite here). E7 (docs/prompts/atlas-prompt-pack.md) is fully closed. | — | — |
| Capture-draft review-queue item kind (docs/AUDIT-2026-09-C1.md §7) | UI-principles §5 names two review-queue item kinds; `src/ui/reviews/ReviewQueueView.tsx`'s own comment says only merge requests are rendered today — capture drafts are "not built here (the capture pipeline itself doesn't exist yet, ADR-004/SPEC §8's own deferral)" | **Sprint K1** | Depends on ADR-004's capture pipeline existing at all — nothing produces a `capture_draft` branch today, so there is nothing for this item kind to represent until Sprint K1 builds the pipeline that does. |
| ~~Roadmap view (target-date timeline across changes, UI-principles' change-page cross-reference)~~ | **Closed, prompt pack F5** (`docs/UI-principles.md` §6.1's own Roadmap row has the full shape). `src/ui/roadmap/roadmapLifecycleRows.ts`'s `groupRoadmapLifecycleBars` reads `introduced`/`plannedEnd`/`supportEndsAt` straight off `elements_head` (no new fact, no new table) and groups by the same level-1 `supports` rollup Landscape/capability-map colour-by already use; `src/db/roadmapChangeEvents.ts`'s `deriveRoadmapChangeEvents` derives add/retire/replace markers from a merged/planned `record`/`propose` branch's own deltas (never a stored fact of its own — a replace is recognised structurally, from a same-change `supports` retract+create pair onto one capability, the same shape `useElementRetire.ts`'s own "replaced by" picker already produces). Plain DOM/CSS (UI-principles decision 7), CSV and canvas-drawn PNG export sharing one filtered/moded "visible set" function (`roadmapVisibleData.ts`) with the on-screen view so an export can't silently drift from what's shown. Verified: `src/ui/roadmap/*.test.ts` (pure logic — grouping, event derivation, filters, timeline scale, CSV/PNG layout), `e2e/golden-path-roadmap.spec.ts` (click-only from Home, a `record` change retiring a system with a named replacement, merged, then read back as a replacement arrow on the roadmap — written and reasoned through against the real UI, not executed in this sandbox, same Docker/Supabase limitation as every other suite here). **Disclosed, not silently dropped:** the split/closure "one logical change" rollup this row originally named as a dependency (`resolveChangeLineage`) is still not wired in — a partial-acceptance split branch can appear as a second, separate roadmap entry alongside its original, rather than rolled up into one. Two further scope narrowings, also disclosed rather than invented: this data model has no "contract ending" concept, so that prompt-pack wording is mapped onto the existing `supportEndsAt` fact and labelled "Support ending"; and "version" markers/tray anchors are two distinct, ambiguous senses of the word with no existing read path, left unbuilt rather than guessed at. | — | — |
| Keyboard shortcuts for the As-is/To-be/Diff control (§8.8's `1`/`2`/`3`), and a propose-change element/type picker | `BranchViewModeControl.tsx`'s own doc comment names the shortcut gap explicitly; "propose a change" (creating a branch from an element/type picker rather than only from an existing element's own page) has no UI yet | **M1** | Both are real, self-contained UI gaps named at their own point of use (not implied to be broken, just not yet built) rather than tracked only in scattered comments. |
| A generated (typed) Supabase client, replacing the untyped `Client` (src/db/branches.ts's own module comment: "no generated `Database` schema") | Every `src/db` function casts `data`/`error` by hand at its own return point instead of getting the row shape from a generated schema | **H2** | A real correctness/maintenance improvement (a schema drift would surface as a type error, not a runtime surprise) with no urgency today — regenerating on every migration is upkeep work worth taking on deliberately, not mid-sprint, and Sprint H2 is the first point named for revisiting this project's own H1/H2 numbering scheme. |
| `relationship_type_rules` as a migrated table (§3.3) | A real `relationship_type_rules` table, as originally specified below | **Superseded — never.** | Sprint H1's `RELATIONSHIP_TYPE_RULES` constant (`src/contracts/relationshipTypeRules.ts`) already fully enforces C9/V3 — see §3.3's own note on this table. A migrated table would only ever be worth building if the ruleset needed to become live-editable product content without a code change (e.g. an admin screen for adjusting rules) — nothing today requires that, and none is planned. This is not "not yet"; it is a permanent design choice, recorded so a future request to migrate it has to argue against this decision rather than treat the gap as an oversight. |
| Landscape p5 fps, 30 → 45 (UI-principles §8.6, ADR-015) | Closing the gap between the measured p5 frame rate (~30fps, three clean runs — `e2e/landscape-perf.spec.ts`) and §8.6's actual ≥45fps target; the CI gate itself is 28, a no-regression baseline, not this target | **R-perf** | Sprint C1-H item 1d got this test running end to end for the first time (previously blocked by an `.in()`-filter-size bug, then a `max_rows` truncation bug — both fixed); the ~30fps p5 number it then produced is real and reproducible, not an artifact of either fix. Closing it is a rendering-performance investigation, not a read-path one — profile the worst frames first (which ones miss budget, and why) rather than guessing at a fix. |
| Single sign-on (SSO) | No SAML/OIDC identity-provider integration exists or is planned for this sprint — auth is Supabase's own email/password and magic-link flows only (Sprint F7 item 3) | **Pilot feedback** | The F7 prompt's own explicit call: "SSO recorded as a pilot-feedback item, not built." This product's stated scale (one or two architects, occasional external sharing via `model_shares`) doesn't need it yet; worth building once a pilot customer's own IT policy actually requires it, not speculatively ahead of that. |
| ~~Assigned-review notification preference~~ | **Closed, Sprint F7 (follow-up commit, ahead of prompt pack F3a landing the underlying `review_assigned` notification kind mid-sprint).** Sprint F7 PR3 shipped `notify_on_mention`/`notify_on_reply` but named "assigned reviews" as inert — no `review_assigned` notification kind existed yet, so a toggle for it would have had nothing to control (CLAUDE.md rule 7). F3a's own `atlas.submit_merge_request`/`atlas.set_reviewers` landed that kind days later; `20260916010000_notify_on_review_assigned.sql` added `notify_on_review_assigned` (same default-`true`, gate-the-notification-not-the-record shape as the other two) and redefined both RPCs to check it before each `review_assigned` insert. The profile page's notification-preferences panel dropped its "not available yet" copy for a real third checkbox in the same commit. | — | — |
| ~~Canvas "hollow" (all-resolved) comment marker, and the "Comments on this view" toolbar filter~~ | **Closed, M1 close-out item 1.** `atlas.thread_counts` (§9.4, `20260911010000_thread_counts.sql`) replaces `atlas.unresolved_comment_counts` with `(open_count, total_count)` per anchor, which is all the hollow marker ever needed — "has threads, all resolved" (`open_count = 0, total_count > 0`) is now told apart from "no threads at all" (still simply absent from the result). The toolbar filter ("comments on this view") shipped without the per-`view_kind` count this row originally assumed it would need: it dims any node with `total_count === 0` on the *current* view's own already-loaded anchor set, regardless of which `view_kind` a thread was originally raised from, rather than filtering to threads raised specifically in this view — a simpler, real behaviour ("does this system have any comment thread at all"), not the narrower one this row anticipated, and not worth a second RPC variant to build the narrower one instead. | — | — |
| True drag-and-drop for capability map sibling reordering (Sprint U4-1 C1) | "Tailoring allows drag-to-reorder among siblings" ships as move buttons — left/right at L1, up/down at L2 — swapping `attributes.order` with an adjacent sibling, not a mouse drag gesture (`src/ui/capabilityMap/useCapabilityReorder.ts`'s own module comment: no drag-and-drop anywhere else in this codebase, no DnD library, and buttons stay keyboard-/screen-reader-operable, which a bare `draggable` element wouldn't be) | **U4-2** | Reviewed and accepted as the shipped behaviour for U4-1, not a gap to close before the item counts as done — the *effect* (a capability swaps places with an adjacent sibling) is identical either way. A real drag gesture is a genuine interaction upgrade once tailoring sees more day-to-day use, worth its own sprint rather than folded into C1 unreviewed. |
| Custom attributes on `value_stream` (F6, ADR-023) | `attribute_definitions.applies_to` stays `capability`/`system`/`container`/`actor` (the `CHECK` in `20260914020000_attribute_definitions.sql`); a value stream or stage carries only its core attributes, and the org-settings definitions panel never offers the new type | **Unscheduled** | ADR-023's own Alternatives rejected: nothing in F6 asks for org-defined data on this layer, and widening the `CHECK` plus the panel is real, separable work — recorded so a later request picks up a known gap rather than an oversight. |
| Undo for "Convert to a module of…" (`src/engine/convertSystemToModule.ts`) | Unlike a merge (`buildUndoMergeElementsDeltas`), converting a system to a module has no inverse commit builder and `ConvertToModuleAction.tsx`'s own save has no "Undo" action | **Unscheduled** | An explicit v1 scope call, not an oversight: reverting would mean recreating the original system id and re-pointing every carried-over relationship back, and it's a genuinely open question whether "undo" should restore the exact same system id or mint a fresh one — deferred rather than answered unprompted (CLAUDE.md's own "ask when a decision isn't covered" rule). A mis-conversion can still be corrected by hand today: create a new system with the dropped attributes restored, move its relationships across, retire or remove the module. |
| Capture: `LLM_BUDGET_EXCEEDED` distinct failure code (SPEC-capture.md §11) | `llm-proxy` only enforces a requests/hour rate limit; `captureRunStep.ts` maps every 429/5xx to `LLM_UNAVAILABLE`, so an org that would hit a per-org cost cap is told to keep retrying rather than told to raise the cap | **Unscheduled** | Found in a capture-pipeline audit against SPEC-capture.md (issue #287). Needs a real per-org cost cap in `llm-proxy` first (ADR-014) — the distinct error code has nothing to report until that cap exists. |
| Capture: `LLM_TRUNCATED`/`LLM_SCHEMA_INVALID` retry-with-chunk-split (SPEC-capture.md §11) | `src/capture/llm/client.ts`'s own doc comment claims the orchestrator "retries once with the chunk split in half," but `captureRunStep.ts`'s `classifyError()` fails the job immediately on either code; no retry/chunk-split logic exists anywhere in `src/capture` | **Unscheduled** | Found in a capture-pipeline audit against SPEC-capture.md (issue #288). Either implement the retry the comment describes, or correct the comment and SPEC-capture.md §11 to say it fails immediately — a decision for the human since it changes the documented failure contract. |
| Capture: calibration metric (SPEC-capture.md §12.4) | `scripts/scoreCapture.ts` and `FixtureScore.metrics` have no `calibration` field and no cross-fixture rollup, though all ten fixtures now exist (the stated precondition) | **Unscheduled** | Found in a capture-pipeline audit against SPEC-capture.md (issue #289). `pnpm capture:score` currently can't fail on calibration regardless of actual output quality. |
| Capture: `DRAFT_HEAD_MOVED` guard (SPEC-capture.md §11) | No such check exists in `atlas.apply_capture_decisions`; the draft branch's head is read via `foldFromGenesis` with no re-check that it's unchanged at apply time | **Unscheduled** | Found in a capture-pipeline audit against SPEC-capture.md (issue #290). Low risk (drafts are written once, never mutated by application code today) but the defensive guard the spec promises is genuinely absent. |
| Capture: SPEC-capture.md doc/code mismatches (§8.1 `write_capture_draft` signature, §13 Playwright workaround, §5.2/§7.3 undisclosed matcher narrowings) | Each is a sound, in-code-commented deviation from the spec's literal text that the spec document itself was never updated to reflect | **Unscheduled** | Found in a capture-pipeline audit against SPEC-capture.md (issue #291). Documentation cleanup, no behaviour change. |

Everything else this document defers is named at its point of use, not repeated here: SPEC §2's `created_at` exceptions and §3.6's `capture_job_id` FK (pending `capture_jobs`, Sprint K1) are documentation of an absent dependency, not a scheduled follow-up in the sense this section means. §9's three `model_shares`-dependent RLS clauses (§9.2/§9.3/§9.5) are no longer in this category — Sprint F7 item 4 migrated all three (`supabase/migrations/20260916020000_model_shares.sql`).
