/**
 * Pure role/branch → boolean gates, split out from useMembership.ts so they
 * can be unit-tested with no Supabase client in the import graph at all
 * (useMembership.ts's own `useMembership` hook pulls in src/ui/supabaseClient.ts,
 * which throws at import time without VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY
 * set — exactly the environment a plain `vitest run` unit test doesn't have).
 * Re-exported from useMembership.ts, so every existing import site is
 * unaffected — this is a location split, not a public API change.
 */
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

/** Sprint 7j item 2: mirrors `organisations_update`/`organisations_delete` and `members_insert`/`members_update`'s RLS — organisation rename/slug, member directory management (role change, remove, invite) and Delete organisation are all owner-only. */
export function canManageOrgSettings(role: MemberRole | null): boolean {
  return role === 'owner';
}
