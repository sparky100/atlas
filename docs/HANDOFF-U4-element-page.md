# Handoff — Screen 3: Element page (3a)

**Reviewed 2026-09-08.** Corrected against the codebase: the provenance column reflects UI-principles §4.3's amendment (badge + tap/focus card everywhere; the element page additionally gets an always-visible inline "source kind · age" line — reference and confidence-as-a-number stay in the card, not fully un-gated as this draft first assumed); the newly-created-system defaults now match `defaultCreateAttributes`'s real on-main behaviour (ADR-019's own fix: `active`, not `planned`, for a system created directly on `main`); `--color-accent-700` corrected to `--accent`; a few smaller factual fixes marked inline. See ✅/⚠️/🆕 against each claim.

For prompt U4. Design intent first, then the spec. Synced against `attributeSchema.ts`, `relationshipTypeRules.ts`, `sources.ts` and `thresholds.ts` on 08 Sep 2026.

## Intent

This page is the unit of trust, so provenance is the layout problem, not a detail. Every fact gets a fixed third column that answers "where did this come from" in the row itself — source kind and age, with no click and no hover; the reference string and confidence as a number stay one tap/hover/focus away in the provenance card, per UI-principles §4.3's amendment (**⚠️ corrected from this draft's original "no click and no hover" for all four pieces** — that would have reversed an already-shipped, already-specified interaction pattern used everywhere else in the product; what's actually amended is narrower and element-page-specific, see "Attributes" below).

Confidence is deliberately monochrome. It is a count of how well-attested a fact is, not a judgement of whether the fact is good news, so it must not borrow the status colours that mean lifecycle and exposure. Age is the only coloured thing in the provenance column, and only past `STALE_AFTER_MONTHS` (12), where it turns amber and gains the word "stale" — never colour alone.

Relationships are grouped by type and ordered the way a reader asks: what does it support, what does it use, who owns it, where does data flow. Each group has its own add control, because "add a relationship" is never a generic act — the group determines the legal target type. Groups the element type cannot legally have are not drawn at all.

The newly created system is not a broken version of the populated one. It states what it has (a name, plus the two required attributes the create defaulted) and what it lacks, and it does not pretend to be complete.

## Header

Type glyph · name (36px condensed) · lifecycle chip · type chip. Description under it at 14px, max 720px. Then a provenance line for the description itself, plus any aliases ("also known as: …"). Right side: `Edit`, element id and created date in mono. Breadcrumb above: org › model › ref chip › parent capability › element.

✅ Aliases ("also known as") already render today (`ElementHeader.tsx`), each with its own provenance badge — `aliases` rows already carry their own `source_id`/`confidence` per row (`supabase/migrations/20260906071500_sources_and_aliases.sql`), not inherited from the element. This part of the header is already built, not new work.

## Attributes

Section rule: heading, "7 of 7 recorded · 2 stale", a right-aligned column legend ("Source · reference · age · confidence") and "* required".

One row per attribute in `SYSTEM_ORDER` order, no re-sorting: Lifecycle*, Vendor, Description, External*, External organisation, Introduced, Planned end. Required fields carry an amber asterisk. Grid is 150px / 1fr / 300px.

✅ `SYSTEM_ORDER` confirmed exact — same order, same two required fields (Lifecycle, External), `src/contracts/attributeSchema.ts`.

Provenance column, per UI-principles §4.3's amendment — **⚠️ not all four pieces are always-visible; only the first two are inline without interaction**:
1. **Source kind** — bordered glyph + word, from `SOURCE_KINDS`: document, spreadsheet, interview, capture_job (displayed "capture job"), template, manual, merge_resolution. Always visible, inline (§4.3 amendment). 🆕 The "capture job" (with a space) display label doesn't exist anywhere yet — today `capture_job` only ever renders as a glyph (⚙) or, in one place, literally with its underscore intact in an HTML `title` attribute. This label needs building, not just reusing something that already renders that way. 🆕 `SOURCE_KINDS`'s own file order is `document, spreadsheet, interview, capture_job, template, manual, merge_resolution` — matches the set exactly; listing it here in the same order for clarity.
2. **Age** — `< 1mo` / `Nmo` / `Ny`, matching `formatAge`. Past 12 months: amber plus the word "stale". Always visible, inline (§4.3 amendment). ✅ Format confirmed exact. ⚠️ There is no single shared `formatAge` export today — it's reimplemented near-identically in at least four places (`ProvenanceBadge`, `ProvenanceCard`, `HistoryTimeline`, `ArchitectHome`), each built on the shared `monthsSince()` (`src/contracts/thresholds.ts`). Building this page is a natural point to extract one shared function those four call sites (and this page) all use, rather than a fifth copy.
3. **Reference** — the actual source: "Asset register 2025.xlsx", "EA review 12 Jun 26", "Contract N-04187", "CMDB sync 04 Apr 26". **Stays in the provenance card** (tap/hover/focus), per §4.3's amendment — a source kind without a reference is not enough in the card's own content, but the row itself doesn't show it inline.
4. **Confidence** — three monochrome squares, filled per band from `thresholds.ts`. The three squares are the existing badge's own dots, already always-visible (they were never hover-gated even before this amendment); **confidence as a number** stays in the card. ✅ Band boundaries confirmed: `CONFIDENCE_HIGH = 0.9`, `CONFIDENCE_MEDIUM = 0.7`.

A legend sits under the list stating what each confidence band means in words (asserted by a person or signed document / from a document or return, unverified / inferred by a capture job) and that amber age means older than 12 months. An unset optional attribute renders "— not applicable" or "— no fact recorded" with an empty provenance column, never a fabricated source.

## Relationships

Heading with "14 across 4 types". Then one group per legal type for a system, per `relationshipTypeRules.ts`: `supports` → capability, `uses` → system, `owns` (inbound, shown "owned by") ← actor, `flows_to` → system.

✅ Confirmed exact and complete for `system` — no other legal relationship type/direction exists for it in `relationshipTypeRules.ts`. 🆕 `owns` also carries `maxPrimaryPerTo: 1` (a system has at most one *primary* owner) — not mentioned in this draft; worth stating alongside the group if the primary-owner star matters to this page's design.

Group header: verb in condensed uppercase · count and target type · right-aligned "+ Add {verb}". Rows: type glyph · target name (link) · the verb phrase in mono ("posts journals to", "migrates accounts to", "nightly extract") · optional chips (primary owner, "added in change") · the relationship's own provenance, right-aligned. Relationships carry provenance exactly as attributes do — a link is a fact.

Structure section states plainly when no containers or components are recorded, with "+ Add container".

## Side column

- **Changes touching this** — one plate per change, newest/soonest first: title, status chip, and what it does to *this element* in mono ("retracts this system · adds flows_to Civica OpenRevenues · target 12 Oct 2026").
- **Decisions** — ADR reference, status chip, date, forum, supersession. ⚠️ The `decisions`/`decision_arguments`/`decision_links`/`assumptions`/`evidence` tables (ADR-013, SPEC-data-model.md) are **not migrated yet** — today's element page shows a plain placeholder here ("Decisions aren't built yet — see Sprint D1"). This section is real, substantial new work (schema + UI), not a redesign of something existing.
- **History** — age-stamped rows: what changed, then who and via what source kind. Attribute names must exist in the schema. ✅ Already built (`HistoryTimeline.tsx`).
- **Documents** — source-kind glyph, document name, year.
- **Comments** — author and age, then the comment; "Add comment" full-width secondary. ✅ The backend for this now exists (Sprint M1a — `comments`, `comment_mentions`, `notifications`, resolve/mention/realtime, all shipped and tested); today's element page still shows a placeholder here ("Comments aren't built yet — see Sprint M1"), so wiring the UI to the real backend is the remaining work, not building the backend too.

## Newly created system (name only)

Header: name, type chip, and a provenance line reading "manual · A. Whitfield · created just now".

One framed panel: "One asserted fact: its name", then the honest explanation — Lifecycle and External are required, so `defaultCreateAttributes` filled them with **active** and **No** — 🆕 **corrected from `planned`/`No`**: `defaultCreateAttributes` (ADR-019's own fix, `src/contracts/attributeSchema.ts`) now defaults a system's `lifecycleStatus` to `active` when created directly on `main` (an architect quick-adding a system to main is recording an estate that already exists) and to `planned` only when created inside a change branch (proposed, not live yet). This "name only" scenario describes a system created directly on main, so its Lifecycle default is `active`, not `planned` — the text and the shown value both need to say `active`. `isExternal` still defaults to `false` ("No") in both cases, unchanged.

Attributes: "2 of 7 recorded · both defaulted on create". The two defaulted rows show their values with source `manual`, reference "defaulted on create", and lowest confidence. The next two offer "+ Record"; the remaining three collapse into "+ 3 more · external organisation, introduced, planned end".

Relationships: all four legal groups drawn empty, each showing its legal target type and its add control, with the note that a system with no capability is a health finding on the architect door.

Changes / Decisions / Comments: two small plates stating none, and that it was created directly on main.

## Colour rules

Same as both doors. Status tokens carry lifecycle and change status only. Confidence is monochrome. Amber age is the single exception and always paired with "stale". Accent text at label size uses `--accent` — ⚠️ there is no `--color-accent-700` token (confirmed absent again — only `--accent`/`--accent-fg` exist), same correction both other handoffs already made.

## Mobile (390) and dark

Mobile: breadcrumb shortened, header stacked, then three attributes with provenance on their own line and "All 7 attributes →", then relationship groups with two rows each and per-group "+ Add", then changes. Dark mode is a token remap only.

## Resolved questions (were open in the first draft)

1. **Provenance reference strings — canonical short form or free text?** Not settled by anything in the codebase today; a real product decision, not a fact to look up. `source_ref` (`sources.ts`/`facts` schema) is a plain `text` column with no format constraint, so either answer is representable — this is about editorial convention, not data model.
2. **Should a relationship inherit the confidence of the weaker end, or carry its own only?** Drawn as its own, and that already matches the schema: a relationship's provenance (`source_id`/`confidence`) is its own row, structurally independent of either endpoint's own attribute provenance — "carry its own" isn't a new design choice, it's just naming what the data already does.
3. **Hosting and Annual cost were in the first draft and are not in `SYSTEM_ORDER`.** Confirmed — they are not in the schema. If wanted, they belong in `src/contracts/attributeSchema.ts`'s `SYSTEM_META`/`SYSTEM_ORDER` first, with a migration-free contract change and the usual round-trip test (rule 1) — this page cannot show a fact the schema has nowhere to put.
4. **Should aliases also carry provenance per alias?** They already do — see "Header" above. Nothing further to design here; this is already-shipped behaviour, not an open question.
