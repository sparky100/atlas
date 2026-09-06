# UI Principles and Design System Brief

**Status:** Proposed
**Depends on:** `docs/ADR-000-foundations.md`, `docs/SPEC-data-model.md`
**Governs:** everything under `src/ui`

Atlas has two audiences with opposite usage patterns: an architect who lives in it, and a service owner or director who opens it twice a quarter and must not need training. Every screen is judged against both. "Materially better than Sparx, Ardoq, LeanIX and Structurizr" is a testable claim, defined in §1; the rest of this document is how we meet it.

The single idea underneath all of it: **the UI shows facts, and every fact shows why we believe it.** No screen presents a value without a route to its provenance in one hover; no diagram presents a shape that isn't a query result.

---

## 1. What "materially better" means

Concrete, measurable, and checked in Playwright where possible:

| Claim | Measure |
|---|---|
| A director answers "what supports capability X, and what is changing about it" | ≤ 60 seconds from cold open, no training, no search syntax. |
| An architect turns a spreadsheet into reviewed facts | One sitting; ≥ 40 proposed facts per minute reviewed with keyboard only. |
| Anyone can answer "why do we believe this" | One hover on any value, anywhere. |
| Anyone can answer "what changed" | One toggle on any view; the answer is legible in greyscale. |
| Any element, at any level, in any version | Has a URL. Pasting it into a browser lands on it, with the right ref selected. |
| Pan and zoom | 60 fps on 2,000 elements on a 2020 laptop, integrated GPU. |
| Nothing is ever drawn by hand | Zero hand-placed shapes. Zero. |

The incumbents fail most of these: Sparx has no provenance and hand-drawn diagrams; Ardoq and LeanIX are metamodel-first with provenance at best at import-job level; Structurizr has diagrams-as-code but no changes, no review, no "why".

---

## 2. Navigation model

### 2.1 One zoom gesture, five levels

The model is a hierarchy with one business layer on top (ADR-001). Navigation is a single continuous zoom that crosses semantic levels:

```
capability map  →  landscape  →  system context  →  containers  →  components
   (all caps)     (systems by     (one system +      (inside one    (inside one
                   capability)     neighbours)        system)        container)
```

- **Geometric zoom** (scroll, pinch, `+`/`-`) scales the current level. Labels and detail change with level-of-detail rules (§8.6), never disappear abruptly.
- **Semantic zoom** happens when you zoom *into a thing*: the element under the cursor (or the selected element) becomes the scope of the next level down. Triggered by continuing to zoom past the threshold, double-click, or `Enter` on a selection. Zooming out past the threshold returns to the parent scope. Transitions animate the focused element from its position at level N to its frame at level N+1 (≤ 250 ms, respects `prefers-reduced-motion`).
- Every level is a `views` query (ADR-011). The zoom never "opens a diagram"; it changes the scope of the query.

Threshold rule: a semantic transition happens only when a single element occupies ≥ 60% of the viewport's shorter side, so it never triggers by accident during a pan.

### 2.2 Breadcrumb

Always visible at top-left of any canvas or element page:

`Org › Model › [ref] › Capability › System › Container › Component`

- Each segment is a link to that scope at its natural level.
- `[ref]` is a chip showing which state you are looking at: `main`, `v2026-Q1` (tag), or `Change: Housing CRM replacement` (branch). Clicking it opens the ref selector (§6.2). The ref is part of every URL.
- Segments beyond the current scope are not shown; there is no "you could go deeper" affordance in the breadcrumb — that is what the canvas is for.

### 2.3 Back and forward

Browser history is the navigation stack. Every semantic transition, element page open, ref change, and view switch pushes a history entry. Continuous geometric zoom and pan *replace* the current entry on settle (300 ms idle) so the stack is scopes, not scroll positions. `Alt+←` / `Alt+→` and the browser buttons both work. Nothing in Atlas intercepts the back button.

### 2.4 Deep links

Every addressable thing has a canonical URL. The ref is a query parameter so the same element can be linked in any state.

| Thing | URL |
|---|---|
| Model home | `/o/{orgSlug}/m/{modelSlug}` |
| Element page | `/o/{org}/m/{model}/e/{elementId}?ref={ref}` |
| Element on canvas at its level | `/o/{org}/m/{model}/e/{elementId}/canvas?ref={ref}` |
| Saved view | `/o/{org}/m/{model}/v/{viewId}` (ref comes from the view) |
| Ad-hoc view | `/o/{org}/m/{model}/view/{kind}/{scopeElementId}?ref={ref}&diff={baseRef}` |
| Change branch | `/o/{org}/m/{model}/changes/{branchSlug}` |
| Merge request in the queue | `/o/{org}/m/{model}/review/{mergeRequestId}` |
| Capture draft in the queue | `/o/{org}/m/{model}/review/capture/{captureJobId}` |
| Decision | `/o/{org}/m/{model}/d/{decisionId}` |
| Comment | any of the above `#c={commentId}` — opens the side panel scrolled to it |

