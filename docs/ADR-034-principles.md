# ADR-034 — Architecture principles

Status: accepted (Simon, 2026-11-17: "Perfect" to the proposal; departures need a reason; a plain-English draft set to be written separately, not copied from other sources).
Depends on: ADR-001 (no new element types), ADR-013/ADR-022 (decisions), ADR-024 (projects, the same workflow-record tier).

## Decision

An **architecture principle** is a short rule a team agrees decisions will be checked against, such as "Every system has a named owner". A decision records which principles it **follows** and which it **departs from**. A departure always carries a one-line reason, because "why did we break our own rule here?" is the fact worth keeping.

A principle is a **workflow record**, on the same tier as `decisions` and `projects`: never a delta, never folded into a head, never in a version. It is not a new element type (ADR-001's list stands), and nothing in the landscape can support, use, own or flow to one. Deleting every row of both tables loses no model information.

### Tables (`supabase/migrations/20261117100000_principles.sql`)

- **`principles`**: `id`, `org_id`, `model_id`, `title` (1-120), `statement` (1-500, the rule), `why` (up to 1000, why a team would accept it), `status` (`active` / `retired`), `created_by`, `created_at`, `retired_by`, `retired_at`. A principle belongs to a model, as decisions and projects do.
- **`decision_principles`**: primary key `(decision_id, principle_id)`, `stance` (`follows` / `departs`), `reason` (up to 500; non-blank when `departs`), `created_by`, `created_at`.

### Rules

- **Who:** owners and architects create, edit and retire principles. Every member reads them. Whoever may add a link to an open decision (owner, architect, contributor) may link or unlink principles on it.
- **Retire, never delete.** There is no delete policy. A retired principle keeps its stamped `retired_by`/`retired_at` (set by a trigger, never by the client), its wording cannot be edited while retired, and it can be made active again.
- **Linking:** a decision can only cite an **active** principle **from its own model**. Links can be added or removed only while the decision is `proposed`, the same mechanism as `decision_links`; once it is decided or cancelled the stance is the record.
- **Scope:** model, not organisation. Organisation-wide principles could later be copied into a model; nothing here prevents that.

### Security and advisors

Both tables enable and force RLS with policies in the same migration; `auth.uid()` is wrapped in a select; no `SECURITY DEFINER` function is added (the two trigger functions are invoker functions with all execute revoked); and no foreign key is added without a covering index. To add no advisor finding, `org_id` and the audit columns carry no foreign key (the `projects.project_manager_id` precedent), and `decision_principles.principle_id` is checked by trigger rather than by a foreign key, which is safe because a principle is never deleted and `atlas.delete_model` clears links first. `atlas.delete_model` is replaced with a body identical to the previous one plus those two deletes.

### Not in this decision

- Linking principles to elements or capabilities, scoring or compliance percentages. Counts are shown as plain numbers, never a score.

## Starter sets (PR 2)

Simon, 2026-11-17: principles are offered as **versioned content like the capability maps**, and an organisation must always be able to write its own (it still can, on the same page).

- **Where the content lives:** `principle_sets`, product content in the shape of `sample_models` (ADR-033): no `org_id`, `slug` + `version` unique, `name`, `description`, `payload` = `{ principles: [{ title, statement, why }] }` (1 to 50), `published_by`. Select for any signed-in user; insert only by a platform admin as themselves; no update or delete, and those privileges are revoked (rule 5). A new publish is a new version and the newest is the one offered. No application code holds any set's wording (rule 7).
- **How it is published:** a platform admin uses **Publish as a set** on the Principles page. It publishes the model's **active** principles; retired ones are left out. A set holds only wording, so it carries no person, model or organisation.
- **How a person uses it:** **Start from a set** (owner or architect, shown only when a set exists). They open a set, **tick** the principles they want (none are ticked for them) and add them. Each becomes an ordinary principle of the organisation's own, in one insert (all or none), under the same `principles_insert` policy as one typed by hand. A title the model already has (ignoring case) is skipped, so adding twice changes nothing. Nothing is ever added automatically.
- **Provenance:** a copy records `from_set_slug`, `from_set_name` and `from_set_version` (all three or none; `principles_from_set_consistent`). They are insert-only (the update grant does not name them), and the card says "Started from the … set, version …". The copy is then the organisation's: reword or retire it and the set is untouched.
- **No new function and no new index:** plain RLS, so no `SECURITY DEFINER` finding; `published_by` carries no foreign key (the `principles.created_by` precedent), so there is no unindexed-foreign-key or unused-index finding; the only index is the unique constraint's, which the advisor does not report as unused. The three columns on `principles` add none.
- **Boundary tests:** `src/db/principleSets.integration.test.ts`: a non-admin cannot publish, nobody publishes in another's name or changes or removes a version, a signed-out caller reads nothing, an owner and an architect add into their own model, and a contributor, a viewer and a user from a different organisation cannot.

## Consequences

One migration, a contract type and round-trip test, a Principles page under Direction, and (in the next PR) a Principles section on the decision page, the ADR export and a departures count on the architect and director homes.
