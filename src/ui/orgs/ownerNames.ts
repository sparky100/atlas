import type { MemberWithProfile } from '../../db/organisations';
import { profileLabel } from '../comments/profileLabel';

export function ownerNames(members: readonly MemberWithProfile[]): string[] {
  return members.filter((m) => m.member.role === 'owner').map((m) => profileLabel(m.profile));
}
