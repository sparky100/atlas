import type { ReactNode } from 'react';
import styles from './BlueprintFrame.module.css';

export interface BlueprintFrameProps {
  children: ReactNode;
  /**
   * Sprint U4-2b item 4: the emphasis border + corner marks show only on
   * hover/keyboard-focus, a plain 1px border the rest of the time — tried
   * here for the capability map's own many-tiles-at-once density
   * (`CapabilityTile.tsx`'s own use), where the full frame on every tile,
   * always, reads as more "everything is flagged" noise than the doorway
   * uses this component elsewhere (a single exposed capability tile, a
   * version stamp) ever produced one of at a time. Opt-in and defaulting
   * to `false` so every other caller's own always-on frame is unchanged.
   * No persistent "selected" state exists on this map yet (no click
   * leaves a tile "selected" the way a canvas node might) — hover and
   * focus are the interactive states that actually exist today; a
   * selected variant is a real gap to fill only once selection itself is
   * a concept here.
   */
  interactive?: boolean;
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
export function BlueprintFrame({ children, interactive = false }: BlueprintFrameProps) {
  return (
    <div className={[styles.frame, interactive ? styles.interactive : ''].filter(Boolean).join(' ')}>
      <span className={[styles.corner, styles.topLeft].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.topRight].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.bottomLeft].join(' ')} aria-hidden="true" />
      <span className={[styles.corner, styles.bottomRight].join(' ')} aria-hidden="true" />
      {children}
    </div>
  );
}
