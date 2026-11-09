import { useId } from 'react';
import { AS_AT_PRESETS, parseAsAtParam, presetAsAt } from './asAt';
import { Text } from '../components/Text/Text';
import styles from './AsAtControl.module.css';

export interface AsAtControlProps {
  /** A future date, or `null` for today. */
  asAt: string | null;
  todayIso: string;
  highlightChanges: boolean;
  onChange: (asAt: string | null) => void;
  onHighlightChange: (highlight: boolean) => void;
}

/**
 * "View as at": Today, 6 months, 1 year, 2 years, or any later date. Only
 * today and the future — the landscape is not a history view. A preset is
 * pressed when the chosen date is exactly what it points at; any other date
 * leaves all presets unpressed and shows in the date field.
 */
export function AsAtControl({ asAt, todayIso, highlightChanges, onChange, onHighlightChange }: AsAtControlProps) {
  const dateId = useId();
  return (
    <div className={styles.wrap} role="group" aria-label="View the landscape as at a date">
      <Text as="span" size="sm" tone="muted">
        View as at
      </Text>
      <div className={styles.group}>
        {AS_AT_PRESETS.map((preset) => {
          const target = presetAsAt(preset, todayIso);
          return (
            <button
              key={preset.label}
              type="button"
              className={styles.preset}
              aria-pressed={target === asAt}
              onClick={() => {
                onChange(target);
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <label htmlFor={dateId}>
        <Text as="span" size="sm" tone="muted">
          or pick a date
        </Text>
      </label>
      <input
        id={dateId}
        className={styles.date}
        type="date"
        min={nextDay(todayIso)}
        value={asAt ?? ''}
        onChange={(e) => {
          onChange(parseAsAtParam(e.target.value, todayIso));
        }}
      />
      {asAt !== null && (
        <label className={styles.compare}>
          <input
            type="checkbox"
            checked={highlightChanges}
            onChange={(e) => {
              onHighlightChange(e.target.checked);
            }}
          />
          <Text as="span" size="sm" tone="muted">
            Highlight what changes from today
          </Text>
        </label>
      )}
    </div>
  );
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
