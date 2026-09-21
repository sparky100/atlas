/**
 * Pure role/branch → boolean gates, split out from useMembership.ts so they
 * can be unit-tested with no Supabase client in the import graph at all
 * (useMembership.ts's own `useMembership` hook pulls in src/ui/supabaseClient.ts,
 * which throws at import time without VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
 * set — exactly the environment a plain `vitest run` unit test doesn't have).
 * Re-exported from useMembership.ts, so every existing import site is
 * unaffected — this is a location split, not a public API change.
 */
import type { UUID } from '../../contracts/delta';
import type { BranchRow, MemberRole } from '../../db/types';

/** Mirrors `models_insert`'s RLS check (`atlas.has_role(org_id, 'owner', 'architect')`, supabase/migrations/20260906071300_models.sql) — for showing/hiding the affordance; the database enforces the real rule regardless of what this returns. */
export function canCreateModel(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}

/**
 * Mirrors `atlas.commit_deltas`'s main-only role gate (ADR-015: "only
 * owners and architects may commit directly to main") — for showing/hiding
 * `Edit` at `main` (UI-principles §4.2). A contributor gets no edit
 * affordance at all here rather than an inert `Propose a change…` — that
 * flow (opening a branch picker inline from the element page) still isn't
 * built even now that branch UI exists elsewhere (Changes, the review
 * queue); a contributor's real path to editing is creating or opening a
 * change branch first, then editing at `?ref=branch:...` (`canEditBranch`
 * below), which this main-only gate deliberately has no opinion on.
 */
export function canEditOnMain(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}

/**
 * Mirrors `branches_insert`'s RLS check (`atlas.has_role(org_id, 'owner',
 * 'architect', 'contributor')`, supabase/migrations/20260906071400_history.sql)
 * and ADR-009's "Contributor: can create/edit change branches... cannot
 * merge to main" — a viewer gets no "New change" affordance at all.
 */
export function canCreateChangeBranch(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect' || role === 'contributor';
}

/**
 * Mirrors `atlas.commit_deltas`'s own branch-kind gate (Sprint C1 step 2,
 * `supabase/migrations/20260906161000_merge_review_queue.sql`): `main`
 * takes owner/architect only (`canEditOnMain`); a `change` branch takes
 * owner/architect/contributor, but only while it's still `draft` — once
 * `proposed`/`approved`/etc. it's under review (S-18: new commits are
 * accepted only while `status = 'draft'`) and needs `atlas.request_changes`
 * to reopen it before anything can edit it again; `capture_draft` is never
 * edited from this affordance at all (ADR-004 — a human triages it, one
 * delta at a time, not via the element page's editor).
 */
export function canEditBranch(role: MemberRole | null, branch: BranchRow): boolean {
  if (branch.kind === 'main') return canEditOnMain(role);
  if (branch.kind === 'change') return branch.status === 'draft' && canCreateChangeBranch(role);
  return false;
}

/**
 * Mirrors `atlas.request_changes`' role check (Sprint C1 step 2,
 * `supabase/migrations/20260906161000_merge_review_queue.sql`) — a
 * contributor may resolve conflicts on their own (or anyone's) open request
 * and push a refresh, same role floor as editing a draft change branch.
 */
export function canReviewMergeRequest(role: MemberRole | null): boolean {
  return canCreateChangeBranch(role);
}

/**
 * Mirrors `atlas.approve_merge_request`/`reject_merge_request`/
 * `merge_branch`'s own role checks — "only owners and architects may
 * approve/reject/merge" (SPEC §7.4's "the reviewer holds architect or
 * owner").
 */
export function canApproveOrMergeRequest(role: MemberRole | null): boolean {
  return canEditOnMain(role);
}

/** Sprint 7j item 1: mirrors `atlas.archive_model`'s own role check — rename/slug/description and Archive share this gate (`models_update`'s RLS, owner/architect). */
export function canArchiveModel(role: MemberRole | null): boolean {
  return canEditOnMain(role);
}

/** Narrower than archive — mirrors `atlas.restore_model`'s own role check ("Restore for owners", the prompt's own wording). */
export function canRestoreModel(role: MemberRole | null): boolean {
  return role === 'owner';
}

/** Mirrors `models_delete`'s RLS and `atlas.delete_model`'s own role check — owner only, same floor as restore. */
export function canDeleteModel(role: MemberRole | null): boolean {
  return role === 'owner';
}

