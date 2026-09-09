import type { ProfileRow } from '../../../db/types';
import styles from './Avatar.module.css';

export interface AvatarProps {
  profile: Pick<ProfileRow, 'display_name' | 'handle' | 'avatar_url'> | null;
  size?: 'sm' | 'md';
}

/** Initials from a display name (first letter of up to two words) — falling back to the handle's own first two characters when there's no display name, since `handle` is the one identity field that's never null (Sprint M1a's own default-from-email-local-part rule). */
function monogramFor(profile: Pick<ProfileRow, 'display_name' | 'handle'>): string {
  const source = profile.display_name?.trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((part) => part[0]);
    return letters.join('').toUpperCase();
  }
  return profile.handle.slice(0, 2).toUpperCase();
}

/**
 * Comments (Sprint M1b, `docs/HANDOFF-M1b-comments.md`): "Author identity
 * from `atlas.profiles`: display name, `@handle`, avatar, monogram
 * fallback." First use of an avatar anywhere in this product — no prior
 * component to reuse, so this is deliberately narrow: an image when
 * `avatar_url` is set, a flat two-letter monogram otherwise. Never a
 * status hue (comments are ink, per the handoff's own "Intent") — the
 * monogram tile is the same neutral surface/border pairing a Chip's
 * `neutral` tone already uses, not a per-person colour.
 */
export function Avatar({ profile, size = 'sm' }: AvatarProps) {
  const classes = [styles.avatar, styles[size]].filter(Boolean).join(' ');
  if (!profile) {
    return (
      <span className={classes} aria-hidden="true">
        ?
      </span>
    );
  }
  if (profile.avatar_url) {
    return <img className={classes} src={profile.avatar_url} alt="" />;
  }
  return (
    <span className={classes} aria-hidden="true">
      {monogramFor(profile)}
    </span>
  );
}
