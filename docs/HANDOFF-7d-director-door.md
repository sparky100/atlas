# Handoff — Screen 1: Director front door (direction 1b)

**Reviewed 2026-09-08.** Corrected against the codebase after the first draft: `lifecycleTone.ts`'s real path, the actual eight capability-map sectors, real design-token names/values, and "12 tiles" reframed as typical rather than fixed. See the review notes inline, marked ✅/⚠️/🆕 against each claim.

For prompt 7d. Design intent first, then the spec. Nothing here adds a data-model concept: elements are capability / system / container / component / actor; relationships are supports / uses / owns / flows_to. ✅ (`docs/SPEC-data-model.md` §3.1)

## Intent

A director opens this a few times a quarter and must answer three questions in ten seconds: where are we weak, what's changing, what's recent. So the screen is one vertical read in that order, with no side column competing for the first glance.

The capability map is the page, not a thumbnail. Weakness is a property of the map, so the map is where it is shown — level-1 tiles at full width, exposed ones enlarged and carrying the name of the system that exposes them. A director should be able to say "Revenues & Benefits, because Northgate Revenues is retiring" without opening anything.

Changes are a dated table, not cards: status, what it touches, target date, sorted by target date ascending. A director's question about a change is "when", so the date column is the one right-aligned, monospaced, scannable column.

Versions are three stamps, newest first, with the commit count since the previous tag — enough to know whether the picture has moved since the last committee paper. 🆕 The commit count is the `depth` difference between the two tagged commits (`commits.depth`, SPEC §3.4) — no diff walk needed; see "Data" below.

Read-only by construction. No branch selector, no inline edit, no add control anywhere on the page. One search box.

## Layout (desktop, 1240 content width)

