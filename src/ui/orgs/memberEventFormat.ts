import type { MemberEventRow } from '../../db/types';
import type { UUID } from '../../contracts/delta';

/**
 * F7 item 5: one plain sentence per `member_events` row, for the
 * "Membership audit" panel — the same "pure formatter, easily tested"
 * split `notificationFormat.ts` already uses. `nameFor` resolves a user id
 * to a display label; the caller owns the profile lookup (`useMemberEvents.ts`),
 * this module owns only the wording.
 */
export function memberEventSentence(event: MemberEventRow, nameFor: (userId: UUID | null) => string): string {
  const actor = nameFor(event.actor_id);
  const target = nameFor(event.target_user_id);

  switch (event.event_type) {
    case 'invited':
      return `${actor} invited ${event.target_email ?? 'someone'} as ${event.role ?? 'a member'}.`;
    case 'invite_revoked':
      return `${actor} revoked the invite for ${event.target_email ?? 'someone'}.`;
    case 'joined':
      // Org creation makes someone their own inviter (they become the
      // owner of the org they just created) — "invited by themself" reads
      // as a bug, not a fact, so it's omitted rather than stated.
      if (event.actor_id !== null && event.actor_id !== event.target_user_id) {
        return `${target} joined as ${event.role ?? 'a member'}, invited by ${actor}.`;
      }
      return `${target} joined as ${event.role ?? 'a member'}.`;
    case 'role_changed':
      return `${actor} changed ${target}'s role from ${event.previous_role ?? 'unknown'} to ${event.role ?? 'unknown'}.`;
    case 'removed':
      return `${actor} removed ${target}.`;
    case 'left':
      return `${target} left.`;
  }
}