/**
 * S1 item 4: mirrors `atlas.cancel_change`'s own check — "proposer or
 * owner/architect, Draft or Proposed." Unlike every other gate in this
 * file, this one also needs `userId` (no existing gate combines role with
 * `branch.created_by` ownership) — a contributor who proposed this exact
 * change can cancel it themselves even without `canCreateChangeBranch`'s
 * own role floor mattering here, since the RPC's own check is "the
 * proposer, *or* an owner/architect," not both.
 */
export function canCancelChange(role: MemberRole | null, branch: BranchRow, userId: UUID | null): boolean {
  const isProposer = userId !== null && branch.created_by === userId;
  return (isProposer || role === 'owner' || role === 'architect') && (branch.status === 'draft' || branch.status === 'proposed');
}

/** Sprint 7j item 2: mirrors `organisations_update`/`organisations_delete` and `members_insert`/`members_update`'s RLS — organisation rename/slug, member directory management (role change, remove, invite) and Delete organisation are all owner-only. */
export function canManageOrgSettings(role: MemberRole | null): boolean {
  return role === 'owner';
}

/**
 * S1 item 13: the prompt's own wording — "'Backfill capability order'
 * owner action" — not enforced at the RLS layer (the commit it writes is a
 * plain `commitToBranch` on main, which `atlas.commit_deltas` allows any
 * owner *or* architect to make); restricted to owner only here in the UI,
 * the same narrower-than-`canEditOnMain` floor `canRestoreModel`/
 * `canDeleteModel` already use for a maintenance action nobody but the
 * owner should routinely reach for.
 */
export function canBackfillCapabilityOrder(role: MemberRole | null): boolean {
  return role === 'owner';
}

/** Prompt pack F3, ADR-022: mirrors `decisions_insert`'s own RLS floor (`supabase/migrations/20260913110000_decisions.sql`) — same as `canCreateChangeBranch`, starting a decision is a lightweight, contributor-level act. */
export function canStartDecision(role: MemberRole | null): boolean {
  return canCreateChangeBranch(role);
}

/** Prompt pack F3 PR5: mirrors `atlas.choose_decision_option`'s own role check (`supabase/migrations/20260913120000_choose_decision_option.sql`) — owner/architect only, the same floor `canApproveOrMergeRequest` uses, since choosing an option converts a branch to `propose` intent and closes out every other option in one action. */
export function canChooseDecisionOption(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect';
}

/** F1 ("custom attributes"): mirrors `attribute_definitions_insert`/`_update`'s own RLS floor (`supabase/migrations/20260914020000_attribute_definitions.sql`) — same owner-only floor `canManageOrgSettings` uses; define/reorder/deprecate are all gated the same way. */
export function canManageAttributeDefinitions(role: MemberRole | null): boolean {
  return role === 'owner';
}

/**
 * F6 (ADR-023, Decision 1): value streams are the most stable layer of the
 * model — structural edits (creating/reparenting a stream or stage,
 * reordering stages, adding/removing an `enables` edge) only ever happen on
 * `main`, or inside a `correct`-intent change (the "an architect reviewed
 * this correction" step the single-approver merge already gives `correct`
 * changes — no new approval machinery). A `propose`/`record`/`explore`
 * change branch, however editable it otherwise is, gets none of these
 * affordances — `ValueStreamGateNotice.tsx` is the message that replaces
 * them. This is UI-only, never engine-enforced (ADR-023: `branches.intent`
 * is a workflow concept `src/engine` deliberately never reads,
 * `branchIntent.ts`'s own module comment) — every write this gate hides
 * still goes through the ordinary `canEditBranch`/RLS checks underneath it.
 * A stream's own non-structural fields (`description`) aren't gated by
 * this — only the structural affordances named above are.
 */
export function canEditValueStreamStructure(role: MemberRole | null, branch: BranchRow): boolean {
  if (branch.kind === 'main') return canEditOnMain(role);
  if (branch.kind === 'change') return branch.intent === 'correct' && canEditBranch(role, branch);
  return false;
}

/** F2 PR14: mirrors `capture_jobs_insert`'s RLS floor (`supabase/migrations/20260920010000_capture_jobs_and_candidates.sql`: `atlas.has_role(org_id, 'owner', 'architect', 'contributor')`) — same floor as `canCreateChangeBranch`, named separately since the two checks happen to coincide today but aren't the same rule. */
export function canRunCapture(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect' || role === 'contributor';
}
