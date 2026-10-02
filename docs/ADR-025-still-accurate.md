# ADR-025: "Still accurate" — recording that a value has been checked

**Status:** **Accepted 2026-10-02** — option (a), chosen by the human; built as sprint F12 step 3 (`docs/PLAN-2026-10-recommendations.md`). Migrations `supabase/migrations/20261004010000_source_kind_attestation.sql` and `20261004020000_attestation_sources.sql`.
**Depends on:** ADR-007 (provenance: every fact carries a source and a confidence), SPEC §4 (the delta format), §3.6 (`sources`), rules 4–5 of `CLAUDE.md` (every fact through a delta; nothing updated in place), `src/contracts/thresholds.ts` (`STALE_AFTER_MONTHS`).

## Context

Staleness is per fact: a fact is stale once its date — its `effective_date`, else the commit time of the delta that asserted it — is more than `STALE_AFTER_MONTHS` old. The provenance badge colours it, and the architect door's health finding counts stale system facts.

A value can be old and still right. Until now, the only way to make a stale fact current was to change it, so an owner who checked a system and found everything correct had no way to say so: the warnings stayed, or someone edited a value to an identical one through a form that refused to save an unchanged value.

F12 needs "the owner confirms this is still true", and that confirmation has to live inside the rules: every fact through a delta, nothing updated in place.

## Options

- **(a) Re-assert.** A confirmation is an `element.update` delta per current fact, re-stating the current value unchanged, under a source of a new kind, `attestation`. Staleness, which reads the newest fact, resets on its own. One mechanism, and provenance shows who confirmed and when.
- **(b) A separate `attestations` table**, read beside `facts`. A simpler engine change, but staleness then has two inputs, and an attestation becomes a fact that lives outside the delta model.

## Decision

**(a).** "Still accurate" on an element writes one commit containing one delta per current fact of that element. The existence fact (`$exists`) is the one exception, because existence isn't a value to re-assert. Each delta:

- has the same `value` as the current fact, and `previousDeltaId` = that fact's delta (C6 as usual);
- is `element.update` for a core attribute or a promoted column (`name`, `parentId`), and `element.update_custom` for an org's custom attribute;
- carries **no `effectiveDate`**, so the fact's date becomes the confirmation's commit time;
- carries confidence 1: a person has just checked it.

All the deltas share one fresh `sources` row of kind **`attestation`**, named "Confirmed still accurate — {element}", with `captured_at` = the confirmation date and `user_id` null. The check `(kind = 'manual') = (user_id is not null)` keeps every non-manual source user-less, and the confirming person is already the commit's author.

**The engine needed no change.** `element.update` already applies a same-value update as a real fact, re-pointing the fact at the new delta. A same-value update was only ever refused by the edit forms, which skip an unchanged field, never by `fold`, merge or `atlas.commit_deltas`.

**Values are not re-validated.** Each is the element's own current value, and a value an edit form can't change (for example a value stream's `inactive`) must still be confirmable.

**Who can confirm:** the same people who can edit the element on the branch in question (`canEditBranch`): an owner or architect on main, a contributor inside their own draft change. `sources_insert` admits `attestation` for owner, architect and contributor, like the other kinds a person can create.

**Where:** a **✓ Still accurate** button beside **✎ Edit** on the element page, and per row in the Elements grid while it is in edit mode.

## Consequences

- **What the provenance badge shows.** It shows the confirmation — ✓, today, confidence 1 — rather than the original source. The original source (a spreadsheet, an interview) is still in the fact's history, one delta back, never edited or deleted. This is a deliberate trade: the badge answers "how current is this?", and history answers "where did it first come from?".
- **Merging.** A confirmation made inside a change merges like any other edit. If main changed the same attribute meanwhile, that's an ordinary field conflict.
- **Deleting.** Removing a confirmation means retracting nothing: a later edit or a later confirmation supersedes it, the same as any fact.
- **Scope.** Elements only. Relationship attributes (a `supports` edge's fit, say) have no confirmation yet; they can be added the same way when there's a need.