1. **Header bar** — brand, account, Director/Architect switch (segmented). No sidebar *of the old kind* on this door — this refers to a content sidebar competing with the vertical read (the architect door's three-column dashboard, §3.2), not to the persistent model-navigation rail (`ModelNav`, UI-principles §2.0) every model route already carries; that rail stays. The Director/Architect switch itself stays where it already lives today, in the page's own title row (`HomeModeSwitch`) rather than migrating into the app-wide header component every unrelated route also renders — moving it there is a larger, unrequested refactor, not part of this screen.
2. **Title block** — org · model · `main` · as-at date as an overline; model name at the largest step in the existing type scale (`--text-3xl`, 32px — there is no 40px step, and Barlow Condensed is not part of this product's font stack, `--font-sans`/`--font-mono` only, tokens.css; §8.1 is one scale, not a per-screen exception); search box right-aligned, max 420px, single field, placeholder "Search a capability, system, or actor…".
3. **"Where are we weak"** — section rule with heading, then two chips stating the counts in words ("3 capabilities exposed", "1 with nothing recorded"), then a right-aligned "Open capability map →" link.
   - Tile grid, 4 columns, 14px gap.
   - Exposed and unrecorded tiles come first, at 104px min height, blueprint-framed with corner marks, carrying: 3px status bar, capability name (16px condensed), the exposing system(s) and their lifecycle status, and a footer count ("5 systems · 1 exposed").
   - Healthy tiles follow at 78px, hairline border, no corner marks: status bar, name, system count.
   - 🆕 A capability map is typically 8–12 level-1 capabilities per the content-authoring guideline (`content/capability-maps/README.md`), not a fixed count — the grid renders however many level-1 tiles the map actually has (`computeCapabilityMapTree`'s own `l1` array, keyed off real `parent_id` structure), and reflows the same way at 6 or at 20.
4. **"What's changing"** — 1fr column, section rule, heading plus "8 open · next target 29 Sep 2026".
   - `.table`: Change (44%) / Status / Touches / Target. Status is a chip with a dot plus the status word. Target right-aligned monospace. Sorted by target date, nulls last.
5. **"What's recent"** — 300px column beside the table. Three plates; the newest is blueprint-framed with corner marks, the others hairline. Each: tag name (17px condensed), "tagged {date} by {person} · N commits since {previous tag}".

## Colour rules

Semantic only. Chrome is the steel accent; colour on content means lifecycle or exposure and nothing else.

| Meaning | Light | Dark | Source |
| --- | --- | --- | --- |
| no known exposure / approved | `--status-ok` #009e73 | #5fd3a9 | tokens.css |
| lifecycle exposure / stale | `--status-warn` #e69f00 | #f3c64c | tokens.css |
| proposed, in_review, replacement planned | `--status-info` #0072b2 | #7fbde9 | tokens.css |
| nothing recorded | `--status-neutral` #8a93a1 | #6b7585 | tokens.css |

✅ These four token names and hex values are exact (both light and dark rows checked against `src/ui/styles/tokens.css`).

Lifecycle → tone is `src/ui/elements/lifecycleTone.ts` ⚠️ (not `contracts/` — it's a UI-layer module, `LIFECYCLE_TONE`), and the mapping is exactly: planned=info, active=ok, retiring=warn, retired=neutral.

A capability's exposure tone is `computeExposureTone` (`src/db/modelHome.ts`), evaluated per capability. 🆕 Implements UI-principles §3.1's planned-replacement rule in full, not the coarser "always warn" placeholder the U3b sprint shipped:

- `warn` — the capability has a supporting system that is `retiring`/`retired` with no planned replacement.
- `info` ("replacement planned") — every exposed supporting system for this capability has one: an `approved` (in-delivery — merging is what marks a change delivered, ADR-006) change branch that both adds a new system supporting this same capability and retracts the exposed one, within that branch's own delta history.
- `ok` — no supporting system is `retiring`/`retired`.

The tile copy must say which system, and for `info`, that a replacement is planned — the coarseness (branch-level evidence, no explicit "this delta replaces that one" link in the data model) is visible in the copy, not hidden behind a calm colour.

Never colour-only: every status dot sits beside its status word, and every exposed tile names its cause.

Contrast: accent text at label size uses `--accent` at normal weight — ⚠️ there is no `--color-accent-700`/`-700`-suffixed token in this product; the token system has no numeric-suffix variants at all (only `--accent` and its dark-mode remap). Muted metadata uses `--text-muted` (light `#5b6472`, ~74% ink on white; dark `#9aa4b4`); fainter metadata uses `--text-faint`.

## Data

- Counts and in-flight statuses as `useDirectorHome`: in flight is `proposed | in_review | approved`; `draft` is excluded from the list (it stays in the headline open-changes count).
- Versions: three most recent tags, newest first. 🆕 Commits-since-previous-tag is `tags[i].commit.depth - tags[i+1].commit.depth` — `commits.depth` (SPEC §3.4, "1 + the parent's depth; 0 for a model's genesis commit") is already a stored, monotonic count of a commit's own ancestry length on `main`, so the difference between two commits on the same branch is exactly the number of commits between them. No diff walk, no new stored field — one extra `commits` read for each tag's own commit row.
- Target date is a change-branch's own top-level column (`branches.target_date`, `date`, nullable — `supabase/migrations/20260906160000_branches_change_metadata.sql`), ⚠️ not an attribute; if absent, render `—` in the Target column rather than omitting the row, and sort nulls last.
- "Touches" is the count of distinct subjects (elements or relationships) this branch's own deltas touch — a cheap `deltas` count per branch, not the change page's own full `affectedCapabilities` resolution (`src/db/changeSummary.ts`), which folds the branch's as-is/to-be heads and is too expensive to run once per row in a list.
- Staleness threshold 12 months and confidence bands from `contracts/thresholds.ts` (not surfaced on this door, but the as-at line is what a director judges freshness by). ✅ `STALE_AFTER_MONTHS = 12`, confirmed.

## Empty state (new model)

Four dashed placeholder tiles at 55% opacity where the map would be, then "The map is empty" with one sentence explaining that exposure, changes and versions all read off the map, then the only action: a primary "Seed a capability map" button beside a sector-template select. 🆕 The real sector list (`content/capability-maps/`, eight sectors, matching folder names exactly) is: **Electricity network, Higher education (HEI), Housing, Local government (England), Local government (Scotland), NHS, Public body, Utility** — not the three-sector list the first draft named (which also incorrectly folded "housing" and "local government" into one entry). No secondary actions, no empty change or version panels.

## Mobile (390)

Same order, single column. Title block loses the as-at line into a shorter meta line. Search full width. Exposed capabilities become rows: 3px status stripe, name, cause on the right — healthy ones collapse behind "All N capabilities →". Changes show the four nearest targets plus "All N changes →". Versions show the newest stamp only.

## Dark mode

Token remap only, no layout change — ⚠️ the first draft's remap table didn't match the real tokens; the actual dark-mode values (`src/ui/styles/tokens.css`, both the `prefers-color-scheme` block and `[data-theme='dark']`) are:

| Token | Dark value |
| --- | --- |
| `--bg` | `#0f1115` |
| `--surface` | `#1b2029` |
| `--text` | `#e6e9ef` |
| `--border` | `#2e3644` |
| `--accent` | `#6ea0ff` |

Dividers use `--border` directly (already the dark-appropriate value in dark mode — no separate opacity calculation needed).

## Compact density

Only spacing changes, never type size (§8.3): panel padding to `--space-2`, table rows to 28px (`--row-height`), tile min heights to 84/62px. Compact matters more on the architect door than here.

## Non-goals for this sprint

- No per-tile health chip system (Coverage / Staleness / Confidence toggles) — only Lifecycle exposure is built.
- No branch-scoped to-be zoom.
- No capability map or landscape work until both doors are built and used.

## Resolved questions (were open in the first draft)

1. **Target date**: a first-class `branches.target_date` column (`date`, nullable), not an attribute — confirmed above.
2. **Exposed capability with an approved replacement**: reads `info` ("replacement planned"), not `warn` — implemented in `computeExposureTone` per UI-principles §3.1's rule, with unit tests covering both the `warn` (no replacement) and `info` (replacement found) branches.
3. **Commits since previous tag**: available without a diff — the two tagged commits' own `depth` columns, subtracted. Confirmed above.
