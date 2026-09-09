import type { MemberRole } from '../../db/types';
import type { UUID } from '../../contracts/delta';

/**
 * Mirrors `atlas.guard_comment_update`'s own resolve-permission matrix
 * (`supabase/migrations/20260906240000_comments.sql`) exactly — owner/
 * architect resolve any thread; a contributor resolves only a thread they
 * themselves started (the root's own author, not a reply's). This is UI
 * gating only (hide Resolve rather than show it disabled, matching
 * `canEditOnMain`'s existing convention — `docs/HANDOFF-M1b-comments.md`'s
 * own citation of `ElementHeader.tsx`'s `Edit` prop); the database re-
 * checks the identical rule regardless of what this returns.
 */
export function canResolveComment(role: MemberRole | null, userId: UUID | null, rootAuthorId: UUID): boolean {
  if (role === 'owner' || role === 'architect') return true;
  if (role === 'contributor') return userId !== null && userId === rootAuthorId;
  return false;
}

/** Mirrors `comments_insert`'s own RLS check exactly: owner/architect/contributor may post; a viewer may not (UI-principles' own "no confirmation dialog... comments never block a merge" intent extends to who may raise one at all — a viewer reads, never writes). */
export function canPostComment(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'architect' || role === 'contributor';
}
