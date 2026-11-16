import type { LifecycleState } from '../../../engine/elementRead/fitAndExposure';
import { lifecycleTagText, lifecycleTagTitle } from './lifecycleTagText';
import styles from './LifecycleTag.module.css';

export interface LifecycleTagProps {
  state: LifecycleState;
  introduced?: string | undefined;
  plannedEnd?: string | undefined;
}

/** The one mark for "not active": Planned (not live yet) or Retired (gone). Active items carry no tag. */
export function LifecycleTag({ state, introduced, plannedEnd }: LifecycleTagProps) {
  if (state === 'active') return null;
  const label = lifecycleTagText(state, { introduced, plannedEnd });
  return (
    <span className={[styles.tag, state === 'planned' ? styles.planned : styles.retired].join(' ')} title={lifecycleTagTitle(state)} aria-label={label} data-lifecycle={state}>
      {label}
    </span>
  );
}
