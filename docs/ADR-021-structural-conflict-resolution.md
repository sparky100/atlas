# ADR-021: Structural-conflict resolution on refresh — prepare, replay, decide; and the final merge folds to the branch head

**Status:** Accepted 2026-09-11 — design (c), with the two amendments in §2a (issue #76, Prompt 7b step 4)
**Numbering:** ADR-020 is already taken in `docs/ADR-000-foundations.md` (capability `code`, Sprint U4-2a), so this is ADR-021. `ADR-000`'s index should gain a one-line pointer to this file.
**Depends on:** ADR-002 (deltas, commits, merge commits with two parents), ADR-005 (conflict classes), ADR-006 (review queue; refresh), ADR-007 (`resolved_conflicts`), `docs/SPEC-data-model.md` §5.2 (C8, C13–C17), §6.2 (`fold`), §6.6 (head == fold), §7.2–§7.5, `src/engine/deltas.ts` (`apply`/`fold`), `src/engine/head.ts` (`foldFromGenesis`), `src/engine/branch.ts`, `src/engine/merge.ts`, `src/engine/mergeResolution.ts`, `src/db/mergeRequests.ts` (`pushRefresh`, `mergeApprovedRequest`), `src/engine/splitClosure.ts`, `supabase/migrations/20260911020000_split_branch.sql`.

This is a design record, not code. Where it names a delta sequence it names the exact kinds and `previousDeltaId` links, so the builder and its golden tests can be written from it directly.

---

## 1. Context

### 1.1 What refresh and merge actually compute today

`foldFromGenesis` (`src/engine/head.ts`) folds a `merge`-kind commit `c` as SPEC §6.2 says:

```
H = fold(c.parent)                                            // first parent
for c2 in topo(exclusive(c.mergedBranchHead, c.parent)):      // the other side's commits
  for d in c2.deltas (seq order): apply(H, d)                 // applied unconditionally
for d in c.deltas: apply(H, d)                                // this commit's own deltas — last
```

Two commits are merge-shaped, and they point in opposite directions:

| Commit | `parent` | `mergedBranchHead` | "Other side" replayed | Own deltas |
|---|---|---|---|---|
| **Refresh** on a change branch B (`pushRefresh`) | B's head ("ours") | main's head ("theirs") | main's commits since the merge base | field-conflict resolutions |
| **Final merge** on main (`atlas.merge_branch`) | main's head | B's head | **B's own commits**, refreshes included | none (zero deltas, SPEC §7.1) |

`apply` (`src/engine/deltas.ts`) is strict on purpose: `element.update`/`retract` of an absent subject throws; `relationship.create` with an absent endpoint throws (C9); `element.retract` with a live relationship throws (C8); a second primary `supports`/`owns` throws (C17). Every one of these is a defence the codebase relies on and none of them is negotiable here.

### 1.2 The failure, in both directions — and at the final merge

Issue #76 reproduces one case: **B retracts `E`, main later updates `E`; refresh replays main's `element.update E` onto a head where `E` is already gone; `apply` throws before any resolution delta (which would come last) can run.** The issue notes the reverse direction (main retracts, B modifies) refreshes fine, because replaying a retract onto a head where the element still exists succeeds and an own-delta `element.restore` can follow.

That observation is true of the refresh and **false of the final merge**, and the final merge is the fold that matters most — it is the one `atlas.merge_branch` materialises, hashes into `commits.head_hash`, and that `rebuildHead`, the nightly integrity job and tag creation (SPEC §6.6) recompute from genesis:

- *Main retracts `E`, B modifies `E`, refresh resolves "keep element" with an own `element.restore E`.* Final merge fold: `H = fold(main.head)` has no `E`; replay B's exclusive commits in topo order — B's original `element.update E` comes **before** the refresh commit carrying the restore — throws. The refresh succeeded; the merge's own fold is impossible.
- *B retracts `E`, main creates relationship `R(E)` (dangling endpoint), refresh resolves "keep retraction" with a cascade `relationship.retract R` in the refresh commit.* Final merge fold: `fold(main.head)` has `R` live; replay B's original `element.retract E` (earlier commit) — C8 throws — before the refresh commit's `retract R`.

So the problem is not "refresh applies theirs before resolutions." It is more general: **a merge commit's fold replays the other side's deltas in commit order, and a resolution recorded in a later commit can never protect an earlier conflicting delta, on either side.** Any design that only fixes the refresh leaves the final merge — the only fold anyone ever hashes — broken for the same conflicts.

Today this is masked, not absent: `mergeApprovedRequest` sends `fold(branch.head)` as main's new projection with `headHash(fold(branch.head))`, and `atlas.merge_branch` stores that. `foldFromGenesis(mergeCommit)` would compute something different (or throw) — the nightly integrity job would raise a `HASH` incident on the first structurally-resolved branch ever merged. The two computations agree today only because nothing structural has ever been resolved.

### 1.3 Three smaller findings the fix has to carry

1. **Converged retractions throw today.** Both sides retract `E` (no conflict class; `classifyMerge` reports nothing): refresh replays main's `element.retract E` onto a head where B already removed it — throws. A plain refresh with zero conflicts fails. Not yet reported from use because two people retiring the same system in the same week hasn't happened; it will.
2. **`classifyMerge` misses half of C17.** `structural:cardinality` is detected only for a same-role `owns` edge created on both sides (Prompt 7k item 2 generalised the check itself from a single `primary: true` flag to `role`, without closing this gap). `supports.role = 'primary'` (Sprint U4-1 B4, enforced by `apply` on every fold) is not classified at all, and neither type is classified when one side *promotes an existing* relationship while the other creates one that collides (a primary `supports`, or an `owns` edge in the same role). The resolution builder consumes findings; a missing finding is a refresh that throws with no card to act on.
3. **`buildSplitDeltas` replays verbatim, in original order.** After a structurally-resolved refresh, a branch's own delta list contains the conflicting delta first and its resolution later (the pattern in §1.2). Replaying that list over the merge base (`atlas.split_branch`) hits the same order problem. `computeSplitClosure`'s property test ("folding accepted ∪ pulledIn over the merge base passes C8/C9") will fail as soon as its generators include a resolved refresh.

---

## 2. Decision, in one paragraph

Two changes, one required by every candidate and one chosen among them:

1. **A merge commit whose first parent is an ancestor of its second parent folds to the second parent's state** (`fold(c) = fold(c.mergedBranchHead)`, then `c`'s own deltas — which are zero for a main merge). This is the final merge on main, whose precondition `mergeBase(B) == main.head` (SPEC §7.1) makes B's head, by construction, already contain all of main. It is exactly what `mergeApprovedRequest` already materialises; it makes `foldFromGenesis` agree with it; and it removes the final-merge half of §1.2 outright. The merge commit stays (ADR-006 rejected fast-forward *without* one; this keeps the marker and changes only how its fold is defined). **§2.1 status: Accepted and implemented** (`src/engine/head.ts`'s `foldFromGenesis`, C19, P-30, the P-2 extension — SPEC §6.2/§6.6; verified against every model on the live "Architecture" project with zero `head_hash` changes, the one live merge-kind commit being a refresh that doesn't satisfy the condition). §2's item 2 and §5 items 2–6 (C2b) remain design-only, per §2a amendment 2.
2. **Refresh is "prepare, replay, decide":** the client computes, and one new RPC `atlas.refresh_branch` writes atomically, (i) an optional *preparation commit* on the branch carrying the minimal own deltas that make main's replay applicable (restore what B retracted and main touched; retract B's own relationships to what main retracted; demote B's primaries that main's primaries collide with), then (ii) the `merge` commit that replays main and carries the reviewer's *decision* deltas (retract again, re-parent, demote, retract the losing duplicate) plus every field-conflict resolution, with `resolved_conflicts` rows for all of it. `apply`/`fold` are untouched; every delta in history was actually applied; nothing is skipped.

