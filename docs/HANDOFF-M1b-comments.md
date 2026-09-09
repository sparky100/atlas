# Handoff — Comments (M1b, Prompt 8 second half)

**Reviewed 2026-09-09.** Corrected against the codebase: one wrong token (`--color-accent-700` doesn't exist — corrected to `--accent`, the same class of error the U4 element-page handoff had); `describeDelta`'s claimed example strings replaced with its real output, which reads nothing like what this draft assumed; and one real gap this draft didn't anticipate flagged rather than silently resolved — the comment marker's own top-right corner is already occupied by the landscape's existing "+N" extra-lane marker (Sprint B4). Everything else checked — every dimension, RPC signature, trigger, schema column, enum value, keyboard shortcut and URL convention named below — matched the codebase exactly. See ✅/⚠️/🆕 against each claim.

Same shape as the door handoffs: design intent, then the spec, then what the code says. Read against the Sprint M1a backend, which already exists and is tested — `comments`, `comment_mentions`, `notifications`, `atlas.profiles`, and `atlas.unresolved_comment_counts`. Today's `ElementPage.tsx` still renders "Comments aren't built yet — see Sprint M1" ✅ (`src/ui/routes/ElementPage.tsx`, verbatim); this is the UI half of a backend-complete feature, not a new subsystem.

Boards:
- `Atlas - Comments canvas directions.dc.html` — 5a / 5b / 5c, canvas marker + panel. **5a chosen.**
- `Atlas - Comments surfaces.dc.html` — 6a element page section, 6b change and review, 6c notification tray.
- `Atlas - Comments flow.dc.html` — the six-step clickable flow on 5a.

## Intent

Comments are conversation, not governance. Every decision below follows from that: they never gate a merge, they never carry their own colour, and a resolved thread collapses rather than disappearing. The model's colour vocabulary belongs to lifecycle and exposure; a comment marker that borrowed it would make a question look like a risk.

The second idea is that a comment must always say what it is attached to. A thread shows its anchor, a tray row states the subject in words before you click it, and a comment raised on a branch's to-be view keeps saying so after the branch merges.

## Canvas — direction 5a

Built on the real landscape (`src/ui/landscape/layout.ts`): 160×48 nodes ✅ (`NODE_WIDTH = 160`, `NODE_HEIGHT = 48`), radius 8 ✅ (`roundRectPath(ctx, node.x, node.y, NODE_WIDTH, NODE_HEIGHT, 8)`, `LandscapeCanvas.tsx`), 24px apart ✅ (`NODE_GUTTER_X = 24`), in swim lanes — capability lanes ordered by name, then Unassigned, then External ✅ (`layout.ts`'s own lane-rank function: capability lanes rank 0 sorted by name, `Unassigned` rank 1, `External` rank 2). A lane is a 28px uppercase label ✅ (`LANE_LABEL_HEIGHT = 28`), the node row, and a 32px gutter carrying the lane's baseline rule ✅ (`LANE_GUTTER_Y = 32`).

**What a node actually paints** (`LandscapeCanvas.tsx`, node pass): fill is always `--surface-raised`; a landscape node carries no lifecycle or exposure tone. Colour appears only in Diff mode — fill tinted 12% toward the diff colour, hatched when removed — and the stroke carries hover (`--accent`, 2px), diff (2px), and external (dashed). Diff badges are filled circles of radius 8 at the node's **top-left** ✅ (`diffMarkers.push({ ..., worldX: node.x + 4, worldY: node.y + 4, ... })` — top-left, exactly), with the glyph reversed out in `--surface-raised`.

**Marker.** An 18×16 ink plate with a 2px radius, inset 4px into the node's **top-right**, carrying the unresolved thread count. Two reasons for that construction, both from the code above rather than from taste: the landscape has no per-node colour today, so a comment marker must not become the first one — it is ink, built the same way the diff badge is (filled shape, count reversed out in the surface colour); and top-left is already spoken for by the diff badge, so the two can coexist on one node in Diff mode. ⚠️ **What this reasoning missed: top-right isn't free either.** `LandscapeCanvas.tsx`'s own `extraLaneMarkers` (Sprint B4's "+N" — how many *other* lanes a multi-capability system also touches) already paints at `node.x + NODE_WIDTH - 4, node.y + 4` — the identical top-right corner, same 4px inset, same corner this design wants for the comment marker. A system with both an unresolved thread and a second supporting lane needs both badges at once; this draft never names which one moves, or whether they stack. Pick one before build: the two candidates that fit the rest of this doc's own logic are stacking them vertically (marker below the "+N", both still inside the 48px node height at typical zoom) or moving the comment marker to bottom-right (the one corner nothing currently paints) — not decided here, flagged for the build session. All threads resolved → hollow: background reverts to the surface, digit and border to ~82% / 45% ink. Never a status hue, never a pulse, never on the lane rule.

**Reserve the label width.** The name is drawn at `x + 30` and truncated to `NODE_WIDTH − 34` (126px) ✅ (`truncate(ctx, label.name, (NODE_WIDTH - 34) * textScale)`, 160 − 34 = 126), after a glyph at `x + 10`. A node carrying a marker must truncate to **100px** instead — `NODE_WIDTH − 34 − 26` for the marker's 4px inset, 18px box and 4px gap — or the count overlaps the tail of the name.

**Counts** come from `atlas.unresolved_comment_counts(model_id, anchor_ids[])` — one POST RPC per viewport, `security invoker`, so the caller's own `comments_select` RLS applies ✅ (`supabase/migrations/20260906240000_comments.sql`: `atlas.unresolved_comment_counts(p_model_id uuid, p_anchor_ids uuid[])`, "Runs as invoker (no security definer): RLS on `comments` applies exactly as it would to any other read"). The count is unresolved by construction; do not compute it client-side from a full thread list.

**The count is threads, not comments.** A twelve-reply thread is one open question and reads as `1`. This is what the RPC already returns, and it is the right unit: the number answers "how many things here are unsettled", not "how much has been said".

**Below the label LOD threshold, resolved markers are not drawn at all.** `showLabels` is `NODE_WIDTH * scale >= 64` ✅ (`LandscapeCanvas.tsx`, verbatim); use the same test for hollow markers. At estate scale only unresolved counts carry information, and 200 hollow plates are noise — they reappear on zoom in. Unresolved markers are always drawn, at every zoom, because a count nobody can see is a count that does not exist.

**No pin coordinates.** `comments` has `view_kind` but no `hint_x`/`hint_y` ✅ (`20260906240000_comments.sql`'s own module comment: "`branch_id` + `view_kind` replace `view_id` + `hint_x`/`hint_y` — no per-view pin coordinate this iteration"), so a marker sits at the subject's own node position and cannot sit where the author pointed. ADR-010's rejected alternative (anchoring to view coordinates) stands rejected ✅ (`docs/ADR-000-foundations.md`, Comments ADR's "Alternatives rejected": "Anchor comments to (view_id, x, y) diagram coordinates — coordinates are layout (ADR-011)... a comment anchored only to a point that can vanish on re-layout is fragile."); if a coordinate *hint* is ever wanted it is a schema addition, not a UI trick — the ADR's own next sentence says exactly this ("An optional coordinate hint... is fine; the real anchor is always a model object").

**Panel.** 372px, right side, canvas reflows rather than being covered so the selected node stays visible. Header: "Comments · anchor: element", subject name, unresolved chip. Then threads, then the collapsed resolved count, then the composer pinned to the bottom. `c` toggles it, `n` starts a thread ✅ (UI-principles §8.8: `c` = "Toggle comments panel" global; `n` = "New comment on the focused row", element-page section — both already specified, neither built yet, consistent with "Comments aren't built yet").

**"Comments on this view" filter** in the canvas toolbar, checked by default: scopes to threads whose `view_kind` matches this canvas. Unchecking shows every thread on every subject in the viewport regardless of where it was raised. The count beside it states both numbers ("6 unresolved · 4 subjects"). **Per session, reset on load** — it is a lens, not a preference, so it does not go in `user_preferences` and does not survive a reload.

## Element page section (6a)

Section header: "Comments", unresolved chip, "N threads · anchor: element", right-aligned "New thread `n`".

**Thread.** Root comment, then replies indented one level with a left rule — flat, one level only, sharing the root's exact anchor, both enforced by `atlas.check_anchor` ✅ (`20260906240000_comments.sql`: rejects a reply-to-a-reply — "replies are flat — cannot reply to a reply (ADR-010)" — and rejects a reply whose anchor doesn't match its root's). Only the root carries resolution state, so Resolve appears once per thread, not per comment. Actions row (Reply / Resolve) aligns to the reply indent.

**Author identity** from `atlas.profiles`: display name, `@handle`, avatar, monogram fallback 🆕 (`atlas.profiles` has `display_name`/`handle`/`avatar_url`, no email column ✅ — matches "Never an email — RLS never exposes one" exactly; no Avatar/monogram component exists anywhere in `src/ui/components` yet, so this piece is new UI work, not a reuse). Resolve batches through `listProfilesByIds` ✅ (`src/db/profiles.ts`), bounded by the authors on the page.

**@mentions** render as accent-weighted text. The composer's autocomplete lists org members by handle; the footer states who the post will notify, computed with `parseMentionHandles` ✅ (`src/contracts/comments.ts`) — a read-only preview of what `atlas.process_comment_mentions` will do server-side, never a second enforcement point. The migration's own comment confirms the two are meant to agree: "kept in sync by this migration's own round-trip test comparing the two." `⌘/Ctrl+Enter` posts.

**Resolved threads** collapse behind "N resolved thread(s) · show". Expanded, a resolved thread shows "resolved by @handle · when" and offers Reopen. Resolution permissions are narrower than they look: architect+ may resolve any thread, a contributor only their own (`atlas.guard_comment_update`) ✅ (`20260906240000_comments.sql`'s own comment: "Authors edit their own body; an owner/architect resolves any thread; a contributor resolves only a thread they themselves started"). Hide Resolve rather than showing it disabled, matching `canEditOnMain`'s existing convention ✅ (the same "omitted entirely, not shown disabled" pattern `ElementHeader.tsx`'s own `Edit` prop already documents). **No confirmation dialog** — resolving is reversible by Reopen, and an undo-style affordance is cheaper than a modal on an action taken many times a day.

**Retracted anchors.** A comment stays readable after its subject is retracted, and a new one can still be posted — `atlas.check_anchor` validates against permanent history (`deltas`' create rows), never the current head ✅ (`20260906240000_comments.sql`: checks `deltas where kind = 'element_create'`/`'relationship_create'`, explicitly "never against the *current* head... An element retracted after its comment was posted must stay a valid anchor forever"). The section states this in words with a `subject retracted` chip rather than hiding the threads.

**Empty state.** One sentence on what comments are for, and that they never block a merge. Composer present.

## Change page and review request (6b)

Built on `ReviewRequestView.tsx`'s real shell, which has no "elements in this change" list ✅ (confirmed — its sections today are the summary row, structural conflicts, field conflicts, identity warnings, and a collapsed clean-changes list; no per-element list of "everything this change touches").

**Summary panel** carries two chips and they are different vocabularies — label them: the merge request's own status (`pending` / `changes_requested` / `approved` / `merged` / `rejected`, via `mergeRequestStatusTone`) and the branch's (`draft` / `in_review` / …, via `branchStatusTone`) ✅ (both functions exist exactly as named: `src/ui/reviews/mergeRequestStatus.ts`, `src/ui/changes/branchStatus.ts`). Then "Requested by …", then "N blocking · N advisory". Add the unresolved comment count here, with the words "never a disabled reason" beside it — `atlas.merge_branch` and `atlas.approve_merge_request` never reference `comments` at all ✅ (checked `supabase/migrations/20260906161000_merge_review_queue.sql` directly: no mention of `comments` anywhere in it) — and Approve's real disabled reasons are blocking conflicts, an out-of-date branch, and a non-pending request.

**Per-subject threads** hang off the subjects that exist on that page: each Field-conflict card, each Identity-warning card, and each row of the collapsed Clean changes list ✅ (`ReviewRequestView.tsx`: `fieldConflictFindings`, `structuralFindings`, and a "Clean changes (N)" collapsed section all exist today, exactly this shape). Row affordance is the marker plus "N unresolved". Resolving happens in place — the card's count decrements, the thread collapses, the page does not navigate.

**Threads on the change itself** (`anchor_type = 'change'`) sit in their own column with their own composer. Delta lines use `describeDelta`'s exact strings — ⚠️ **not the strings this draft names.** `describeDelta` (`src/engine/describeEnvelope.ts`) doesn't produce "Retracted", `Created — "X"`, `attribute → value`, or `Created (supports)` for anything; its real output, verified directly against the function: `Add {elementType} {name}` (element create), `Retract {name}` / `Restore {name}` (element retract/restore — present tense, imperative, not "Retracted"), `Rename {name} to {value}` / `Set {name} {label} to {value}` / `Clear {name} {label}` (element attribute update), `Link {from} {verb} {to}` or, for `owns` specifically, `Set {to} owner to {from}` (relationship create — e.g. "Link PowerON supports Outage & Fault Management", the module's own worked example), and `Set {relationshipType} {label} to {value}` / `Clear {relationshipType} {label}` (relationship attribute update). Use these — the real ones already read naturally in a change-page delta list; there is no separate string set to build.

**Changes list** is `title ?? name`, description, then the meta row: branch status chip, `Target: YYYY-MM-DD`, and the unresolved count. Muted marker when every thread is resolved; "no comments" in words when there are none.

**`on change: <name>` tag** comes from `comments.branch_id`, which stays pinned to the branch forever, including after merge ✅ (`SPEC-data-model.md` §3.8: "stays pinned to that branch forever, even after merge, so it is display metadata... not part of viewer-visibility"). It is display metadata only — deliberately *not* part of `atlas.comment_visible_to_viewer` ✅ (the function exists exactly as named, `20260906240000_comments.sql`; SPEC §9's own note: "`comments.branch_id` is deliberately not part of this predicate"), because gating on it would hide a merged element's comments permanently.

## Notification tray (6c)

Bell in the header with the unread count from `getUnreadNotificationCount` ✅ (`src/db/notifications.ts`). Panel: "Inbox", unread count, "Mark all read". Rows are `listMyNotifications` ✅ (same file) in `created_at` order: author monogram, "X mentioned you", the comment body (truncated with "…" when clipped), then the anchor in words — "Northgate Revenues · element · landscape · 2d". Unread carries an accent spine and nothing else; no per-item colour.

Clicking deep-links to the anchored subject with the panel open and the comment scrolled to (`#c={commentId}`, §2.4's existing URL convention) ✅ (UI-principles §2.4's deep-links table, verbatim row: "Comment | any of the above `#c={commentId}` — opens the side panel scrolled to it") and marks that one read via `markNotificationRead` ✅ (`src/db/notifications.ts`). Notifications are private per recipient — nobody else, not even an owner, reads another member's rows.

Empty state says only mentions notify: no digests, no activity feed, and a merge never waits here.

## Backend work this design requires

**Reply notifications — in scope for M1b.** `notification_kind` has exactly one value today, `mention` ✅ (`20260906240000_comments.sql`: `create type notification_kind as enum ('mention')`), and `atlas.process_comment_mentions` is its only writer, so a reply with no `@handle` in it notifies nobody. Without this a thread is a message nobody sees answered, so it ships with the UI.

- Add `reply` to `notification_kind` in its own migration (every Postgres enum addition needs one, per the `genesis` precedent in ADR-016 — `commit_kind`'s own fifth value, ADR-000 §"A model's main branch always has a real head", landed the same way, its own migration).
- **Recipients: thread participants** — the root's author plus everyone who has already replied to it, which is `select distinct author_id from comments where id = root or parent_comment_id = root`.
- Skip the replying author, exactly as the mention parser already skips self-mentions ✅ (`atlas.process_comment_mentions`'s own comment: "Self-mentions are dropped (mentioning yourself notifies no one)").
- One trigger, two kinds. Extend `atlas.process_comment_mentions` rather than adding a second `after insert on comments` trigger ✅ (confirmed: exactly one such trigger exists today, `comments_process_mentions`, `after insert on comments`): it already parses the body and writes `notifications` rows in the comment's own transaction, and a mention and its notification must exist together or not at all. When a comment has a `parent_comment_id`, it additionally writes one `reply` row per participant.
- **De-duplicate within the trigger:** a reply that also `@mentions` a participant produces one notification, not two. Mention wins — it is the more specific signal and carries the "mentioned you" wording. Enforce it in the same statement rather than leaving two rows for the tray to reconcile.
- Tray copy follows the kind: "X mentioned you" / "X replied to your thread". The reply rows on board 6c are badged "not built" — drop that badge when the enum lands.

**Attribute-level anchors — out of scope, deliberately.** `anchor_type` is `element` / `relationship` / `change` / `decision` / `version`; `delta` was dropped in the M1a amendment, so UI-principles §7's "comment on this value" is unreachable. M1b stays element-level and does **not** restore it: provenance already carries a value's story — source, reference, age, confidence — and the rare case is covered by a comment naming the attribute in its body. No attribute row in these boards offers a comment affordance, and none should be added. Revisit only if usage shows people routinely opening threads that begin "re: owner" — that is the signal a `delta` anchor is worth its migration.

## Colour, mobile, dark

Semantic colour only, as everywhere else: status tokens carry lifecycle, exposure and workflow status; the accent carries chrome, mentions and actions; comments themselves are ink. Accent text at label size uses `--accent` ⚠️ (corrected — this draft originally named `--color-accent-700`, which doesn't exist anywhere in `src/ui/styles/tokens.css`; the real token is `--accent` — `#0b5fff` light, `#6ea0ff` dark — the same one every other accent use in this codebase already reads). Muted markers sit at ~82% ink so a resolved count still clears 4.5:1 on the light ground.

Mobile (390): panel and tray become full-width sheets. The composer and its primary action are pinned above the keyboard, with the autocomplete between the field and the button so a mention can be picked one-handed without the Post button leaving the screen. Post is 44px.

Dark mode is a token remap only — no layout change, and the status set swaps to the dark column of `tokens.css`.

## Decisions taken

No open questions — these were settled before handoff so they are not re-litigated in the build. One addition below (marked): a real conflict this review found that the original handoff didn't have a decision for.

| Question | Decision | Where it lands |
| --- | --- | --- |
| Do replies notify? | Yes, in M1b. Thread participants — root author plus prior repliers — get a `reply`; mentions still get `mention`. Two kinds, one trigger, de-duplicated so a reply that mentions you is one row. | Backend work, above |
| Attribute-level anchor? | No. Element-level only; provenance carries a value's story. Revisit if threads routinely open "re: owner". | Backend work, above |
| Does the view filter persist? | Per session, reset on load. A lens, not a preference. | Canvas, above |
| Resolved markers at low zoom? | Vanish below the label LOD threshold; reappear on zoom in. Unresolved always drawn. | Canvas, above |
| Confirm on resolve? | No. Reopen makes it reversible. | Element page, above |
| What does the marker count? | Threads, not replies. Twelve replies is one open question. | Canvas, above |
| ⚠️ **Comment marker vs. the existing "+N" extra-lane marker — both want the node's top-right corner.** | **Not decided in this handoff — flagged, not resolved, for the build session to pick before touching `LandscapeCanvas.tsx`.** Two candidates fit the rest of this design: stack the two badges vertically, or move the comment marker to bottom-right (the one corner nothing currently paints). | Canvas, above |
