import { useState } from 'react';
import { Button } from '../Button/Button';
import { Text } from '../Text/Text';
import styles from './TypedNameConfirm.module.css';

export interface TypedNameConfirmProps {
  /** The exact name the reader must type — a model's or organisation's own name. */
  requiredName: string;
  /** The action label on the enabled button, e.g. "Delete model". */
  actionLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}

/**
 * Sprint 7j's typed-name delete confirmation (model settings item 1, org
 * settings item 2: "typed-name confirmation"). A genuine extra safety step,
 * not a stand-in for one — CLAUDE.md rule 7 rules out *fake* confirmation
 * UI, not a real extra gate; every other irreversible action in this
 * product (`RemoveFromModelAction.tsx`'s real listed-content confirm —
 * the plain `window.confirm()` its own predecessor,
 * `CapabilityRetractAction.tsx`, used to reach for, is gone as of Prompt
 * 7k item 5) uses a lighter confirmation instead, since typing the exact
 * name back is a materially higher bar, deliberately reserved for the two
 * actions in this sprint that delete an entire model or organisation.
 */
export function TypedNameConfirm({ requiredName, actionLabel, onConfirm, disabled = false }: TypedNameConfirmProps) {
  const [value, setValue] = useState('');
  const matches = value === requiredName;

  return (
    <div className={styles.confirm}>
      <Text as="label" size="sm">
        Type <Text as="span" mono size="sm">{requiredName}</Text> to confirm.
      </Text>
      <input
        className={styles.input}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        disabled={disabled}
        aria-label={`Type ${requiredName} to confirm`}
      />
      <Button variant="destructive" disabled={disabled || !matches} onClick={onConfirm}>
        {actionLabel}
      </Button>
    </div>
  );
}
