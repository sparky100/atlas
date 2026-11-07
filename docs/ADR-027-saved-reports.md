# ADR-027: Saved reports, saved copies and dashboards

**Status:** **Proposed 2026-11-06**; the human confirmed every point under "Decisions confirmed" in conversation on 2026-11-06. Status moves to Accepted when the migration merges (the ADR-024 precedent).
**Depends on:** ADR-011 (views are queries; positions are hints), ADR-024 (the workflow tier: projects and decisions are mutable records *about* the model, not facts in it), ADR-007 and SPEC §4 (every fact is a delta with provenance), rules 1, 2, 3, 5 and 8 of `CLAUDE.md`, `docs/PLAN-2026-10-recommendations.md` (F9 reports hub, F12 gaps queue).
**Plan:** `docs/PLAN-2026-11-reports-ai-mcp.md`, F14.

## Context

Atlas has fixed report pages: Portfolio, Roadmap, Landscape, Integrations, the Reports hub and the Elements browser. Each can filter, sort and export, but a filter is lost when the page is left. Nobody can keep "systems past end of support, by owner", run it again next month, show a handful of such numbers together, or keep a copy of what it said on a given day. These are the things comparable tools (Ardoq reports and dashboards, LeanIX reports) sell on, and the gap assessment of 2026-11-06 ranks it fourth.

The design tension is with the repository's own rules. A report must not become a second model (rule 2: no stored node or edge list), must not store layout as data (rule 3), and must not write facts without a delta (rule 4). A *saved copy* is a stored result, which looks like exactly the kind of state those rules distrust. This ADR says where it sits.

## Decision

### 1. A saved report is a query definition in the workflow tier

A **saved report** is a named, stored *question*: a source, filters, columns, sort, optional group-by, and a presentation. It holds no architecture facts. It is **mutable**: it can be renamed, edited and deleted in place, like a project or a decision. No delta is written for it. Rule 5 names specific tables (`deltas`, `commits`, `tags`, `element_merges`, `resolved_conflicts`) and does not apply; the litmus test that does apply is ADR-011's: delete every saved report and the model loses nothing.

The definition (`spec`) is JSON with its own `specVersion`:

- `source`: `elements`, `portfolio`, `relationships`, or `findings`. A fixed list. A new source needs a code change, not a new table.
- `filters`: a list of `{ field, operator, value }` over the source's known fields, including custom attributes by definition key.
- `columns`, `sort`, an optional `groupBy` (one field) and an optional `splitBy` (a second, different field, which needs `groupBy`; it makes a stacked bar).
- `presentation`: `table`, `count`, `barByField` or `donut` (the last two need `groupBy`).

A report that names a custom attribute since removed still runs; that column shows "attribute removed". An unknown `specVersion` is refused with a plain message, never guessed at.

### 2. A report is evaluated in the client, over the materialised head

`src/engine/reportQuery.ts` (pure) turns `(head rows, spec)` into a result: columns, rows, and a row count. The pages feed it from the loaders they already use. It never writes. It follows rule 8: model-scoped queries filtered in the client, no `.in()` over a list that grows with the model. Evaluation is deterministic: the same rows and the same spec give the same result in the same order, with no `Math.random` and no clock reads (rule 6).

### 3. A saved copy is a frozen result, kept as a record

A user can **save a copy** of a report's output at a point in time. A saved copy is a `report_snapshots` row holding:

- the report's name and a **copy of its definition** as it was (so the copy still makes sense if the report is edited or deleted),
- the model, the **ref** it was read at and the **commit id** of that ref's head at that moment,
- who generated it and when,
- the column headings and the **result rows themselves**.

Opening, exporting (CSV, XLSX, PDF) or printing a copy reads only that stored data, never the live model. Editing the report, deleting the report, or changing the underlying elements afterwards cannot change a copy. A copy cannot be edited by anyone: the table has **no update grant** at all. Its link to the report is `on delete set null`.

A saved copy is **not** a layout hint, so ADR-011's litmus test is not the right test for it: it is a record of what was reported. Deleting copies loses no model information (history stays in the deltas), but it does lose the saved evidence, which is why deletion is restricted (below).

The stored commit id is for a later feature ("re-run this report as of then and compare it with the saved copy"). It is not used to rebuild the output; the stored rows are the output.

**Limits chosen here, and why:**

- **Main only.** A copy can be generated from `main` only in this version. Running against a draft change could write content into a permanent record that a viewer could not otherwise see (`atlas.anchor_visible_to_viewer`). Revisit when there is a need and a visibility rule for it.
- **Row cap.** A copy holds at most 5,000 rows. A larger result is refused with a message asking the user to narrow the filter, rather than silently truncated.
- **Visibility.** A copy has the visibility of its report at the time it was saved (`private` to its creator, or `organisation`). It is never wider than the creator could see.

### 4. Dashboards are live arrangements of reports

A **dashboard** is an ordered list of **tiles**. A tile points at a saved report and says how to show it: `kpi` (the row count as a big number), `bar`, `stackedBar` (needs a report with `splitBy`), `donut` (the last three need `groupBy`) or `table` (top N rows, 1 to 50). Tiles have an order and a size from a small fixed set (one column, two, or the full row). A tile re-shapes how its report is shown, never what it asks: the report's own filters always apply. (A finding-count tile is left out until reports over health findings exist; it would otherwise be a tile with nothing real behind it.) Tiles are always **live**: they re-run their report when opened. A tile's position is a display hint in the sense of rule 3: delete every tile order and the reports still exist. Snapshotting a whole dashboard is possible later and is not part of this decision.

