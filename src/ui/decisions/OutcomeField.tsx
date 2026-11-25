import { Text } from '../components/Text/Text';

export const OUTCOME_LABEL = 'Outcome: what will be better, for whom, by when';
export const OUTCOME_PLACEHOLDER = 'e.g. Issue a connection quote in two days, not ten, by March 2027';
/** The most an outcome may run to (the database allows the same). */
export const OUTCOME_MAX_CHARS = 1000;

/** The outcome the business wants, in one plain sentence (item 3). Used by both "start a decision" forms and the decision's own edit form. */
export function OutcomeField({ value, onChange, className, focusOnOpen = false }: { value: string; onChange: (value: string) => void; className: string | undefined; focusOnOpen?: boolean }) {
  return (
    <label>
      <Text as="span" size="sm">
        {OUTCOME_LABEL}
      </Text>
      <textarea
        className={className}
        aria-label={OUTCOME_LABEL}
        placeholder={OUTCOME_PLACEHOLDER}
        rows={2}
        // Only when the person pressed "Add the outcome", which asked for exactly this box.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={focusOnOpen}
        maxLength={OUTCOME_MAX_CHARS}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}
