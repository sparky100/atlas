# Handoff — Screen 2: Architect front door (2a)

**Reviewed 2026-09-08.** Corrected against the codebase: this is explicitly framed as the next step toward UI-principles §3.2's original three-column dashboard, not a description of what's built today (today's `ArchitectHome` is a Sprint U3b subset — count-only review queue, creator-only branches, commits-only "recent," no health findings at all); bespoke pixel values replaced with real tokens or removed; the ADR-019 citation now points at a real, merged ADR. See the review notes inline, marked ✅/⚠️/🆕 against each claim.

For prompt 7d, alongside the director-door handoff. Same product grammar, different job. No new data-model concepts: capability / system / container / component / actor; supports / uses / owns / flows_to.

## Intent

The architect lives here daily, so the door is a worklist, not a briefing. Every row is a thing to pick up and every row carries an age. Where the director door states conclusions ("3 capabilities exposed"), this one states work ("4 open requests, oldest 3mo").

Four things, in the order an architect triages them: what is waiting on me (review queue), what am I part-way through (my branches), what have others changed under me (recent commits), and what is wrong with the model (health findings). Search sits with the title because for an architect it is also the create path — type a name, get no match, create the element.

Density matters more here than anywhere else. Compact is a spacing change only: rows `--row-height` (40px → 28px), panel padding to `--space-2`, tighter section rules and nav. Type sizes are identical in both modes (§8.3) — the compact frame on the board proves it. 🆕 The first draft cited "34px → 26px" for these rows — neither number is a real token (the closest is `--attribute-row-height`, 36px/26px, a different token for a different row kind). This build uses the real `--row-height` pair, 40/28, the same token the review-queue/branches rows and every other list row in the product already share — no new bespoke size introduced.

## Layout (desktop, 1240)

Header: brand, account, Density segmented control, Director/Architect switch.

Title row: org · model · `main` · date overline, model name at `--text-3xl` (32px — 🆕 the first draft said "33px," not a real token; §8.1 is one scale, no per-screen exception, same correction the director-door handoff already made), search box on the right (max 460px — ⚠️ the director door's own search box is capped at 420px; no shared token backs either number today, so this is two screens independently choosing a width, not a documented rule diverging between them — worth reconciling into one named max-width if a third door ever needs the same control) with a one-line hint under it — "Enter searches every creatable type; no match offers create".

Two columns, 1.55fr / 1fr.

**Left — Review queue** (section rule, heading, "4 open" chip, "oldest opened 3mo ago", right-aligned "Open queue →"):
row = oldest badge slot · change title (link, 500 weight) · `author · N deltas · N elements` · validation chip · status chip · age right-aligned in a 70px column. Oldest first. The oldest row carries an `OLDEST` chip in comfortable and the word `oldest` in its meta line at compact — never the amber dot alone.

⚠️ Today's built panel (`ArchitectHome.tsx`) is a bare count (`reviewQueueCount`) plus one "Oldest: opened {age} →" link — no per-item list at all, so this whole row shape is new work, not an extension of an existing list. UI-principles §3.2 already specified a fuller version of this list (below the fold today too — see §3.2's own text under "Colour rules"); this handoff is the step that actually builds toward it.

**Left — Recent commits** (main's ten most recent, as `listRecentCommits(…, 10)` — not filtered to others; own work is answered by My branches, but the panel is honest about what it lists): element-type glyph · commit message, with lifecycle values rendered as chips inside the message and relationship verbs in mono · author · age.

✅ `listRecentCommits(supabase, mainBranchId, limit = 10)` is confirmed exactly as described — main's own commits, no author filter. 🆕 "the panel is honest about what it lists" is new copy to add; today's panel is titled "Recent commits" with no such disclaimer.

**Right — My branches**: branch name · behind-main count (`behind main by 4` / `up to date`) · status chip. Includes `draft`, unlike the director door's in-flight list, because this answers "what do I still have to do".

⚠️ Today's "My branches" is scoped to `b.created_by === userId` (branches the user *created*), not §3.2's "branches where the user has commits" (which would also include a branch someone else started that this user later committed to). This handoff doesn't resolve that difference one way or the other — worth a deliberate call before building, not an accidental narrowing.

**Right — Health findings**: four plates, the first blueprint-framed. Each is a count, a phrase, and named examples so the finding is actionable without a click:
- 6 systems not linked to a capability — names three plus "+3", with "Review and link →".
- 2 capabilities with no owner — both named.
- 9 attributes stale over 12 months (`STALE_AFTER_MONTHS`) — "across 6 systems · oldest 2y".
- 0 duplicates flagged — states the reason: wired to 0 until Q1's matching pipeline populates the standing duplicates report (ADR-019).

✅ `STALE_AFTER_MONTHS = 12` confirmed (`src/contracts/thresholds.ts`). All four findings are genuinely new queries — confirmed nothing today computes any of them except the already-shipped duplicates-count-hardcoded-to-0 placeholder (`ArchitectHome.tsx`'s existing Duplicates panel, whose copy this handoff's fourth plate reuses). ADR-019 is now a real, merged ADR (see below) — the citation is accurate once it lands.

🆕 **Superseded (Sprint U4-1 B3).** Five plates now, not four — B5 added "N relationships missing a label" (`uses`/`flows_to` with no verb-phrase description) between stale attributes and duplicates. Every plate (`HealthFinding`, `src/ui/components/HealthFinding/HealthFinding.tsx`) is now: collapsed row (count, phrase, first three, "and N more" — not "+3"), a "Show all" toggle expanding to the full list paginated at 20, and (for the three element-shaped findings) a link into the browse table pre-filtered to that finding — "Review and link →" for systems-without-capability specifically also puts a `supports`-picker inline on each row there, so linking never leaves the table. "2 capabilities with no owner — both named" is also superseded: ownership now inherits down the capability tree (a capability counts as owned if it or any ancestor does — `owns` can target a capability directly, `actor→capability`, not only a system — `src/db/healthFindings.ts`), and only the *highest* unowned ancestor in a subtree is ever listed, not every descendant. When every finding is zero at once, the whole panel collapses to one "No findings." line rather than five "0 X" plates.

## Validation status and behind-main (now in scope)

Both were deferred in `useArchitectHome`; they are designed here.

✅ Confirmed word-for-word: `useArchitectHome.ts`'s own module comment names both "no validation-status-per-item, no 'behind main by N commits'" as exactly what Sprint U3b scoped out — this handoff is picking up precisely the two things that comment named.

**Validation status per queue item** — a chip between the meta text and the status chip, using status tokens and always paired with a word:
- `validates` — `--status-ok`, no conflicts, rebase clean.
- `N conflicts` — `--status-danger`, field or structural conflict against main; the count is the number of conflicting facts, not branches.
- `checks pending` — `--status-neutral`, validation has not run or is stale against the current head.
At compact density and on mobile the chip collapses into the meta line as `· 2 conflicts` / `· validates` / `· checks pending`, so it never becomes colour-only.

🆕 "N conflicts counts facts, not branches" is answerable from what already exists: `ConflictFinding.class === 'field-conflict'` (`src/engine/merge.ts`) is already one row per contested attribute/fact, per that type's own doc comment ("one finding per contested field, matching SPEC §7.4's 'one card per fact key'"). No new engine work is needed for the count itself — `findings.filter(f => f.class === 'field-conflict').length` on the existing `MergeClassification` shape. What doesn't exist yet is anything computing or displaying that count today; `MergeRequestRow.classification` is typed as a bare `Record<string, unknown>`, so this filter has to run against a real `MergeClassification`, not a pre-aggregated field on the row.

**Behind main by N** — mono text beside each of my branches: `behind main by N` when N > 0, `up to date` when 0. N is commits on main since the branch's base commit. It appears on my own branches, not on queue rows (a reviewer's judgement is the validation chip's job). At compact it shortens to `behind 4`.

## Colour rules

Identical to the director door. Semantic only; status tokens from `tokens.css`; branch status → tone from `branchStatus.ts` (draft neutral, proposed/in_review info, approved/merged ok, rejected danger — ✅ confirmed exact match, `archived` also maps to neutral though it never appears in "My branches" since that list already excludes terminal statuses). Every tone is paired with its word. Accent text at label size uses `--accent` — ⚠️ there is no `--color-accent-700` token in this product (confirmed again — still absent from `tokens.css`), same correction the director-door handoff already made.

## Empty state (new model)

Search box stays — it is the other front door. One panel: "Nothing to review yet", the four zeroes stated in one sentence, then two ways in: primary "Seed a capability map" with the sector-template select, and a line saying a system name typed above can be created directly. Below, two small plates showing Review queue 0 / My branches 0 so the layout is recognisable when it fills.

🆕 "the sector-template select" should reuse `CapabilityMapImportPanel` (`src/ui/capabilityMap/CapabilityMapImportPanel.tsx`) — the same component the director door's empty state already uses, which lists real published sectors dynamically rather than a hand-maintained dropdown (the director-door handoff's own correction for its equivalent empty state).

## Mobile (390, compact)

Single column, same order: title, search, review queue (three items, meta on a second line), my branches, health findings as count + phrase rows, then two commits. Everything else behind section links.

## Dark mode

Token remap only, as the director door.

## Non-goals

- Mentions floating to the top of the queue.
- Filtering the commit panel to other authors (the query does not, and the panel says so).
- Capability map below the fold on this door.
- Per-tile health chip toggles (that is the map's problem, once the doors are used).

## Resolved questions (were open in the first draft)

1. **Is validation run on submit, on every main commit, or on demand?** Not answered by this handoff or by anything already built — a real product decision still to make before "checks pending" can mean something specific. Flagged, not resolved.
2. **Does `N conflicts` count facts or elements?** Facts — confirmed answerable from `ConflictFinding.class === 'field-conflict'` without new engine work (see above).
3. **Should health findings be dismissible or snoozable per finding, or is a count that only clears by fixing the model the point?** Not answered here either — a real product decision, not a fact the codebase already settles.