`{ref}` grammar: `main` · `tag:{name}` · `branch:{slug}` · `commit:{id}`. Default when absent: `main`. A link to an element that does not exist at the given ref shows the element page in a "not present at this ref" state with the nearest ref where it does exist, rather than a 404.

Element ids in URLs resolve through `aliases` of type `merged_id` (ADR-008): a link to a merged-away element lands on its survivor, with a banner saying so.

---

## 3. The two front doors

Same model, same data, different first screen. Which door a user gets is stored per user (`home_mode: director | architect`) and switchable from the top bar with one click; the switch is a preference, not a permission. Preferences live in `user_preferences` (SPEC §3.2), keyed on `user_id` alone — they belong to the person and follow them across organisations. Added in the first UI migration.

Default: Owners and Architects get the architect door; Contributors and Viewers get the director door.

### 3.1 Director's door

Opens on **the capability map at `main`**, with three overlays and nothing else:

1. **The capability map itself** — the sector map as tailored, level 1 and 2 visible, level 3 on zoom. Each capability tile carries a count of supporting systems and, if any, a change-in-flight marker.
2. **Health** — derived only from facts the model actually has. Atlas does not score maturity (ADR-000 preface #6), so "health" means:
   - **Coverage**: capabilities with no `supports` relationship (nothing runs this).
   - **Staleness**: capabilities where the newest fact on any supporting system is older than `STALE_AFTER_MONTHS` (§8.9).
   - **Confidence**: share of facts on supporting systems below `CONFIDENCE_MEDIUM` (§8.9).
   - **Lifecycle exposure**: a supporting system is `retiring` or `retired` and has no **planned replacement**. A planned replacement is: a system added (`element.create`) in a change branch with status `approved` (approved-not-yet-merged is "in delivery" — merging is what marks a change delivered, ADR-006), that `supports` the same capability, **where the same branch also contains an `element.retract` for the exposed system**. Adding a system beside an ageing one is not replacing it; without the retract delta the chip is shown, not weakened.
   - **Open questions**: linked assumptions `invalidated`, decisions `proposed` past 30 days.
   Each is a filter chip, not a score. Toggling a chip highlights matching tiles; the tile's tooltip lists the specific systems and facts. There is no traffic light on the whole organisation, because the model cannot honestly produce one.
3. **Changes in flight** — a right-hand list of change branches with status `proposed | in_review | approved`, each with title, the capabilities it touches, and a one-line to-be summary (counts of systems added/retired). Clicking opens the branch's to-be view scoped to the director's current zoom, not the review queue.

The director's door has no sidebar, no branch selector, no editing affordance. Comments are readable (`team` visibility) via the side panel toggle.

### 3.2 Architect's door

Opens on a three-column dashboard:

1. **Review queue** (left, widest): pending merge requests and capture drafts, sorted by age, with counts by conflict class (SPEC §7.3) and validation status. Keyboard `Enter` opens the top item in the queue (§5).
2. **My branches** (centre): change branches where the user has commits, with status, head validation, "behind main by N commits" and a `Refresh` affordance when behind.
3. **Recent activity** (right): commits, comments, decisions and merges across the model in the last 14 days, each linking to the element/branch. Mentions and replies to the user float to the top.

Below the fold: the same capability map as the director sees, at `main`, with the same health chips.

### 3.3 The switch

Top bar, right side: `Director view` / `Architect view` segmented control. Switching is instant, remembered, and never changes what the user is permitted to do — a viewer who switches to the architect door sees an empty queue and no branches, with a line explaining why, not an error.

---

## 4. The element page

This page is the product's unit of trust. Every other screen is a way of getting here. If a director doubts a diagram, the answer is "click it"; the element page must then settle the doubt in one screen without further navigation.

### 4.1 Layout

Two columns on desktop (≥ 1024 px), stacked on narrower screens. Left column ~62%, right ~38%. Sections in fixed order, each collapsible, state remembered per user. No tabs: a director should never wonder which tab holds the answer.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Breadcrumb                                                [ref chip] │
│ ▣ System  ·  Housing CRM                          ● active  ⇱ external│
│ id ⧉  ·  aka: "HCRM", "Northgate Housing"  ·  in 3 views  ·  ✎ Edit  │
├───────────────────────────────────────┬──────────────────────────────┤
│ 4.2 Attributes                        │ 4.5 Changes touching this    │
│ 4.3 Relationships                     │ 4.6 Decisions                │
│ 4.4 Structure (children / parent)     │ 4.7 Comments (side panel     │
│                                       │      docked here on wide)    │
└───────────────────────────────────────┴──────────────────────────────┘
```

### 4.2 Header: identity

- Type glyph (§8.5) and type word, then name as the page title (`h1`).
- Status chips, only those that apply: lifecycle (`planned | active | retiring | retired`, systems only), `external` with the external organisation on hover, `not present at this ref` (§2.4), `merged into …` banner if reached via a merged id.
- The id, truncated, with copy-to-clipboard.
- Aliases (`aliases` rows other than `merged_id`), inline, each with its provenance badge on hover.
- "in N views" links to the list of saved views whose query includes this element at the current ref.
- `Edit` is present only for contributor+ and only when the ref is a draft change branch; at `main` or a tag it reads `Propose a change…` and opens the branch picker. **There is no editing at main. Ever.**

### 4.3 Attributes with provenance badges

A two-column key/value list, one row per attribute in `type_schemas` order, including empty required attributes (shown as `— required, not recorded` in the warning colour so gaps are visible, never hidden).

Every recorded value carries a **provenance badge** immediately to its right:

```
Vendor        Northgate Public Services       [▤ 14mo · ●●○]
Lifecycle     active                          [👤 2mo · ●●●]
Owner         → Housing Digital (team)        [▤ 14mo · ●●○]  (relationship, shown here read-only)
```

Badge anatomy, fixed width so columns align:
- **Source kind glyph**: `▤` spreadsheet, `▣` document/PDF, `🗣` interview, `👤` manual, `⚙` capture job, `⌂` template, `⇄` merge resolution. Glyphs are from the icon set, not emoji, in production.
- **Age**: time since `facts.effective_date` if set, else the delta's commit time. `< 1mo`, `Nmo`, `Ny`. Turns to the warning colour at `STALE_AFTER_MONTHS` (§8.9).
- **Confidence**: three dots, filled by band: `●●●` ≥ `CONFIDENCE_HIGH`, `●●○` ≥ `CONFIDENCE_MEDIUM`, `●○○` below (§8.9). Human assertion is 1.0 and reads `●●●`.

Hover (or focus) on a badge opens a **provenance card**: source name with link, source kind, `source_ref` (e.g. `Applications.xlsx › Sheet 1 › C14`, `page 7`), effective date, recorded date, recorded by, confidence as a number, and **the supersession chain**: `Previously: "Civica" (▤ 3y · ●○○) → superseded 14mo ago`. Chain entries link to the delta and to the commit. This card is the answer to "why do we believe this", and it is one hover away from every value on every screen — canvas tooltips reuse it.

If the same attribute has a different live value on any open, `shared_for_review` branch, a **disagreement marker** `⚠ differs on 2 changes` appears at the end of the row and opens a list of those branches with their values and badges.

### 4.4 Relationships grouped by type

One group per relationship type in a fixed order: `supports` (systems only), `owns` / owned by, `uses` / used by, `flows_to` / receives from. Each group is a list of rows:

```
uses  (3)
  → Address Gateway            container · in Integration Platform     [⚙ 5mo · ●●○]  💬 1
  → GOV.UK Notify              system · external (Cabinet Office)       [👤 5mo · ●●●]
used by  (1)
  ← Tenant Portal              system                                    [▤ 14mo · ●●○]
```

- Direction is explicit (`→` this uses that, `←` that uses this); both directions are shown in separate sub-groups so an element page never hides an inbound dependency.
- Each row: the other endpoint (link), its type and structural context, the relationship's own provenance badge, and an unresolved-comment count if any.
- `flows_to` rows also show `data_classification` as a chip when set, because that is the attribute a director asks about.
- The `owns` group marks the primary owner with `★`.
- Row hover shows the relationship's attributes (description, protocol) inline; click opens a compact relationship sheet with the same attribute/provenance layout as §4.3 — relationships do not get their own page.

### 4.5 Structure

Parent (link) and children (list with type glyph, name, lifecycle chip). For a capability: level, parent capability, child capabilities, and the systems that support it (the same rows as the `supports` group, repeated here because directors look for them under "structure").

### 4.6 Changes touching this

Two lists:

1. **In flight**: every branch with status `draft` (own, or `shared_for_review`) / `proposed` / `in_review` / `approved` that has any delta with this element as subject or as a relationship endpoint. Row: branch title, status chip, what it does to this element in plain words derived from the delta kinds — `retires this system`, `changes vendor, lifecycle`, `adds 2 uses relationships`. Click opens the branch's to-be view scoped to this element with diff on (§6).
2. **History**: a timeline of every fact ever asserted about this element, newest first, from `deltas`: `14mo ago · vendor: Civica → Northgate · ▤ Applications.xlsx · merged in "Housing CRM replacement"`. Filterable by attribute. Each entry links to its commit and, if the commit is a merge, to the merge request. Retractions and restores appear here as events. This is the audit trail, and it is on the page, not behind an "export audit log" button.

### 4.7 Decisions

Decisions linked to this element via `decision_links`, plus decisions on any in-flight branch that touches it. Row: title, status chip, decided by / date, count of arguments for / against, linked assumptions with their status (an `invalidated` assumption is shown in the warning colour with the re-review nudge). Click opens the decision page. `Record a decision…` for contributor+.

### 4.8 Comments

The side panel (§7) docked to the right column on wide screens, filtered to this element and to relationships/deltas whose subject is this element. Unresolved count in the section header.

### 4.9 Rules for this page

- Nothing on this page is computed client-side from anything but the `elements_head`, `relationships_head`, `facts`, `deltas` and workflow tables at the selected ref. If a number can't be sourced from those, it isn't shown.
- Every value has a badge. No exceptions for "obvious" fields. `name` and `parent` have badges.
- Empty states are informative: "No decisions recorded about this system. 2 in-flight changes touch it without a linked decision." is the empty state for §4.7, not "No decisions".
- The page renders fully at `main`, at any tag, and at any branch, with the ref chip making it unambiguous which. Switching ref keeps scroll position and section state.
- Initial paint ≤ 300 ms after data for an element with 200 relationships; history loads lazily below the fold.

---

## 5. The review queue

The queue is where capture becomes fact and where a change becomes reality. It has two item kinds with different units of review (ADR-004): a **capture draft** is reviewed delta by delta; a **merge request** is reviewed as a whole with its conflicts. Both use the same three-pane layout and the same keys.

### 5.1 Layout

```
┌─────────────┬───────────────────────────────────┬──────────────────────────┐
│ Queue list  │ Proposed fact / conflict           │ Source passage           │
│ (j/k)       │                                    │                          │
│             │  ▣ System · "Tenant Portal"        │ Applications.xlsx        │
│ ▸ Capture   │  ┌ create ───────────────────────┐ │ Sheet 1, rows 12–14      │
│   34 left   │  │ name        Tenant Portal      │ │ ┌──────────────────────┐ │
│   Apps.xlsx │  │ vendor      Civica             │ │ │ 12 Tenant Portal ... │ │
│             │  │ lifecycle   active             │ │ │ 13 Civica  Active ...│ │
│ ▸ Merge req │  │ parent      —                  │ │ │ 14 Housing Digital   │ │
│   Housing…  │  └────────────────────────────────┘ │ └──────────────────────┘ │
│   2 conflicts│                                    │                          │
│             │  Matched: none (new)  ●○○ 0.62     │ Highlighted: the cells   │
│             │  Similar: "Tenants Portal" 0.71 ⚠  │ the extractor used       │
│             │                                    │                          │
│             │  [a] accept  [m] merge into…       │                          │
│             │  [r] reject  [s] split   [e] edit  │                          │
└─────────────┴───────────────────────────────────┴──────────────────────────┘
```

- **Left**: queue items grouped by kind, then the current item's own list of units (deltas for a capture; conflict cards then clean changes for a merge request). Progress `34 left` and a session tally `21 accepted · 3 merged · 2 rejected`.
- **Centre**: the unit under review. For a capture delta: the proposed fact rendered exactly as it will appear on the element page (same attribute rows, same badge), the match outcome (§8 of the spec: `exact id`, `alias`, `name+context 0.71`, `none`), and any *similar* elements above 0.5 with a warning so a near-duplicate is one keypress from a merge.
- **Right**: the **source passage**. `source_ref` is resolved to the actual cells / page region / text span and rendered with the extractor's evidence highlighted. For spreadsheets, the row plus header row; for PDFs, the page image with a highlight box; for text, the paragraph with the span marked. No source, no accept: a proposed fact with an unresolvable `source_ref` is shown with a red bar and cannot be accepted until the reviewer attaches a source manually (`e`).

### 5.2 Actions

| Key | Action | Capture delta | Merge request card |
|---|---|---|---|
| `a` | **Accept** | Promote this delta into the target change branch (chosen once per session, changeable with `t`). | Field conflict: keep this change. Structural: keep the change side. |
| `m` | **Merge into…** | Open the match picker (prefilled with similar elements); choosing one converts the proposed `create` into `update` deltas against the existing element and records an `aliases` row for the matched string. | Identity warning: run `atlas.merge_elements` with a chosen survivor. |
| `r` | **Reject** | Discard this delta from the draft (recorded, not deleted — the draft keeps it with `rejected` in `capture_jobs.stats`). | Field conflict: keep main. Structural: keep the retraction. |
| `s` | **Split** | For a create with several attributes: accept the existence and selected attributes, reject the rest — a checklist over the attribute rows. For a whole draft: send selected deltas to a *different* change branch than the session target. | Not applicable (`s` is a no-op with a hint). |
| `e` | Edit before accepting | Change a value; the accepted delta carries the reviewer's manual source and confidence 1.0, and `resolved_conflicts` records the extractor's value as discarded. | Enter a custom resolution value. |
| `t` | Set target branch | Pick or create the change branch accepted deltas go to. | — |
| `j` / `k` | Next / previous unit | | |
| `x` | Toggle multi-select; then `a`/`r` apply to the selection | | |
| `u` | Undo the last decision (within the session, before apply) | | |
| `Enter` | Open the proposed element / conflicting element page in a peek panel | | |
| `o` | Open the source in full (new tab for PDFs; the sheet with the row focused for spreadsheets) | | |
| `⌘/Ctrl+Enter` | **Apply decisions**: write one commit to the target branch (capture) or one refresh commit (merge request) | | |
| `?` | Key legend | | |

Decisions are staged in the session and applied as one commit (`⌘/Ctrl+Enter`), so `u` is cheap and a review of 300 deltas produces one commit with one message, not 300. The staged state survives a reload (stored locally, keyed by the queue item and the branch head; discarded if the head moved).

### 5.3 Merge-request specifics

The centre pane for a merge request follows SPEC §7.4: summary row, then conflict cards in order — structural, field, identity — then clean changes collapsed. Each field-conflict card is a three-column comparison (`base` / `this change` / `main now`) with badges on all three; the reviewer's choice is rendered as a preview of the resulting attribute row before apply. Structural cards show the retraction and every dependant, with the two resolutions spelled out in consequences ("keeping the retraction also retracts 3 relationships and re-parents 2 containers under Integration Platform"). `Approve` and `Merge` are buttons, not keys — they are rare and consequential — and are disabled with a stated reason until the four conditions in SPEC §7.4 hold.

### 5.4 Keyboard-first means

- Every action is reachable without a pointer; the pointer is never required to *discover* an action (keys are printed on the buttons).
- Focus is never lost: after any action, focus moves to the next unit.
- The queue is usable at 100% zoom on a 13" laptop with the source pane visible; if the viewport is too narrow, the source pane becomes a toggle (`v`), never hidden silently.

---

## 6. Views

### 6.1 The four view kinds

| Kind | Scope | Nodes | Edges | Layout |
|---|---|---|---|---|
| **Capability map** | model | capabilities L1–L3 | none (structure is nesting) | nested tiles, L1 as columns, L2 as stacked cards, L3 on zoom |
| **Landscape** | model, optional capability filter | systems, grouped into swim-lanes by the capability they `support`; externals in a bottom lane | `uses`, `flows_to` between systems | layered, lanes fixed, positions within lane are hints |
| **Context** | one system | the system, every system/actor it has a relationship with | all relationship types touching it | radial, scope at centre, externals outside a ring |
| **Container** | one system | its containers, plus external systems/containers they `uses`/`flows_to` | `uses`, `flows_to` at container grain | layered inside the system frame; externals outside |
| **Component** | one container | its components, plus containers they `uses` | `uses` | same as container |

All five (component included) are the *same* renderer with a different query and layout preset. Nothing is drawn; a view with zero results says so.

### 6.2 As-is / to-be selector

A segmented control on every canvas: `As-is` · `To-be` · `Diff`. It is bound to the ref chip:

- At `main` or a tag, the control is hidden; there is nothing to compare.
- At a branch, **As-is** = `head(mergeBase(B))`, **To-be** = `head(B.head)`, **Diff** = to-be with change highlighting relative to as-is (SPEC §7.1). Positions come from the same `view_layouts` rows in all three so nothing jumps when toggling.
- The `diff=` URL parameter allows any two refs to be compared (`?ref=tag:v2026-Q2&diff=tag:v2026-Q1`), which is how a director sees "what changed since last quarter".

### 6.3 Diff highlighting rules

Colour is never the only signal. Each state has a colour, a marker glyph, a border style, and a legend entry, and the whole scheme must survive greyscale and each of protanopia, deuteranopia and tritanopia (checked with a simulator in CI screenshots).

| State | Colour token | Marker | Border | Fill |
|---|---|---|---|---|
| Unchanged | `--diff-none` (neutral, 60% opacity in Diff mode) | none | solid 1 px | surface |
| **Added** | `--diff-added` (blue #0072B2 / dark #7FBDE9) | `+` badge top-left | solid 2 px | surface tinted 12% |
| **Removed** | `--diff-removed` (vermillion #D55E00 / dark #F2A162) | `−` badge top-left | dashed 2 px | hatched, 50% opacity |
| **Changed** | `--diff-changed` (orange #E69F00 / dark #F3C64C) | `~` badge with count of changed attributes | solid 2 px | surface tinted 12% |
| Moved (parent changed) | `--diff-changed` | `⤴` badge | solid 2 px | as changed, plus a ghost at the old position at 25% |

Edges: added = solid 2 px in `--diff-added` with `+` at midpoint; removed = dashed in `--diff-removed`; changed attributes = `~` at midpoint. Removed nodes stay on the canvas in Diff mode (ghosted) so a director can see what is going away; they vanish in To-be.

Hover on any marker shows the changed attributes with base → new and both badges. The legend is pinned bottom-left whenever Diff is on and lists the three states with their markers, so the encoding is always on screen.

### 6.4 Layout persistence

Positions are hints (ADR-011). Drag saves to `view_layouts`; `Reset layout` deletes the view's rows and re-runs the algorithm; nothing about the model changes. Auto-layout is deterministic for the same query result (seeded by view id and scope), so two people see the same picture until one of them drags.

---

## 7. Comments

### 7.1 Anchors

Comments attach to elements, relationships, deltas, branches and decisions (SPEC §3.8) — never to a point on a canvas. On the canvas, a comment marker `💬 n` (unresolved count) sits at the top-right of the node or at the midpoint of the edge it is anchored to; on the element page, markers sit on the row. "Comment on this value" from an attribute row anchors to the *delta currently asserting it* — that is how attribute-level comments exist without an attribute anchor type, and why they survive supersession (the comment stays with the fact that was commented on, and the provenance card shows it in the chain).

Starting a comment from a canvas node optionally stores `view_id`/`hint_x`/`hint_y` so the marker can sit where the author pointed; deleting the view moves the marker to the node's default position, never loses the comment.

### 7.2 Side panel

One panel, right-docked, toggled with `c`, the same everywhere:

- Header: scope (`This element` · `This view` · `This change` · `Model`) with the unresolved count, and a `Show resolved` toggle.
- Threads: root comment, replies indented one level (flat thread, ADR-010), author, age, visibility chip for `internal`. Each thread shows its anchor as a breadcrumb line; clicking it navigates (and, on a canvas, pans to it).
- Composer at the bottom, `⌘/Ctrl+Enter` to post, `@` mentions members.
- `Resolve` on the thread for architect+; resolved threads collapse to one line and remain in history.

### 7.3 Unresolved counts

Shown at every scope where a person makes a decision: element header, canvas node markers, view title, branch row in the queue and dashboards, merge-request summary. A merge request's summary shows `n unresolved`, and the `Merge` button's tooltip lists it alongside the real disabled reasons when > 0. **Comments never block a merge.** Comments are conversation; a gate needs an explicit mechanism (a blocking flag or a required approval), which would be a separate decision. ADR-006 stands as written.

---

## 8. Design system constraints

### 8.1 Typography

System font stack (`Inter` if bundled, else `-apple-system, Segoe UI, Roboto, sans-serif`), tabular numerals on. Scale (px / line-height), one scale for both density modes; density changes spacing, not type:

| Token | Size / LH | Use |
|---|---|---|
| `--text-xs` | 11 / 16 | badges, canvas labels at low zoom |
| `--text-sm` | 13 / 20 | table rows, secondary text, canvas labels |
| `--text-md` | 14 / 22 | body, forms, list rows |
| `--text-lg` | 16 / 24 | section headers, element page rows |
| `--text-xl` | 20 / 28 | page titles in compact, panel titles |
| `--text-2xl` | 24 / 32 | element page title |
| `--text-3xl` | 32 / 40 | director's door heading only |

Monospace (`ui-monospace, SFMono-Regular, Menlo`) for ids, `source_ref`, hashes. Minimum rendered text on canvas is 11 px; below that labels are hidden by the LOD rules, never scaled smaller.

### 8.2 Spacing

4 px base. `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-6` 24 · `-8` 32 · `-12` 48 · `-16` 64. Radii: `--radius-sm` 4 (chips, badges), `--radius-md` 6 (cards, inputs), `--radius-lg` 10 (panels). Borders 1 px; 2 px only for diff and focus.

### 8.3 Density modes

`comfortable` (default for directors) and `compact` (default for architects), per-user preference, toggled with `⌘/Ctrl+Shift+D`.

| | comfortable | compact |
|---|---|---|
| list/table row height | 40 | 28 |
| attribute row on element page | 36 | 26 |
| canvas node min height | 48 | 36 |
| panel padding | `--space-4` | `--space-2` |
| queue units visible on 800 px tall viewport | ~14 | ~22 |

Type sizes do not change between modes.

### 8.4 Colour tokens

Semantic tokens only; components never reference a raw hex. Light / dark values; dark is a first-class theme from day one, not an inversion — chosen for AA contrast (≥ 4.5:1 text, ≥ 3:1 UI) in both.

**Surfaces and text**

| Token | Light | Dark |
|---|---|---|
| `--bg` | #FFFFFF | #0F1115 |
| `--bg-subtle` | #F6F7F9 | #161A21 |
| `--surface` | #FFFFFF | #1B2029 |
| `--surface-raised` | #FFFFFF + shadow | #222834 |
| `--border` | #D9DEE5 | #2E3644 |
| `--border-strong` | #B8C0CC | #465063 |
| `--text` | #14181F | #E6E9EF |
| `--text-muted` | #5B6472 | #9AA4B4 |
| `--text-faint` | #8A93A1 | #6B7585 |
| `--accent` | #0B5FFF | #6EA0FF |
| `--accent-fg` | #FFFFFF | #0F1115 |
| `--focus` | #0B5FFF, 2 px ring + 2 px offset | #6EA0FF |

**Diff** (Okabe–Ito derived, §6.3)

| Token | Light | Dark |
|---|---|---|
| `--diff-added` | #0072B2 | #7FBDE9 |
| `--diff-removed` | #D55E00 | #F2A162 |
| `--diff-changed` | #E69F00 | #F3C64C |
| `--diff-none` | `--border` at 60% | same |

**Status**

| Token | Meaning | Light | Dark |
|---|---|---|---|
| `--status-ok` | validation pass, `active`, `accepted`, `validated` | #009E73 | #5FD3A9 |
| `--status-warn` | stale (> `STALE_AFTER_MONTHS`), low confidence, `retiring`, `proposed` > 30 d, `invalidated` assumption | #E69F00 | #F3C64C |
| `--status-danger` | validation fail, blocking conflict, missing source, `rejected` | #D55E00 | #F2A162 |
| `--status-info` | `planned`, `in_review`, identity warning | #0072B2 | #7FBDE9 |
| `--status-neutral` | `retired`, `archived`, `draft`, resolved comment | #8A93A1 | #6B7585 |

Warn and danger deliberately share hue families with diff-changed and diff-removed; they never appear on the same node at the same time (diff markers are on the node, status is in the chip), and both always carry a glyph. `--status-ok` green is never used for "added" and `--status-danger` never for "removed" — diff and status are different vocabularies and must not be read across.

**Confidence dots** use `--text` filled / `--border-strong` empty, no colour: confidence is a count, not a judgement.

### 8.5 Element type glyphs

One glyph per type, fixed, used in breadcrumbs, canvas, lists, badges: capability `◫`, system `▣`, container `▢`, component `▫`, actor `◉` (person) / `◎` (team). External elements get a dotted outline on the glyph. Relationship types on canvas: `supports` never drawn as an edge (it is the landscape's lane structure); `uses` solid arrow; `flows_to` solid arrow with a small `⇢` label glyph; `owns` never drawn on canvas (shown on the element page). One arrowhead style. See §9.

### 8.6 Performance: 60 fps on 2,000 elements

Budget: 16.6 ms per frame during pan/zoom, on a 2020 13" laptop with integrated graphics, 2,000 nodes and 4,000 edges in a landscape view.

Rules that follow from the budget:

- **Canvas 2D renderer** for nodes, edges and labels; DOM only for the hovered/selected node's overlay, tooltips, and the breadcrumb. WebGL is the upgrade path if Canvas 2D fails the budget at 2,000, not the starting point. SVG is not used for the graph at all.
- **Layout in a Web Worker**, never on the main thread; results are positions, written back in one message. First layout of 2,000 nodes ≤ 2 s; incremental re-layout after a diff toggle ≤ 500 ms.
- **Viewport culling**: only nodes intersecting the viewport (+ 20% margin) are drawn.
- **Level of detail**: labels drawn only when node width on screen ≥ 64 px; attributes chips ≥ 160 px; edges thinner than 0.5 px on screen are drawn as a single aggregated stroke per node pair; below 0.25 px not drawn.
- **Quantised zoom for text**: text is rasterised at the nearest of 8 zoom steps and scaled between, so no per-frame text layout.
- **Static during gesture**: hover effects, comment markers and diff badges freeze during a gesture and repaint on settle.
- **Playwright perf test**: a fixture model with 2,000 systems / 4,000 edges; a scripted 3 s pan+zoom must report ≥ 55 fps p50 and ≥ 45 fps p5 via `requestAnimationFrame` timing, on CI's software renderer scaled by a measured factor. Regressions fail the build.

### 8.7 Accessibility

WCAG 2.2 AA. Every canvas interaction has a keyboard and a list equivalent (the element page and the relationships list *are* the accessible view of any diagram). Focus ring on everything focusable. `prefers-reduced-motion` disables transitions. Diff and status never colour-only (§6.3, §8.4). Minimum hit target 24 px.

### 8.8 Keyboard shortcuts

Global:

| Key | Action |
|---|---|
| `⌘/Ctrl+K` | Command palette: search elements, branches, decisions, views; run any action |
| `/` | Focus search |
| `g` then `h` / `c` / `l` / `q` / `b` / `d` | Go to: home · capability map · landscape · review queue · my branches · decisions |
| `[` / `]` | Previous / next ref in the ref chip (main, tags, branches in order) |
| `c` | Toggle comments panel |
| `?` | Shortcut legend |
| `⌘/Ctrl+Shift+D` | Toggle density |
| `⌘/Ctrl+Shift+L` | Toggle theme (system · light · dark) |
| `Esc` | Close panel / clear selection / exit peek |

Canvas:

| Key | Action |
|---|---|
| `+` / `-` / `0` | Zoom in / out / fit |
| `Enter` | Zoom into selection (semantic) |
| `Backspace` | Zoom out to parent scope |
| Arrow keys | Move selection to nearest node in that direction |
| `Space` + drag | Pan |
| `i` | Open element page for selection |
| `p` | Peek: element page in a side sheet without leaving the canvas |
| `1` / `2` / `3` | As-is · To-be · Diff |
| `f` | Filter chips (capability, lifecycle, external, stale, low confidence) |
| `r` | Reset layout for this view |
| `.` | Focus the legend |

Element page:

| Key | Action |
|---|---|
| `e` | Edit (on a draft branch) / propose a change |
| `h` | Jump to History |
| `d` | Record a decision |
| `n` | New comment on the focused row |
| `⌘/Ctrl+C` on the title | Copy deep link |

Review queue: §5.2.

All shortcuts are single-key where safe, and every one is discoverable in the palette and the `?` legend. No shortcut is ever the only way to do something.

### 8.9 Thresholds

Three constants, global for v1, defined once in `src/contracts/thresholds.ts` and imported by engine, UI and tests. Nothing else may restate the numbers.

| Constant | Value | Used by |
|---|---|---|
| `STALE_AFTER_MONTHS` | 12 | badge age colour (§4.3), staleness health chip (§3.1), `--status-warn` |
| `CONFIDENCE_HIGH` | 0.9 | `●●●` band |
| `CONFIDENCE_MEDIUM` | 0.7 | `●●○` band, confidence health chip |

If per-model thresholds are ever wanted, they become a settings row plus a lookup that falls back to these constants — not a refactor. There is no evidence yet that organisations want different thresholds, and per-model settings would cost a UI and tests.

---

## 9. What we will not build

Stated so that a feature request has to argue against a written decision:

- **Freeform drawing.** No pen, no shapes tool, no text boxes on the canvas beyond `view_annotations` (which are sticky notes and highlights on a query result, visually quarantined, never exported as model).
- **Arbitrary shapes.** Every type has one shape. There is no shape picker, no icon library per element, no "make this one a cylinder".
- **Per-diagram styling.** No colours, fonts, line weights or themes per view. Styling is the design system's; the only per-view state is positions and annotations.
- **An arrow-head zoo.** One arrowhead. Direction is the only thing an arrowhead encodes. Relationship type is encoded by the relationship's label glyph and, where relevant, by not drawing the edge at all (`supports`, `owns`).
- **Layer/grouping boxes drawn by hand.** Grouping is structural (`parent_id`) or by query (lanes by capability). If you want a box around three systems, they need a shared capability or parent — otherwise the box would be a fact with no provenance.
- **Diagram export as the deliverable.** PNG/PDF export exists (with the diff legend and ref stamped on it), but the URL is the deliverable; the export is a courtesy.
- **A maturity heat-map.** See ADR-000 preface #6. Health chips (§3.1) are derived from facts; a maturity score would be an opinion without a source.

---

## 10. Decisions recorded

Raised as open items in the first draft; resolved by the product owner and now binding:

1. **`user_preferences` is its own table, keyed on `user_id`**, not folded into `members`. Preferences belong to the person and follow them across organisations; `members` is per-organisation and would duplicate them. Added in the first UI migration (SPEC §3.2).
2. **Staleness and confidence thresholds are global for v1**, in one config module (§8.9). Per-model settings, if ever wanted, are a settings row plus a lookup, not a refactor.
3. **Unresolved comments do not block a merge** (§7.3). A gate needs an explicit mechanism and is a separate decision if it ever comes up. ADR-006 unchanged.
4. **"Planned replacement" requires a retract delta** in the same approved change (§3.1). A new system beside an ageing one is not a replacement. With no retract delta, the exposure chip is shown, not weakened.
