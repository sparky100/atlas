# Plan — D1 candidate options

Status: design gate, 23 November 2026. No runtime change in this PR.

## Goal

Separate three things that are currently the same object:

- **Decision** — the question, context, owner, choice and record.
- **Option** — a candidate approach being compared.
- **Change** — the model edit that delivers a chosen or worked-on option.

Today every option is already a `branches` row with `kind = 'change'`. Choosing an option flips that branch to `propose`; the other options are cancelled. That is why the UI has to explain branch states, why every option appears as a change, and why ratings, marks, sources and packs all key off a branch id.

## Target model

A new `decision_options` table holds the candidate:

| Column | Meaning |
|---|---|
| `id` | stable option identity |
| `decision_id` | the decision |
| `branch_id` | null until the option is worked on or chosen |
| `title`, `summary`, `to_weigh` | the candidate wording |
| `position` | display order |
| `source` | `manual` or `designer` |
| `agent`, `drafted_at`, `draft_run_id`, `edited_by`, `edited_at` | provenance now in `decision_option_marks` |
| `created_by`, `created_at`, `updated_by`, `updated_at` | audit |

`branch_id` is nullable. That is the core change: an option can exist without a change branch.

### Ratings, sources and marks

These currently key off `(decision_id, branch_id)`:

- `decision_option_ratings`
- `decision_option_marks`
- `option_catalogue_sources`
- `option_web_sources`

They gain an `option_id` column. Existing rows are backfilled from their branch link. The UI reads/writes `option_id`; the old `branch_id` columns remain for compatibility during the transition.

### Baseline

`Stay as we are` is currently `decisions.baseline_branch_id`. It becomes an option row with `branch_id = null`; choosing it records the decision as accepted without creating a delivery change. A new `decisions.baseline_option_id` column replaces the branch pointer after the compatibility window.

### Branch creation

- Adding an option creates a `decision_options` row only.
- **Work on this option** creates the change branch, links it to the option, and opens it.
- **Choose this option** creates a branch only if one does not exist, then records the choice.
- Existing branch-backed options continue to work unchanged until migrated.

## Migration stages

### Stage 1 — additive schema and parity
- Create `decision_options`.
- Add `option_id` to ratings, marks and option sources.
- Backfill from existing `decision_links` branch options and from each table's branch id.
- Dual-write new options and ratings to both keys.
- Read remains branch-based. No visible change.
- Verify parity: every existing branch option has one option row; every rating/mark/source resolves to an option.

### Stage 2 — decision page reads options
- Decision page loads `decision_options` plus the legacy branch options.
- Ratings and sources read by `option_id`.
- Comparison/change views still use the branch when present.
- A candidate without a branch renders as an option, with no change-page link.
- Add `Work on this option`, which creates the branch and then links it.

### Stage 3 — choose and baseline
- `atlas.choose_decision_option` accepts an option id; it creates the branch if needed, or uses the linked one.
- `baseline_branch_id` becomes `baseline_option_id`.
- The chosen option's branch is the only one flipped to `propose`; other candidates are closed as not chosen, not treated as cancelled changes.

### Stage 4 — remove the compatibility path
- Decision page, project page, packs, Home and changes list read options directly.
- `decision_links` branch options remain for historical rows but no new ones are written.
- Drop the old `branch_id` columns from the option-specific tables after a release window.

## UI changes

- Options section shows candidates with **Candidate** / **Chosen** / **Delivery started** states, not `draft` / `proposed` branch statuses.
- “Work on this option” is the only action that creates a branch.
- The change page is reached only from a worked/chosen option, never from an untouched candidate.
- The Changes list and nav badge exclude candidate options with no edits.
- Decision next-step card stays the single primary action: add options → compare → choose → open delivery.
- Candidate options with no branch cannot yet be rated or researched until Stage 2 adds option-keyed ratings/sources. This is deliberate and must be visible in the UI, not a silent loss.

## Compatibility risks

- `decision_option_ratings` currently requires a branch id and is read by the comparison grid, ADR export and pack.
- `option_catalogue_sources` and `option_web_sources` have triggers and RLS keyed on branch id.
- `choose_decision_option` assumes a draft explore branch.
- `decision_option_marks` has no branch foreign key but the UI joins it to branches.
- Project and pack queries join option branches.
- Existing decisions may have chosen branches whose intent is already `propose`.

Each needs a parity test before the read switch. The old path stays until the new one is proven.

## Tests

- Schema/backfill parity: every branch option has an option row; every rating/mark/source maps to one.
- Candidate option with no branch can be added, edited and chosen; work-on creates exactly one branch.
- Ratings and sources survive the transition and resolve by option id.
- Baseline option with no branch can be chosen.
- Existing branch-backed decisions render and choose unchanged.
- Changes list and nav badge exclude untouched candidates.
- Playwright: add a candidate option, rate it, choose it, open the created delivery change; and choose “Stay as we are” without a delivery change.

## Non-goals

- No new decision types.
- No two-stage approach/delivery decision yet; this model makes it possible later.
- No removal of published history or existing option branches.
- No change to project, pack or ADR contracts until Stage 3.
