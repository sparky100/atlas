# ADR-035 — Goals

Status: accepted (Simon, 2026-11-17: "Let's go", after the goals proposal; the Direction menu agreed the same day; dispensations parked, not wanted yet).
Depends on: ADR-001 (no new element types), ADR-034 (principles, the same workflow-record tier), ADR-022 (decisions).

## Decision

A **goal** is a short statement of what the organisation is trying to achieve, such as "Cut the time to connect a new customer", linked to the capabilities that serve it. It answers one question: why does this capability matter?

A goal is a **workflow record**, on the same tier as `principles`, `decisions` and `projects`: never a delta, never folded into a head, never in a version. It is **not an element type** (ADR-001's list stands), and nothing in the landscape can support, use, own or flow to one. Deleting every row of both tables loses no model information. There is one concept, not goals plus objectives plus drivers: the optional `why_now` line carries the driver (a regulation, a merger, a contract ending).

### Tables (`supabase/migrations/20261117200000_goals.sql`)

- **`goals`**: `id`, `org_id`, `model_id`, `title` (1-120), `statement` (1-500, what success looks like), `why_now` (up to 500), `status` (`active` / `retired`), `created_by`, `created_at`, `retired_by`, `retired_at`.
- **`goal_capabilities`**: primary key `(goal_id, capability_id)`, `created_by`, `created_at`. `capability_id` is an element id with no foreign key (an element id is not a key of any one table); a trigger proves it is a `capability` in the goal's model at insert.

### Rules

- **Who:** owners and architects create, edit and retire goals and link them to capabilities. Every member reads them.
- **Retire, never delete.** No delete policy on `goals`. `retired_by`/`retired_at` are stamped by a trigger, never the client. A retired goal's wording and links are fixed; making it active again frees them.
- **Links are intent, not model facts**, so unlinking is allowed (while the goal is active). A capability later removed from the model leaves a link the Goals page counts as "no longer in the model" rather than hiding.
- **Scope:** model, not organisation, as principles. Goals read the live model (main), never a branch.
- **No score.** Goals show plain counts (capabilities, supporting systems), never a health percentage.

### Where it appears

- **Direction → Goals** (new nav group holding Goals and Principles; Principles moves out of Work). Add, edit, retire, link, in one page.
- A capability's page: **Why it matters**, listing the goals it serves, with a picker for owners and architects.
- Ask Atlas and the MCP server: a read-only `list_goals` tool (`atlas_list_goals`).
- "Export everything (JSON)": a `goals` list, each with the capabilities that serve it. The importer is unchanged (see below).
- The User Guide's Goals section, which is also the Help assistant's knowledge base.

### Security and advisors

Both tables enable and force RLS with policies in the same migration; `auth.uid()` is wrapped in a select; no `SECURITY DEFINER` function is added (the two trigger functions are invoker functions with all execute revoked); every foreign key is covered by an index; audit columns and `org_id` carry no foreign key (the principles precedent). `atlas.delete_model` is replaced with a body identical to the previous one plus two deletes. The integration test calls every write as a signed-in user from a different organisation.

### Not in this decision

- **Importing goals.** The importer reads facts into reviewed capture drafts with provenance. A goal is not a fact and has no review step, so importing goals is a separate design question (recommended: a plain "goals" section applied directly by an owner or architect, not through a capture draft). Not built; the importer is untouched.
- **Dispensations** (a departure from a principle with a review-by date). Parked by Simon on 2026-11-17: not wanted yet. Nothing here blocks them.
- A goal highlight on the capability map, a Home count of goals with no capability, and a "Serves goals" line in the decision ADR export: the next PR.
- Starter goal sets, goal owners, scoring.
