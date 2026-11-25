import { useId } from 'react';
import {
  CHOOSABLE_OPTION_APPROACHES,
  NOT_DECIDED_LABEL,
  OPTION_APPROACH_CHOICES,
  OPTION_APPROACH_LABELS,
  type OptionApproach,
} from '../../contracts/optionApproach';
import styles from './OptionApproach.module.css';

/**
 * Walkthrough finding 2 (Simon, 2026-11-20): say what kind of option this is,
 * so a person can tell a custom build from a product at a glance. The value
 * comes from `decision_options.approach`, never from the option's title.
 */

/** The add-option form's question: four plain choices, or leave it for later. */
export function OptionApproachPicker({ value, onChange }: { value: OptionApproach | null; onChange: (value: OptionApproach | null) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>What kind of option is this?</legend>
      {CHOOSABLE_OPTION_APPROACHES.map((approach) => (
        <label key={approach} className={styles.choice}>
          <input type="radio" name={name} checked={value === approach} onChange={() => { onChange(approach); }} />
          {OPTION_APPROACH_CHOICES[approach]}
        </label>
      ))}
      <label className={styles.choice}>
        <input type="radio" name={name} checked={value === null} onChange={() => { onChange(null); }} />
        {NOT_DECIDED_LABEL}
      </label>
    </fieldset>
  );
}

/**
 * The label above an option's title. When the person may edit the option it
 * is a small menu; otherwise plain text. The baseline is always "No change"
 * and is never offered as a choice.
 */
export function OptionApproachLabel({
  approach,
  optionTitle,
  canEdit,
  onChange,
}: {
  approach: OptionApproach | null;
  optionTitle: string;
  canEdit: boolean;
  onChange: (value: OptionApproach | null) => void;
}) {
  const text = approach === null ? NOT_DECIDED_LABEL : OPTION_APPROACH_LABELS[approach];
  if (!canEdit || approach === 'no_change') {
    return <span className={styles.label} data-testid="option-approach">{text}</span>;
  }
  return (
    <select
      className={styles.select}
      data-testid="option-approach"
      aria-label={`What kind of option is “${optionTitle}”?`}
      value={approach ?? ''}
      onChange={(e) => { onChange(e.target.value === '' ? null : (e.target.value as OptionApproach)); }}
    >
      {CHOOSABLE_OPTION_APPROACHES.map((a) => <option key={a} value={a}>{OPTION_APPROACH_LABELS[a]}</option>)}
      <option value="">{NOT_DECIDED_LABEL}</option>
    </select>
  );
}
