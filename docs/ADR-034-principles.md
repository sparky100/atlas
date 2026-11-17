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

- A starter set of principles. A draft was written for review; if one is offered in the app it will be versioned content the person chooses to add, never added automatically (CLAUDE.md rule 7).
- Linking principles to elements or capabilities, scoring or compliance percentages. Counts are shown as plain numbers, never a score.

## Consequences

One migration, a contract type and round-trip test, a Principles page under Work, and (in the next PR) a Principles section on the decision page, the ADR export and a departures count on the architect and director homes.
