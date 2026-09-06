import type { ReactNode } from 'react';
import styles from './Chip.module.css';

export type ChipTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

export interface ChipProps {
  tone?: ChipTone;
  /** A glyph or icon node shown before the label — status is never colour-only (§6.3, §8.4, §8.7). */
  glyph?: ReactNode;
  children: ReactNode;
}

/**
 * The one pill used for every status/lifecycle/exposure marker in the
 * product (`active`, `retiring`, `proposed`, `stale`, exposure chips on the
 * director's door...). Tone maps to `--status-*` tokens only — never a raw
 * colour, and never the same hue vocabulary as diff (§8.4's rule that
 * status and diff must not be read across).
 */
export function Chip({ tone = 'neutral', glyph, children }: ChipProps) {
  const classes = [styles.chip, styles[tone]].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {glyph !== undefined && (
        <span className={styles.glyph} aria-hidden="true">
          {glyph}
        </span>
      )}
      {children}
    </span>
  );
}
