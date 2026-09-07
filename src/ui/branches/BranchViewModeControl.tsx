import type { ViewMode } from '../../db/viewMode';
import styles from './BranchViewModeControl.module.css';

export interface BranchViewModeControlProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const TABS: { mode: ViewMode; label: string }[] = [
  { mode: 'asIs', label: 'As-is' },
  { mode: 'toBe', label: 'To-be' },
  { mode: 'diff', label: 'Diff' },
];

/**
 * The As-is/To-be/Diff segmented control (UI-principles §6.2), shown on
 * every canvas whenever the current ref is a branch — hidden at `main`/a
 * tag, "there is nothing to compare." `1`/`2`/`3` (§8.8's keyboard table) as
 * a shortcut for these three tabs is not wired anywhere yet — a real,
 * named gap, not implied by this component; each page would need to add it
 * to its own keydown handling (Landscape's canvas already owns one for
 * zoom, `+`/`-`/`0`) without stealing `1`/`2`/`3` from a text field a
 * branch's own metadata form might focus.
 */
export function BranchViewModeControl({ mode, onChange }: BranchViewModeControlProps) {
  return (
    <div className={styles.control} role="tablist" aria-label="As-is, To-be, or Diff">
      {TABS.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          role="tab"
          aria-selected={mode === tab.mode}
          className={[styles.tab, mode === tab.mode ? styles.active : ''].filter(Boolean).join(' ')}
          onClick={() => {
            onChange(tab.mode);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