Design (c) below. Designs (a) and (b) are the two named in the issue; (a) is workable but changes what "the head is a function of the deltas" means, and (b) cannot express the issue's own failing case.

## 2a. Amendments on acceptance (2026-09-11)

Accepted as design (c) with two changes to the text below; where a later section still says `manual` for `P`, or lists C19 among C2b's items, this section wins.

1. **`P` is a `commit_kind` of its own: `preparation`.** Not a `manual` commit with a marker. Its own migration (an `ALTER TYPE ... ADD VALUE` in its own file, per the `genesis` precedent, then the function that uses it), a contract update to `CommitKind`, and a round-trip test — rule 1. C21 is keyed on the kind (renumbered — see amendment 3 below): a `preparation` commit may contain only the deltas §3.3's preparation table derives from the findings, and nothing else may carry them. `atlas.refresh_branch` checks that `p_prep_commit`, when present, is written with kind `preparation`, that the `merge` commit's `parent_commit_id` is that commit (adjacency), and that both share one `merge_resolution` source; `atlas.commit_deltas` accepts `preparation` on a `change` branch only when called from `refresh_branch` (never from a client directly — same pattern as `genesis`, which only `on_model_created` may insert). `describeEnvelope` gives it a fixed title shape, "Prepare refresh from main: …", and the activity feed (architect door, change page) labels it as a preparation step of the refresh that follows, never as an independent edit.
2. **C19, P-30 and the P-2 extension land now, in a PR of their own, before Sprints 7i–7k.** The fast-forward fold rule closes the latent `HASH`-incident path in §1.2 on its own and depends on nothing else here. Sprint C2b's scope is then §5 items 2–6 plus §7's tests, scheduled after 7k. `docs/prompts/atlas-prompt-pack.md`'s deferred register and SPEC §11 record both halves. **Landed** (out of the original stated order — 7i–7k had already shipped by the time this item was actually picked up; §2's item 1 note has the implementation pointer). C2b (item 2 above, §5 items 2–6, §7's tests) is still open.

Two UI-principles lines were added with this acceptance (§4.3, §5.3): the Case B `Q` default (§4.1) and the collapsed display of a restore/retract pair on the element page's supersession chain.

3. **Numbering correction, found when C2b was actually picked up (13 September):** this ADR's original draft called the `preparation`-kind-commit invariant "C18." By the time C2b was implemented, `src/contracts/delta.ts`'s `COMMIT_INVARIANTS` had already reached C1–C20 through unrelated work in between (Prompt 7k item 4's `via`/integration-platform check landed as the real C18; S1 item 11a's external-owner-role check landed as C20) — this ADR's own C19 (fast-forward fold, §2.1) was implemented under the C19 slot exactly as drafted here, since C19 was still free when §2.1 landed, but "C18" for the preparation-kind check now collides with an unrelated, already-shipped invariant. §6 below uses **C21** for the preparation-kind check throughout; every other section referencing "C18" for this purpose is superseded by this amendment. No change to the underlying rule, only to its id.

---

## 3. Candidate designs

Common notation: `O` = B's head (ours), `T` = main's head (theirs), `base` = `mergeBase(B)`. `X` = the exclusive main commits `topo(exclusive(T, O))`. A structural finding names a subject `E` (an element) or a pair of relationships.

### 3.1 (a) Resolution consulted during the fold — "discards"

The refresh commit carries a **discard set**: delta ids from `X` that the fold must skip. `fold` becomes `apply every delta of X whose id ∉ discards(c)`, then own deltas. The natural storage is what ADR-007 already has: `resolved_conflicts.discarded_delta_id`, plus a new `resolved_conflicts.commit_id` so the loader can find a commit's discards (today a row with `resolution_delta_id = null` is unreachable from any commit).

Under (a): keep-retraction (B retracted `E`, main updated it) = discard main's `update E`; keep-element (main retracted, B modified) = discard main's `retract E`; converged retract = discard main's retract; a dangling-endpoint create on main = discard main's `create R`; duplicate = one own `relationship.retract loser`; cardinality = own demote.

| Interaction | Under (a) |
|---|---|
| C8/C9/C17 in `apply` | untouched; the discarded deltas are exactly those `apply` would reject, so the strict checks stay strict |
| `head == fold(deltas)` (§6.6) | becomes `head == fold(deltas, resolved_conflicts)`; `CommitNode` gains `discardedDeltaIds`; `buildCommitLoader`, `rebuildHead`, P-2's generators, tag creation all load a second append-only table. Still deterministic and pure — but the head is no longer a function of the delta rows alone, which ADR-002, CLAUDE.md rule 4 and every test that builds a loader from a `Map<commitId, deltas>` currently assume |
| `head_hash` | unchanged mechanics; inputs grow as above |
| Rule 5 / S-10 | **violated in spirit.** Discarding main's `create R` means `R` vanishes from main's head after the final merge with no `relationship.retract` anywhere — "retiring is a retract delta" has an exception. Discarding main's `retract E` means `E` is live on main with a retract delta in its own history whose effect was voided — the `$exists` chain (S-10, P-5) no longer describes the head. Both need an ADR-002 amendment blessing "voided delta" as a third thing a delta can be |
| `resolved_conflicts` | one row per discarded delta, `resolution_delta_id` often null (the winner is an existing delta); `commit_id` column added (migration + contract + round trip, rule 1) |
| Split closure | `buildSplitDeltas` still replays B's own deltas verbatim; B's own list has no discards in it (they were main's), so keep-element (main retracted `E`, B's `update E` first) throws on replay over `main.head` — needs §5's reordering regardless |
| Final merge | needs the fast-forward rule (§2.1) regardless — discards are recorded on the refresh commit, and the final merge cannot un-apply what is already in `fold(main.head)` |
| Concurrent refresh | same as today: C13 on `(branch_id, parent_commit_id)`; one wins, the other's transaction fails whole |
| Client trust | needs a new invariant that a discarded id is (i) in `X` and (ii) explained by a finding — otherwise a client could discard any main delta, which is exactly the silent overwrite ADR-007 exists to stop; (i) is checkable server-side, (ii) only by the engine |

Verdict: mechanically the shortest sequences, but it introduces a new semantic ("this delta happened and was voided") into a model whose whole point is that the head is what the deltas say. Rejected on that ground, not on effort.

### 3.2 (b) Two-phase refresh, resolutions as additional deltas in the same merge commit

Phase one dry-runs the fold and classifies; phase two commits the merge with resolutions as own deltas. **This cannot express the issue's own failing case:** own deltas are applied *after* the other side's replay (SPEC §6.2), so no own delta can precede main's `update E` onto a head where `E` is absent. The only way to make (b) work is to let a merge commit's own deltas run *before* the replay — a `phase`/negative-`seq` convention on `deltas`, a change to `fold`'s contract that every other commit kind would inherit. That is a worse version of (c), which puts the "before" deltas in a commit of their own where the existing model already knows how to order them.

The issue's second variant of (b) — "catch the `EngineError` and exclude exactly those deltas" — is (a) with the discard set inferred at fold time instead of recorded. Inferring it makes the fold's result depend on which errors were thrown, which is neither recorded nor reviewable; rejected.

### 3.3 (c) Prepare, replay, decide — **recommended**

A refresh becomes up to two commits on B, written in one transaction by `atlas.refresh_branch`:

```
P  (kind 'preparation' — §2a amendment 1; parent = O, source = the refresh's merge_resolution source)
     the minimal own deltas that make every delta of X applicable to O
M  (kind 'merge', parent = P (or O if P is empty), mergedBranchHead = T)
     fold: replay X unconditionally (unchanged), then M's own deltas:
       the reviewer's structural decisions + every field-conflict resolution (as today)
resolved_conflicts rows: one per discarded delta, written with M, referencing deltas in P or M
```

`P` is mechanical, not a decision: it is derived from the findings alone, identically whatever the reviewer chooses. The *decision* lives entirely in `M`'s own deltas. That split is what keeps the design reviewable: a reader of history sees "the refresh restored `E` so main's edits could land, then retracted it again because the reviewer kept the retraction," with each step a real, valid, provenance-carrying delta.

The preparation rules, from the findings `classifyMerge` produces (extended per §1.3.2 and §6):

| Finding on `E` / pair | Preparation delta(s) in `P` |
|---|---|
| B retracted `E`; main updated it, or created a relationship with `E` as endpoint, or re-parented something under it (`retract-vs-modify`, `dangling-endpoint`, `dangling-parent`, retracted side = ours) | `element.restore E` (`previousDeltaId` = B's retract of `E`) |
| Both sides retracted `E` (converged existence, §1.3.1) | `element.restore E` — so main's retract can apply; nothing further |
| Main retracted `E`; B still has live relationships with `E` as an endpoint that main never saw (B created them) | `relationship.retract R_i` for each (`previousDeltaId` = `R_i`'s create) — C8 for main's replayed retract |
| Main's replay would create or promote a primary `supports`/`owns` colliding with a primary live on `O` (`cardinality`, either shape) | demote B's: `relationship.update R_o.role = 'secondary'` / `R_o.primary = false` (`previousDeltaId` = the delta currently asserting it) — C17 for main's replay |
| Duplicate relationship, field conflicts, everything else | nothing — the replay already applies |

`P` is empty for the large majority of refreshes and is then not written at all; `pushRefresh`'s one-commit shape is the degenerate case.

| Interaction | Under (c) |
|---|---|
| C8/C9/C17 in `apply` | untouched and still strict — `P` exists precisely so they pass; a `P` that leaves a delta of `X` inapplicable is a builder bug caught by P-29, not something `fold` tolerates |
| `head == fold(deltas)` | **unchanged**: every delta is applied, in commit order, by the existing `fold`. No new loader input |
| `head_hash`, P-2, `rebuildHead`, tag creation | unchanged for refreshes; the fast-forward rule (§2.1) is the only change to `foldFromGenesis`, and it makes the stored hash and the recomputed one agree by construction |
| Rule 5 / S-10 / P-5 | preserved exactly: existence changes are `restore`/`retract` deltas, every `$exists` chain is real, every retired relationship has a retract delta in main's ancestry after the merge |
| `merge_resolution` source | one per refresh (as `pushRefresh` creates today), shared by `P` and `M`; the provenance badge on a restored-then-retracted element reads `⇄` for the resolution steps and keeps the original sources for values `restore` recovers (restore is provenance-preserving by design, §6.2) |
| `resolved_conflicts` | no schema change. `resolution_delta_id` may point into `P` or `M`, or be null when the winning side needed no restatement (the column is already nullable and `src/db/commits.ts`'s `ResolvedConflictInput` already anticipates it). `rationale` carries the action name (`keep-retraction`, `keep-element`, `survivor`, `primary`, `converged`) |
| Split closure | `P` and `M` are ordinary own commits; `listOwnDeltas` includes them. `buildSplitDeltas` must stop replaying in original order (§5) — a change (c) shares with (a) |
| Final merge | fast-forward rule (§2.1); `mergeApprovedRequest` is already correct and needs no change |
| Concurrent refresh | one RPC, one transaction, both commits: C13 on `P` (or `M` when `P` is empty) decides the winner; the loser writes nothing. Two reviewers resolving the same conflicts differently cannot both land |
| History readability | the cost of (c): a restore/retract pair (or retract/restore pair) in B's history per resolved element. The element page's supersession chain shows them, attributed to the refresh commit and its rationale. Accepted: it is the honest record of what happened, and the field-conflict machinery already produces "superseded on refresh" entries of the same kind |

### 3.4 A fourth option, considered and not taken: state merge

Redefine the fold of any merge commit as a three-way *state* merge of `fold(base)`, `fold(parent)`, `fold(mergedBranchHead)` plus own deltas — no replay at all. It would remove the order problem at its root, but it rewrites `fold`, breaks `element.restore`'s reliance on `factHistory`, changes P-2/P-3, and makes every existing merge commit's fold a different computation. Right idea for a v2 engine; wrong size for C2b. Recorded so it is not rediscovered as new.

---

## 4. The four resolution actions, exactly, under (c)

Notation: `retract(E)`, `restore(E)`, `upd(S.attr = v)`, `rcreate(R)`, `rretract(R)`, `rrestore(R)`. `prev(d)` is the delta `d` supersedes (C6). `parent_base(E)` is `E`'s `parentId` at `base`. Each row of `resolved_conflicts` is written as `{winning, discarded, resolution, rationale}`. Field conflicts on the same subject are resolved alongside, exactly as today (`buildFieldConflictResolutions`), in `M`.

### 4.1 Retract-vs-modify, dangling endpoint, dangling parent — the direction choice

One card per retracted element (SPEC §7.4); the three classes are the same conflict seen through the element, a relationship, or a child. The reviewer chooses **keep retraction** or **keep element**; the cascade is computed.

**Case A — B retracted `E`; main updated `E`, created `R_1..R_n` with `E` as an endpoint, re-parented `X_1..X_m` under `E`.**

*Keep retraction:*
```
P:  restore(E)                          prev = B's retract(E)
M:  replay X   → main's upd(E.*), rcreate(R_i), upd(X_j.parentId = E) all apply
M own, in this order:
    rretract(R_i)  for each i          prev = rcreate(R_i)
    upd(X_j.parentId = parent_base(E)) for each j   prev = main's upd(X_j.parentId)   [V2: no dangling parent]
    retract(E)                          prev = restore(E)                              [C8 now holds]
resolved_conflicts:
    per main upd(E.a):   {winning: B's retract(E), discarded: main's upd(E.a), resolution: M's retract(E), 'keep-retraction'}
    per R_i:             {winning: B's retract(E), discarded: rcreate(R_i),   resolution: rretract(R_i), 'keep-retraction'}
    per X_j:             {winning: B's retract(E), discarded: main's upd(X_j.parentId), resolution: M's upd(X_j.parentId), 'keep-retraction'}
```
Result: `E` absent, `R_i` absent, `X_j` back under `E`'s former parent. After the final merge, main's history contains real retracts for `E` and every `R_i`.

*Keep element:*
```
P:  restore(E)                          prev = B's retract(E)
M:  replay X   → main's changes land on E with main's own provenance
M own: none
resolved_conflicts:
    per main upd(E.a):   {winning: main's upd(E.a), discarded: B's retract(E), resolution: P's restore(E), 'keep-element'}
    per R_i / X_j:       {winning: rcreate(R_i) / main's upd, discarded: B's retract(E), resolution: P's restore(E), 'keep-element'}
```
Result: `E` live with its pre-retract values (restored with original provenance) overlaid by main's updates.

**Case B — main retracted `E`; B updated `E`, created `S_1..S_k` with `E` as an endpoint, re-parented `Y_1..Y_l` under `E`.** (Main's own retract satisfied C8 on main, so any pre-existing relationship of `E` was retracted in `X` too and replays fine.)

*Keep element:*
```
P:  rretract(S_i)  for each i          prev = rcreate(S_i)                    [C8 for main's replayed retract]
M:  replay X   → main's retract(E) applies (C8 holds); main's rretract of pre-existing relationships applies
M own, in this order:
    restore(E)                          prev = main's retract(E)   — recovers B's updated values with B's provenance
    rrestore(S_i)  for each i           prev = P's rretract(S_i)
    rrestore(Q)    for each pre-existing relationship Q of E that main retracted only because it was retracting E
                                        prev = main's rretract(Q)   — see note
resolved_conflicts:
    per B upd(E.a):      {winning: B's upd(E.a), discarded: main's retract(E), resolution: M's restore(E), 'keep-element'}
    per S_i:             {winning: rcreate(S_i), discarded: main's retract(E), resolution: rrestore(S_i), 'keep-element'}
    per Q:               {winning: Q's existing create, discarded: main's rretract(Q), resolution: rrestore(Q), 'keep-element'}
```
Note on `Q`: whether main's retract of a pre-existing relationship was "because of `E`" or an independent decision is not decidable from history. The card lists `E`'s relationships main retracted in the same commit as `E` and defaults them to restored, each individually untickable — the reviewer decides, the default is the reading ADR-006's "keeping the element" implies. Nothing is silently dropped either way.

*Keep retraction:*
```
P:  rretract(S_i)  for each i          prev = rcreate(S_i)
M:  replay X   → main's retract(E) applies
M own:
    upd(Y_j.parentId = parent_base(E)) for each j    prev = B's upd(Y_j.parentId)
resolved_conflicts:
    per B upd(E.a):      {winning: main's retract(E), discarded: B's upd(E.a), resolution: null, 'keep-retraction'}
    per S_i:             {winning: main's retract(E), discarded: rcreate(S_i), resolution: P's rretract(S_i), 'keep-retraction'}
    per Y_j:             {winning: main's retract(E), discarded: B's upd(Y_j.parentId), resolution: M's upd, 'keep-retraction'}
```
`resolution: null` for B's superseded updates is the one place ADR-007's "a resolution becomes a new delta" has no delta to write — the winning delta (main's retract) already did the work, the updates were applied and then swept away by it, and the row records the choice. This is the case `ResolvedConflictInput`'s nullable field was kept for.

**Converged retraction (both retracted `E`, no finding today; §1.3.1):** `P: restore(E)`; `M` replays main's `retract(E)`; no own deltas; one row `{winning: B's retract, discarded: main's retract, resolution: P's restore, 'converged'}`. Generated automatically by the builder; never a card.

### 4.2 Duplicate relationship — survivor pick

Both sides created `R_o` (ours) and `R_t` (theirs) with the same `(type, from, to)`. Replay of `rcreate(R_t)` applies (`apply` does not check S-6; V6 does, at validation). No `P` unless the pair is also a primary collision (§4.3).

```
M own:  rretract(loser)                 prev = rcreate(loser)
resolved_conflicts: {winning: rcreate(survivor), discarded: rcreate(loser), resolution: rretract(loser), 'survivor'}
```
The card shows both relationships' attributes; if the loser carried an attribute value the survivor lacks, the reviewer edits the survivor afterwards through the ordinary editor — that is a field edit, not part of the conflict.

### 4.3 Cardinality — primary pick (`supports`), role pick (`owns`, Prompt 7k item 2)

Main's replay would collide with `O`'s own live edge on the same anchor (`supports` on `from`, `owns` on `to`): main created or promoted `R_t` holding the same cardinality-limited value `O`'s own `R_o` already holds — for `supports`, that value is always `'primary'` (a `'secondary'` edge has no cardinality limit at all, so this whole section never applies to one); for `owns`, it's whichever of `'business'`/`'technical'`/`'service'` both sides picked.

```
P:  upd(R_o.role = 'secondary')  |  upd(R_o.role = <reassigned>)   prev = the delta asserting R_o's role   [C17 for the replay]
M:  replay X   → R_t's role applies
M own, if the reviewer keeps ours:
    upd(R_t.role = 'secondary') | upd(R_t.role = <reassigned>)     prev = main's promoting delta
    upd(R_o.role = 'primary')   | upd(R_o.role = <original role>)  prev = P's reassignment   (reassign first, restore second — same-commit order, C17)
M own, if the reviewer keeps theirs: nothing
resolved_conflicts:
    keep ours:   {winning: R_o's promoting delta, discarded: main's promoting delta, resolution: M's promote(R_o), 'primary'}
    keep theirs: {winning: main's promoting delta, discarded: R_o's promoting delta, resolution: P's reassign(R_o), 'primary'}
```
For `supports` the reassigned value is always `'secondary'` — the one other state the type has. For `owns` there is no equivalent natural "next" role: `'business'`/`'technical'`/`'service'` aren't ordered, so "demote" doesn't name a single target value the way it does for `supports`. **Open sub-question, not resolved by this amendment** (Prompt 7k item 2 only changed the contract/cardinality `classifyMerge` and the engine check against; it did not build C2b): when C2b's builder is actually implemented, the loser's own reassignment target for an `owns` collision needs an explicit answer — retract the loser's edge outright (simplest, but loses the fact that someone *is* an owner of that target in some capacity, just not this one) versus prompting the reviewer for which role the loser becomes (more information-preserving, more UI surface). Decide this when `buildStructuralResolutions` (§5 item 2) is actually written, not silently here.

When the pair is also a duplicate (§4.2), the survivor pick subsumes the primary/role pick: the loser is retracted, and `P` reassigns `R_o` only if the loser is `R_t` and `R_t`'s replay would otherwise throw — i.e. always, since `R_o` holds the colliding value on `O` at replay time.

---

## 5. Changes this decision forces elsewhere

1. **`foldFromGenesis` — fast-forward rule (§2.1).** `if (node.parent_commit_id ∈ ancestry(node.merged_branch_head_commit_id)) head = foldFromGenesis(node.merged_branch_head_commit_id)` then own deltas; else the existing replay. The `ancestry` check is one set membership on data `topo(exclusive(...))` already walks. `head.property.test.ts`'s graph generator must produce main-merge commits (branch reaches main's head, merged whole) and P-2 must assert `headHash(fold(mergeCommit)) == headHash(fold(branch.head))` for them. A refresh commit never satisfies the condition unless the branch had no own commits since forking, in which case both rules give the same answer.
2. **`classifyMerge`** — add `supports.role = 'primary'` to `structural:cardinality`; add the create-vs-promote shape (one side promotes an existing relationship, the other creates or promotes another primary on the same anchor); add a non-blocking `converged-retract` finding so the builder has a finding to attach `P`'s restore and the `resolved_conflicts` row to. P-13 (symmetry) extends to these.
3. **`src/engine/mergeResolution.ts`** — `buildStructuralResolutions(review, choices, sourceId, mintId) → { prepDeltas, mergeDeltas, resolvedConflicts }` beside the existing field-conflict builder, implementing §3.3's preparation table and §4's decision sequences from the findings. One builder driven by findings, not four hand-written ones. `unresolvedStructuralFindings(findings, choices)` extends C15's guard: every blocking structural finding needs a choice before a refresh can be pushed; converged retracts are resolved implicitly.
4. **`src/engine/splitClosure.ts` — `buildSplitDeltas` ordering (§1.3.3).** Keep replaying B's own deltas verbatim (per-attribute provenance survives), keep each subject's own sequence, but order across subjects by dependency: element restores and creates, then relationship creates, then updates, then relationship retracts, then element retracts, then anything superseding within a subject in its own order. Extend `splitClosure.property.test.ts`'s generators with resolved refreshes; the existing property (folds over the merge base, C8/C9 hold) is the assertion.
5. **RPC: `atlas.refresh_branch`** (security definer, contributor+, branch must be `draft`, S-18):
   ```
   atlas.refresh_branch(
     p_branch_id uuid,
     p_expected_head_commit_id uuid,        -- C13: O
     p_main_head_commit_id uuid,            -- T; must be on main (checked)
     p_prep_commit jsonb,                   -- {id, title, deltas[]} or null
     p_merge_commit jsonb,                  -- {id, title, deltas[]}
     p_resolved_conflicts jsonb             -- rows referencing deltas in either commit
   ) returns jsonb                          -- {status: 'ok', prepCommitId, mergeCommitId} | {status: 'stale_head'} | {status: 'invalid', reason}
   ```
   Calls `atlas.commit_deltas` twice (kinds `preparation` then `merge` — §2a amendment 1 — the second with `p_merged_branch_head_commit_id = T` and `p_resolved_conflicts`), in one transaction, verifying kind, adjacency and shared source (C21, §2a amendment 3). `commit_deltas` itself does not change; `20260906170000_merge_refresh_base_commit_id.sql`'s "move `base_commit_id` on a change-branch merge" applies to `M` as today. A `jsonb` status return per the working rule ("RPCs that signal an outcome return `jsonb` with an explicit status, never a row type"). `src/db/mergeRequests.ts`'s `pushRefresh` becomes a wrapper that builds both envelopes with the engine and calls this; the single-`commitToBranch` path stays for the empty-`P` case only if measured to matter, otherwise everything goes through the RPC for one code path.
6. **`src/ui/reviews/ConflictCards.tsx`** — real actions on `StructuralConflictCard` per §4 (direction choice with the computed cascade spelled out in consequences, survivor pick, primary pick); `BranchRebasePanel` and `ReviewRequestView` both call the same `pushRefresh`. The "reopen and fix by hand" path remains available as the escape hatch and is no longer the only path.

---

## 6. Invariants added or amended (SPEC §5.2)

- **C15 (amended):** a merge commit's own deltas are exactly: one resolution per FIELD_CONFLICT key, plus the decision deltas §4 derives from the reviewer's choice for every blocking structural finding, plus nothing else. Every structural finding has a choice.
- **C21 (new — numbered per §2a amendment 3, drafted as "C18" before the collision was found):** a `preparation`-kind commit (§2a amendment 1: written only by `atlas.refresh_branch`, immediately before a `merge` commit, sharing its `merge_resolution` source) contains only deltas §3.3's preparation table derives from the findings — restores of elements the branch retracted and main touched, retracts of the branch's own relationships to elements main retracted, demotions of the branch's primaries that main's primaries collide with — and no other commit kind may carry them. Checked by the engine before the RPC is called; the RPC checks the kind, the adjacency (`M.parent_commit_id = P.id`) and the shared source.
- **C19 (already landed, §2.1/§5 item 1 — quoted here for completeness, not new):** a merge commit whose first parent is in the ancestry of its second parent folds to the second parent's state plus its own deltas.
- **§6.6 obligation (amended):** P-2 covers both merge shapes.

---

## 7. Tests that must exist

Property (Vitest + fast-check, no database):

| Id | Property |
|---|---|
| P-29 | For generated `(base, ours, theirs)` triples covering every structural class (both directions), converged retractions, both cardinality types and both cardinality shapes, and every legal choice: `buildStructuralResolutions` yields `P`, `M` such that `fold(O) ⊕ P ⊕ replay(X) ⊕ M` never throws; the result passes V2, V6 and C17; it equals a directly constructed oracle head for that choice (element present/absent, relationships present/absent, primaries as chosen, children re-parented); every `resolved_conflicts` row references delta ids that exist in `X`, `O`'s ancestry, `P` or `M`; and C21 (§2a amendment 3) holds for `P`. |
| P-30 | Fast-forward rule: for any branch with `mergeBase(B) == main.head`, `headHash(fold(mainMergeCommit)) == headHash(fold(B.head))`; for any refresh commit with no structural findings, the new `fold` equals the old replay bit for bit. |
| P-31 | Determinism (rule 6): two runs of the builder over the same inputs with the same id minter produce identical `P`, `M`, rows. |
| P-32 | Split after a resolved refresh: for any accepted subset, `buildSplitDeltas` folds over the merge base and passes C8/C9 (the existing property, with resolved refreshes in the generators). |
| P-13 (extended) | Swapping ours/theirs swaps the direction of every structural finding and leaves the set of finding subjects unchanged, cardinality and converged findings included. |
| Golden | One unit test per §4 sequence asserting the exact kinds, order and `previousDeltaId` links. |

Integration (`pnpm test:integration`, real Supabase):

- The issue's failing scenario (`B` retracts `E`, main updates `E`) through `atlas.refresh_branch`, both choices; after each, `mergeBase(B) == main.head`, `foldFromGenesis(B.head)` equals the engine's predicted head, `resolved_conflicts` rows present.
- Each other §4 action once, end to end, then submit → approve → `merge_branch`, then `rebuildHead` and assert `head == fold` byte for byte and the stored `head_hash` matches (the §1.2 failure, now closed).
- Atomicity: inject a failure in the second `commit_deltas` (an invalid `M`) and assert no `P` row, no head movement, no source row consumed.
- Concurrency: two `refresh_branch` calls with the same `p_expected_head_commit_id` via `Promise.all` — exactly one `ok`, the other `stale_head`, and the branch has exactly one new `P`/`M` pair.
- Role: a viewer is refused; a contributor on a `proposed` branch is refused (S-18).
- Converged retraction refreshes with zero cards.

Playwright (folded in from C2 step 7, deferred to here):

- Structural card: keep-retraction and keep-element on a retract-vs-modify with a dangling endpoint, consequences text names the cascade, apply, request resubmitted, approve, merge, element state correct on main.
- Duplicate survivor pick and primary pick, same flow.
- `BranchRebasePanel` on a draft change: pre-request refresh with a structural conflict resolved.
- `/review` list renders open requests with counts by class.
- Branch-ref visits to Context, Container and Component render the As-is/To-be/Diff control.

---

## 8. SPEC and doc sections that change

| Document | Section | Change |
|---|---|---|
| `SPEC-data-model.md` | §3.1 `commit_kind`, §5.1 kinds | new value `preparation` (own migration, `CommitKind` contract update, round-trip test — §2a amendment 1); `merge` on main folds by C19 |
| | §5.2 | C15 amended; C21 added (§2a amendment 3 — C19 already landed under §2.1); `COMMIT_INVARIANTS` in `src/contracts/delta.ts` updated to match |
| | §6.2 `fold` | the fast-forward branch of the pseudocode |
| | §6.6 | P-2 covers both merge shapes |
| | §7.3 table | `cardinality` covers `supports.role`; converged-retract row (non-blocking, auto-resolved) |
| | §7.4 structural cards | actions and their consequences per §4; "reopen and fix" becomes the escape hatch |
| | §7.5 refresh | `atlas.refresh_branch` is real, with the signature in §5.5; the "not a distinct SQL procedure" note is superseded |
| | §10 | P-29–P-32, P-13 extension, integration rows above |
| | §11 | C2b row: retargeted from "design decision needed" to this ADR; split-ordering row added |
| `ADR-000-foundations.md` | ADR-006 | amendment note pointing here; index line for ADR-021 |
| `UI-principles.md` | §5.3 | structural cards have actions; consequences wording |
| `src/contracts/delta.ts` | `COMMIT_INVARIANTS` | C15 amended, C21 added (C19 already present) |
| `src/db/types.ts`, `rows.ts` | none | no new columns |
| `src/engine/describeEnvelope.ts`, activity feed (`src/ui`) | — | fixed title for `preparation` commits; labelled as a step of the following refresh, never as an independent edit (§2a amendment 1) |
| `docs/prompts/atlas-prompt-pack.md` | deferred register | C19/P-30/P-2 PR now; C2b (§5 items 2–6, §7 tests) after 7k (§2a amendment 2) |

Migrations: the `preparation` enum value (its own file) and the new function. `resolved_conflicts` keeps its shape. Rule 1 applies to the enum (`CommitKind` + round trip) and to the RPC's own contract type (`RefreshBranchInput`/`Result` in `src/contracts`) with a round-trip test against it.

---

## 9. Pushback

**C2b should exist, but not as specified.** Issue #76 frames it as "pick (a) or (b) and build four actions." Three things in that framing are wrong enough to change the sprint:

1. **The bug is in the final merge as much as the refresh, and the final merge is the one that is hashed.** Any C2b that ships refresh-side resolution without §2.1 leaves `merge_branch` storing a projection `foldFromGenesis` cannot reproduce — a guaranteed `HASH` incident on first use, discovered by the nightly job, not by a test. §2.1 is therefore the first item, not an afterthought, and it needs P-2 coverage before any card gets a button.
2. **Neither named design is the right one.** (b) cannot express the issue's own case; (a) works but quietly redefines what the head is. The recommended (c) is (b) with the "before" deltas in a preceding commit, which the existing engine already knows how to fold. It costs a second commit per structurally-resolved refresh and some history noise; it costs no change to `apply`, `fold`'s inputs, or any invariant.
3. **Two prerequisites the issue does not list are load-bearing:** the classifier's missing cardinality cases and converged retractions (a refresh that throws with nothing to resolve is worse than a card with no button), and `buildSplitDeltas`'s ordering (a resolved branch that then cannot be split partially breaks C2's own headline feature). Both are small; both must be in C2b's scope, not follow-ups.

Sizing: this is one engine builder driven by findings, one `fold` branch, one classifier extension, one split-ordering change, one RPC, and card actions — a sprint, not a step. The deferred Playwright from C2 step 7 belongs with it because the review queue's structural cards are what those tests would exercise. (Accepted with the split in §2a amendment 2: the `fold` branch ships first on its own; the rest is C2b after 7k.)

---

## 10. Consequences

- History on a structurally-resolved branch shows a preparation commit before the refresh. The element page's supersession chain and the change page's activity make the pair legible by rationale; a reader who wonders "why was `E` restored then retracted in the same minute" gets the answer from the `resolved_conflicts` row's `rationale` and the refresh commit's title.
- The engine stays the single place fold semantics live; the RPC composes two `commit_deltas` calls and adds no logic of its own beyond adjacency and the stale-head check.
- The state-merge redesign (§3.4) remains the long-term answer if replay-based merging accumulates more special cases; this ADR adds one rule (C19) and one convention (C21, §2a amendment 3), which is the budget it should stay within.
