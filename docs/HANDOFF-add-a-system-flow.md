# Handoff — Flow: Add a system

**Reviewed 2026-09-08.** Corrections marked inline: ✅ confirmed accurate, ⚠️ corrected in place, 🆕 built new for this flow (didn't exist before this handoff). See the fact-check report in-thread for the full reasoning; this doc carries only the resulting marks and the corrected text.

For the flow prompt, alongside 7d (the two doors) and U4 (the element page). Synced against `useElementCreate.ts`, `elementSearch.ts`, `attributeSchema.ts`, `relationshipTypeRules.ts`, `delta.ts`, `HomeSearch.tsx`/`useHomeSearch.ts`, and `RelationshipAdd.tsx`/`useRelationshipCreate.ts` on 08 Sep 2026.

Prototype: `Atlas - Add a system flow.dc.html` — not present in this repository (a design-tool export, expected to live outside it); unverifiable, not corrected.

## Intent

Search is the create path. An architect (or, on a change branch, a contributor) who wants to add a system types its name into the same box they use to find one, so the cheap act is recognising a duplicate and the expensive act is creating one. ⚠️ Nothing in this flow introduces a separate "new element" screen — but it *does* ask which type to create before the create step, via a type select next to the create button (decision 3), since the front-door search box searches capability/system/actor at once and has no other way to know which the typed name should become.

Create is offered last and only once the typed name has no exact match. The near-match list exists to be read, not skipped, so each row carries the two facts that tell systems apart: who owns it and how connected it is. 🆕 This enrichment (owner, relationship count) now comes from the same `enrichElementMatches.ts` helper `ElementSearchAdd`'s own per-page control already used — extracted once `HomeSearch` needed it too.

One sheet, not a wizard, for `system` specifically. After the name, exactly two questions are worth asking at create time — what is this, and what does it support — and skipping the second is allowed because an unlinked system is a health finding on the architect door, not an error to block on. ⚠️ `capability` and `actor` (the other two types this search box can create) keep the plainer immediate-create path — `actor` has no description attribute to require (`ACTOR_ORDER` has none), and the "stops the model filling with named systems nobody can describe" reasoning is system-specific.

Provenance is written at every point a fact is asserted, including the defaults. A default that looks like an asserted fact is the failure mode this whole product exists to avoid.

## The seven steps

1. ⚠️ **The front door's search box, autofocused on the architect door.** `HomeSearch.tsx`, rendered once by `ModelHome.tsx` above both doors (not embedded in `ArchitectHome.tsx` — it's shared, though only the architect door autofocuses it, decision 2). Empty query matches nothing — `matchElements` returns `[]` for a blank or whitespace query, so there is no "everything" state and no dropdown until something is typed. ✅
2. ⚠️ **"Northg" — near matches, no exact match.** Rows: name, then `system · owner · N relationships`, then the lifecycle chip — 🆕 built to match this description exactly (`useHomeSearch.ts` now enriches its results the same way `useElementSearchAdd.ts` does; the type label from the multi-type search is folded into the same muted line). Header states plainly that nothing matches exactly; a `?ref=branch:…` front door additionally notes "Searched against main's head, not this branch" (search itself never varies with the ref). Rows do **not** say what they specifically matched on (name vs. description vs. alias) — `matchElements` doesn't expose which field matched, only the ordered short-circuit; not built, scope note only. `matchElements` checks name → description → alias in that order only to short-circuit, not to rank; cap is 8. ✅
3. ⚠️ **"Create {type} '\"Northgate\"'" as the last option, with a type select (default `system`) beside it.** `HOME_SEARCH_CREATABLE_TYPES` (`capability`, `system`, `actor`) — decision 3. No `↵`/keyboard-affordance styling built (out of this pass's scope).
4. ⚠️ **One sheet — `system` only.** Description (required, one line) and "Supports which capability?", the latter via `CapabilitySupportsPicker.tsx` reusing `useRelationshipTargetSearch` (decision 7 — the single-fixed-type, no-create-fallback picker `RelationshipAdd.tsx` already uses for an existing element's own "+ Add", not `HomeSearch`'s own multi-type door search). Primary "Create", "Skip capability" (visible only while nothing's picked yet — functionally the same action once nothing is selected), Cancel. Footer states the provenance that will be written (`manual`, the signed-in user, confidence 1.00) and which attributes are arriving as defaults, phrased per the active write branch. 🆕 On a change branch (either the active ref, or one just proposed — see step 4's branch variant below), the sheet's kicker reads "Adding to change: {title}".
5. ✅ **The new element page.** Three facts old, each with its provenance: description is `manual · just now`; Lifecycle and External say `defaulted on create`. `supports {capability}` is listed with its own provenance, because a link is a fact — 🆕 now actually written this way: `useElementCreate` appends the `supports` `relationship.create` to the *same commit envelope* as the `element.create` (decision 8), not a follow-up commit. Uses is empty and says so.
6. ⚠️ **"+ Add" under Uses.** Target picker (one legal target type for `uses` from a system: system), then — 🆕 built new — a verb-phrase stage (`RelationshipAdd.tsx`): picking a target for `uses`/`flows_to` moves to a second stage in the same overlay asking for the phrase, which `create(otherElementId, { description })` now accepts (decision 6, widening `useRelationshipCreate`). `supports`/`owns` still create immediately on picking a result — no verb phrase asked, matching their own `DIRECTION_VERB` fixed label.
7. ⚠️ **Back on the element page.** The relationship is listed with its phrase (now rendered — `RelationshipsSection.tsx` shows a relationship's own `description` when set) and a `just added` chip (🆕 — `ElementPage.tsx` now tracks which element a same-session "+ Add" targeted and passes it down as `justAddedElementId`), history gains rows from the reload, and a toast (🆕, `ElementPage.tsx`) offers "Add another {type}" — reads `location.state.justCreated` from the navigation `HomeSearch` performs on create — plus Dismiss.

## Branch variant of step 4 — 🆕 built new; this control had no branch path at all before this flow

⚠️ There is no toggle in the running app (the prototype's own control bar was a design-tool affordance) — the variant is driven by the real `?ref=` on the front door (decision 5, "create follows the active ref") and by role:

- **Ref already a change branch** (`?ref=branch:…`): the create writes there directly, same as any other `?ref=`-aware page (`useEditingBranch`).
- **Ref is main, and the signed-in member can edit main** (owner/architect, `canEditOnMain`): creates on main directly, as before.
- **Ref is main, and the signed-in member is a contributor** (`canCreateChangeBranch` but not `canEditOnMain`): 🆕 `ProposeChangePicker.tsx` — choose one of the contributor's own open drafts, or start a new one inline (`useChanges`'s own `createChange`, the same hook `ChangesView.tsx` uses) — before the create/sheet proceeds. This is the picker `roleGates.ts`'s own comment on `canEditOnMain` named as still-unbuilt ("a contributor's real path to editing is creating or opening a change branch first... that flow... still isn't built"); it now is, scoped to this control.

When the resolved write branch is a change branch, the sheet's kicker reads "Adding to change: {title}"; no synthetic `retire-northgate`-style ref chip is rendered (this control has no ref-chip UI elsewhere to match).

Lifecycle defaults to `planned` on a change branch and `active` on main — this is `defaultCreateAttributes(elementType, { onMain: branch.kind === 'main' })`, driven by `branch.kind` in `useElementCreate`, not a UI choice. ✅ The provenance line states which rule applied.

Search does **not** change with the branch. ✅ `elementSearch.ts` always reads main's real materialised head, deliberately: search-first exists to catch "this already exists in the model", and for that purpose the model is main. The front door shows a short note to that effect whenever the active ref is a branch, so a contributor mid-propose is never surprised their own unmerged addition is absent from the near-match list.

## What lands as data

- **Create**: one `element.create` with the user's per-model `manual` source and `confidence: 1`, `parentId: null` (system is top-level), attributes from `defaultCreateAttributes` merged with any provided at create time (the required description, for `system`). ✅ Commit message `Add system "Northgate"`, commit kind `manual`, on main or the resolved write branch.
- **Capability pick**: a `relationship.create` of type `supports`, system → capability, 🆕 riding in the *same* commit as the create (`useElementCreate`'s `supportsCapabilityId` option) — C9 requires only that both endpoints exist in the *resulting* head, which a same-commit pair satisfies.
- **Verb phrase**: stored as the `uses` (or `flows_to`) relationship's own `description`. ✅ There is no verb field in the contract (`UsesAttributes`/`FlowsToAttributes` are both `{ description?: string }`), so the label is "Verb phrase" and the sheet says where it goes. 🆕 `useRelationshipCreate.create` now takes an optional `attributes` argument to carry it — previously the hook had no way to write anything but `owns.primary`.
- **Confidence**: every fact in this flow is human-asserted through the manual source, so all of them are 1.00 — including the create-time defaults. ✅ Confidence dots read full; the honest signal about a default is the words "defaulted on create", not a lowered score.
- **Owner**: not asked at create time. ✅ `owns` is inbound from an actor with `maxPrimaryPerTo: 1`, so it belongs on the element page's own group, not in this sheet.

## Code change this flow required

✅ Both changes below landed as described, plus the further widening the original doc didn't call out:

- `useElementCreate.create` widened to `create(name, { attributes?, supportsCapabilityId? })`, merging `attributes` over `defaultCreateAttributes` and appending a `supports` `relationship.create` to the same envelope when `supportsCapabilityId` is given — the required description rides in the create's own attributes (C4 forbids a follow-up `element.update` in the same commit), one commit either way.
- 🆕 (not named in the original doc) `useRelationshipCreate.create` widened to `create(otherElementId, attributes?)` — needed for the verb phrase, which had no write path at all before this flow.
- 🆕 (not named in the original doc) `enrichElementMatches.ts` extracted from `useElementSearchAdd.ts` so `useHomeSearch.ts` could reuse the same owner/relationship-count enrichment for step 2's rich rows.

## Colour, mobile, dark

Semantic colour only, as the doors: lifecycle chips from the status tokens (`active` ok, `planned` info), accent for chrome and for the emphasised words in the sheets' explanatory notes. The `just added` chip is info, never a celebration colour. ✅

Mobile (390): the create sheet, the propose-a-change picker, and the post-create toast are pinned full-width at the viewport's bottom edge below 480px (CSS-only — same DOM, no separate mobile component), with stacked full-width actions. The near-match rows keep the same content at every width (no separate two-fact mobile variant was built — the row already reads at 390px without dropping the lifecycle chip).

Dark mode is a token remap only, as elsewhere. ✅

## Open questions

1. Should the verb phrase be a real field on `uses`/`flows_to` (and `supports`) rather than the description? Still open — the widened `create()` writes it to `description`, matching the contract as it stands today.
2. Skipping the capability leaves a health finding — should the toast at step 7 say so when it happened, or is that nagging? Still open; not built.
3. On a change branch, should step 3's create option warn that the system will not appear in search for others until merge? Still open; not built (the branch-ref note at step 1/2 covers the *searcher's* side of this, not the *creator's*).
4. Does the create sheet need a source picker (document, spreadsheet, interview) rather than assuming `manual`? Still open; every fact in this flow is manual by construction.
