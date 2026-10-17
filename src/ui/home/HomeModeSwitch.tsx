import type { HomeMode } from '../../contracts/userPreferences';
import { Button } from '../components/Button/Button';
import styles from './HomeModeSwitch.module.css';

export interface HomeModeSwitchProps {
  homeMode: HomeMode;
  onChange: (mode: HomeMode) => void;
}

/**
 * UI-principles §3.3: "Top bar, right side: `Overview` / `My work`
 * segmented control" — named for the job each view does (a briefing on
 * the state of the business; a worklist for the state of the model), not
 * for who reads it (formerly Director/Architect view, then briefly
 * Capability/Application view — the stored preference keeps its
 * `director`/`architect` values). "Switching is instant, remembered, and
 * never changes what the user is permitted to do." Permission enforcement is
 * each door's own data load (an architect-door viewer with no branches
 * just sees an empty "My branches" panel, same RLS-backed emptiness every
 * other view in this product already shows a role-mismatched user) — this
 * control itself never checks a role.
 */
export function HomeModeSwitch({ homeMode, onChange }: HomeModeSwitchProps) {
  return (
    <div className={styles.switch} role="group" aria-label="Home view">
      <Button variant={homeMode === 'director' ? 'primary' : 'ghost'} onClick={() => { onChange('director'); }} aria-pressed={homeMode === 'director'}>
        Overview
      </Button>
      <Button variant={homeMode === 'architect' ? 'primary' : 'ghost'} onClick={() => { onChange('architect'); }} aria-pressed={homeMode === 'architect'}>
        My work
      </Button>
    </div>
  );
}
