import type { ProfileRow } from '../../db/types';

/**
 * A profile's own display label — display name if set, else `@handle`,
 * else "Someone" (Prompt 7h: "display name once, handle only when
 * there's no display name"). Factored out of `CommentThread.tsx` (its
 * original, comment-specific home) so `ReviewRequestView.tsx`'s own
 * "requester by display name" (S1 item 3) can share the identical
 * formatting rather than reinventing it — a requester and a comment
 * author are the same `ProfileRow` shape, resolved the same way.
 */
export function profileLabel(profile: ProfileRow | null | undefined): string {
  return profile?.display_name ?? (profile ? `@${profile.handle}` : 'Someone');
}
