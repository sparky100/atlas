import { Chip } from '../../components/Chip/Chip';
import { Text } from '../../components/Text/Text';
import type { DerivedChangeSteps } from '../changeStepper';
import styles from './Stepper.module.css';

export interface StepperProps {
  derived: DerivedChangeSteps;
}

/**
 * Sprint 7i item 1's status stepper — a horizontal line of the five real
 * steps (`changeStepper.ts`'s own comment has the full state-machine
 * mapping), each dot styled by its `passed`/`current`/`upcoming` state,
 * plus the one sentence explaining the current step. Rejected renders as a
 * side exit next to the line, not a sixth dot on it — the prompt's own
 * wording ("Rejected as a side exit").
 */
export function Stepper({ derived }: StepperProps) {
  return (
    <div className={styles.stepper}>
      <ol className={styles.line}>
        {derived.steps.map((step) => (
          <li key={step.key} className={[styles.step, styles[step.state]].join(' ')}>
            <span className={styles.dot} aria-hidden="true" />
            <Text as="span" size="sm" tone={step.state === 'upcoming' ? 'muted' : 'default'}>
              {step.label}
            </Text>
          </li>
        ))}
        {derived.rejected && (
          <li className={styles.rejectedExit}>
            <Chip tone="danger">Rejected</Chip>
          </li>
        )}
      </ol>
      <Text as="p" tone="muted" size="sm" className={styles.sentence}>
        {derived.sentence}
      </Text>
    </div>
  );
}
