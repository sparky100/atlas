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

## Amendment (2026-11-13, `20261113010000_stale_threshold_and_nudges.sql`): the threshold is per organisation, staleness covers every element, owners are nudged

- **Threshold.** `STALE_AFTER_MONTHS` (12) is now only the default. `organisations.stale_after_months` (1–60) holds each organisation's own, set by an owner or architect through `atlas.set_stale_threshold` (Organisation settings → Out-of-date information). Every staleness check takes it: the provenance badge (via `StaleAfterMonthsContext`, provided once by `ModelRouteGate`), the My work finding, the Elements list, the finding reports and the Ask Atlas tools.
- **Every element type.** The finding used to look at systems only. It now covers every element, because "Still accurate" is offered on every element. Relationships stay out until they can be confirmed (see Scope below): a flag nobody can clear is not a finding.
- **`$exists` is ignored.** The finding used to count the `$exists` fact, which "Still accurate" never re-asserts (decision above), so a confirmed element stayed on the list for ever. Both the TypeScript rule (`computeStaleAttributesFinding`) and its SQL twin (`atlas.stale_elements`) skip it.
- **Nudging owners.** On the stale list an owner or architect can press **Email owners a reminder**. The `send-review-email` edge function (`staleNudge` mode) emails each person the elements they own that are stale, each linking to that element; opening a link changes nothing, only the person's own **Still accurate** does. An owner is the member behind an actor with a business or technical `owns` edge to the element (the actor's `memberId`). **Fallback:** an element with no owner who is a current member goes to the organisation's architects (or its owners when it has no architect), so an unowned stale element is never silently dropped. Nobody is emailed twice in a week or twice in a day; `stale_nudges` is the claim, and `user_preferences.email_on_stale_nudge` is each person's opt-out (Profile). It is a button, not a schedule: nothing sends it automatically.

## Consequences

- **What the provenance badge shows.** It shows the confirmation — ✓, today, confidence 1 — rather than the original source. The original source (a spreadsheet, an interview) is still in the fact's history, one delta back, never edited or deleted. This is a deliberate trade: the badge answers "how current is this?", and history answers "where did it first come from?".
- **Merging.** A confirmation made inside a change merges like any other edit. If main changed the same attribute meanwhile, that's an ordinary field conflict.
- **Deleting.** Removing a confirmation means retracting nothing: a later edit or a later confirmation supersedes it, the same as any fact.
- **Scope.** Elements only. Relationship attributes (a `supports` edge's fit, say) have no confirmation yet; they can be added the same way when there's a need.
