import type { ReactNode } from 'react';
import styles from './BlueprintFrame.module.css';

export interface BlueprintFrameProps {
  children: ReactNode;
}

/**
 * The one "this deserves a first glance" frame treatment in the design
 * system — a thicker steel-accent border plus four corner marks, layered
 * over whatever's inside. Used wherever a tile or plate is surfaced above
 * its calmer hairline-bordered siblings (Handoff 7d, `docs/HANDOFF-7d-
 * director-door.md`: an exposed or unrecorded capability tile, the newest
 * version stamp). Never colour alone (§6.3/§8.4/§8.7) — the frame is a
 * shape difference the content's own status colour (a Chip, a status bar)
 * sits inside, not a replacement for it.
 */
export function BlueprintFrame({ children }: BlueprintFrameProps) {
  return (
    <div className={styles.frame}>
      <span className={[styles.corner, styles.topLeft].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.topRight].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.bottomLeft].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.bottomRight].join(' ')} aria-hidden="true" />
      {children}
    </div>
  );
}
