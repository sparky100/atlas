import type { HomeMode } from '../../contracts/userPreferences';
import { Button } from '../components/Button/Button';
import styles from './HomeModeSwitch.module.css';

export interface HomeModeSwitchProps {
  homeMode: HomeMode;
  onChange: (mode: HomeMode) => void;
}

/**
 * UI-principles §3.3: "Top bar, right side: `Director view` / `Architect
 * view` segmented control. Switching is instant, remembered, and never
 * changes what the user is permitted to do." Permission enforcement is
 * each door's own data load (an architect-door viewer with no branches
 * just sees an empty "My branches" panel, same RLS-backed emptiness every
 * other view in this product already shows a role-mismatched user) — this
 * control itself never checks a role.
 */
export function HomeModeSwitch({ homeMode, onChange }: HomeModeSwitchProps) {
  return (
    <div className={styles.switch} role="group" aria-label="Home view">
      <Button variant={homeMode === 'director' ? 'primary' : 'ghost'} onClick={() => { onChange('director'); }} aria-pressed={homeMode === 'director'}>
        Director view
      </Button>
      <Button variant={homeMode === 'architect' ? 'primary' : 'ghost'} onClick={() => { onChange('architect'); }} aria-pressed={homeMode === 'architect'}>
        Architect view
      </Button>
    </div>
  );
}