There is no free-form canvas, no drag-anywhere layout and no stored coordinates. Charts (ranked bar, stacked bar, donut, big number) are small components of our own in `src/ui/charts/`, drawn from the result with the colour tokens in `src/ui/styles/chartTokens.css`; no charting library is added (the human chose this on 2026-11-06, to be revisited only if more exotic chart types are wanted). The categorical colours were validated for colour-blind separation and contrast against the app's own surfaces; every chart also carries text labels or a legend with values and a data table for screen readers, so colour is never the only signal.

### 5. Visibility and roles

Two levels only: **private** (the creator) and **organisation** (every member of the organisation). Contributors and above create reports and dashboards. A **private** report or dashboard is its creator's alone: nobody else can see or edit it, an owner or architect included. An **organisation** one is edited and deleted by its creator or by an organisation owner or architect. Only an owner or architect can make something organisation-visible, and (to avoid showing a person something they cannot open) a dashboard shared with the organisation can show only reports that are shared too, and a report cannot go back to private while such a dashboard shows it. Viewers see organisation-visible reports and can run them but not edit; what they can *see inside* a result is whatever the loaders show them, since evaluation happens over rows they are already allowed to read. A saved copy follows the same two levels: private to whoever took it, or organisation-visible when its report is (any contributor may share a copy of a shared report) or when an owner or architect takes it. The copy of a shared report generated on `main` shows the rows as they were on `main` at the time, which is what a copy of an organisation-visible report means.

### 6. Tables

`saved_reports`, `report_snapshots`, `dashboards`, `dashboard_tiles`, with RLS per section 5. `report_snapshots` has select and insert policies, a delete policy limited to the person who took the copy and (for an organisation-visible copy) organisation owners and architects, and no update grant; a trigger also refuses an update from any role, bypassing grants, except the foreign key's own clearing of `report_id` when its report is deleted. The columns are in SPEC-data-model.md §3.11. Built in `supabase/migrations/20261106010000_saved_reports.sql`.

## Consequences

- **Rule 1** applies in full: the migration, the contract type (`src/contracts/reportSpec.ts` and row types in `src/db/types.ts`) and a round-trip test arrive together. The round-trip test must prove, on a real database, that a copy is byte-for-byte the same after its report is edited, after its report is deleted, and after the underlying elements change.
- **Rule 2** holds: a report never stores nodes or edges; a dashboard is a list of references to reports.
- **Rule 3** holds for tile order and size; the saved copy is a different kind of thing and is called that here rather than being squeezed under the rule.
- **Rule 4 and 5** are untouched: nothing here writes a fact or edits a protected table.
- A saved copy is a **second place the same data lives**. If a fact in a copy is later found to be wrong, the copy still says what was reported at the time. That is the point; the UI should say "as at <date>, <commit>" on every opened copy.
- Size: copies are capped at 5,000 rows, so the table cannot grow without bound from one click. A per-organisation total is not capped in this version.
- Export of an opened copy reuses the existing export code, fed from stored rows instead of loaded ones.

## Out of scope

- Free-form dashboard layout, drag-anywhere tiles, stored coordinates.
- Copies generated from a draft change.
- Scheduled report runs and emailing copies (this would sit with F12 step 4's unbuilt owner digests).
- Cross-model reports and dashboards.
- Re-running a report as of a past commit (the commit id is stored to make it possible).
- Sharing with named people or per-project (only private or organisation).
- Snapshotting a whole dashboard.

## Decisions confirmed (2026-11-06)

1. **Mutable reports.** A report lives in the workflow tier, editable and deletable in place, because it holds no facts about the architecture (the human, 2026-11-06).
2. **Point-in-time copies.** A user can generate a saved copy of a report at a point in time; later changes to the definition or the data never change it (the human, 2026-11-06).
3. **Two visibility levels:** private and organisation (the human, 2026-11-06).

4. **Deleting a saved copy** is allowed, as proposed: the person who took it, or an organisation owner or architect for an organisation-visible copy, after a confirmation that says it cannot be undone (the human, 2026-11-06: "yes" to going ahead on this basis).

## Follow-up (2026-11-07): every capability reachable from the UI

Found in review: nothing let a user set `groupBy`, `splitBy`, a non-table presentation or a table `limit`, so bar, donut and stacked-bar tiles could not be reached. Added, with no change to the spec format, the tables or `specVersion`:

- **Report settings** on a saved report's page edit its presentation, grouping, split, row limit, description and (owner/architect) visibility, through the existing `updateSavedReport`. The contract's own `parseReportSpec` validates the result before it is stored.
- The Elements and Portfolio pages still show only flat tables. Opening a charted report there opens its question (filters, columns, sort) and sets the chart settings aside; **Save changes** writes the page's question back with the stored settings re-applied (`src/ui/reports/reportShape.ts`).
- **Click-through:** a chart mark opens the report narrowed to the matching rows. The narrowing lives in the URL (`?f=field&v=json`), is never saved, and adds `eq`/`isEmpty` filters on top of the report's own (`src/ui/reports/reportDrill.ts`). Saving a copy is not offered while narrowed.
- Dashboard edit mode can change a tile's kind and a table tile's row count (both already columns on `dashboard_tiles`).

**Standard dashboards** (Simon, 2026-11-07, chose 'Application portfolio overview' and 'Rationalisation (TIME)' from five proposed, delivered as a button that creates ordinary editable items rather than read-only built-ins). `src/ui/reports/standardDashboards.ts` holds their report definitions and tiles; "Add standard dashboards…" creates them for the model only when someone chooses to. They are questions, not facts, and nothing reads them in place of a query, so rule 7 (no seed data on a production path) is not engaged. Values in charts, tables and exports now show as words ("£50k–£250k", "Retiring") and scale fields (lifecycle, criticality, cost, fit) chart in their own order.

Still not reachable, and said so in the app: reports over `relationships` and `findings` (no source adapter yet), and so the finding-count tile.

## Still open

Nothing.
