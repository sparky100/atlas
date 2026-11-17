import styles from './DiffBadge.module.css';

export type DiffState = 'unchanged' | 'added' | 'removed' | 'changed' | 'moved';

export interface DiffBadgeProps {
  state: DiffState;
  /** Only meaningful for `changed` — the `~` marker's own count (§6.3). Ignored for every other state. */
  changedCount?: number | undefined;
}

const MARKER: Record<DiffState, string> = { unchanged: '', added: '+', removed: '−', changed: '~', moved: '⤴' };
const LABEL: Record<DiffState, string> = { unchanged: 'Unchanged', added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved to another parent' };

/**
 * One diff state, `--diff-*` tokens only — never `Chip`'s `--status-*`
 * tones (UI-principles §8.4: "diff and status must not be read across").
 * Colour, marker glyph and border style all carry the signal together
 * (§6.3: "colour is never the only signal"), so this survives greyscale
 * and every colour-vision simulation on its own — no separate legend
 * entry is required to tell states apart, only to name them (VersionsDiffView
 * still renders one, per §6.3's "legend... whenever Diff is on").
 */
export function DiffBadge({ state, changedCount }: DiffBadgeProps) {
  const label = state === 'changed' && changedCount !== undefined ? `${LABEL[state]} (${String(changedCount)})` : LABEL[state];
  const classes = [styles.badge, styles[state]].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {MARKER[state] !== '' && (
        <span aria-hidden="true" className={styles.marker}>
          {MARKER[state]}
        </span>
      )}
      {label}
    </span>
  );
}
