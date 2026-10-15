import type { ProfileRow } from '../../../db/types';

type IdentityProfile = Pick<ProfileRow, 'display_name' | 'handle'> | null;

/**
 * The name the shared header shows beside the avatar (docs/UI-principles.md
 * §2's header note): the person's own display name, else their handle, else
 * the email's local part — `atlas.profiles` only exists once a person joins
 * their first organisation (`useOwnProfile`'s own comment), so a brand-new
 * account still gets something readable rather than a blank.
 */
export function headerDisplayName(profile: IdentityProfile, email: string | null): string {
  const display = profile?.display_name?.trim();
  if (display) return display;
  if (profile?.handle) return profile.handle;
  const local = email?.split('@')[0]?.trim();
  if (local) return local;
  return 'Account';
}

/** Up to two initials from the display name (same rule as `Avatar.tsx`'s monogram), else the handle's or email's first character. */
export function headerInitials(profile: IdentityProfile, email: string | null): string {
  const display = profile?.display_name?.trim();
  if (display) {
    return display
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }
  const fallback = profile?.handle ?? email?.trim() ?? '';
  return fallback ? fallback.charAt(0).toUpperCase() : '?';
}
