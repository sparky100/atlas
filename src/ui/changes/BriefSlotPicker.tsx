import { useId } from 'react';
import type { UUID } from '../../contracts/delta';
import { Button } from '../components/Button/Button';
import { Text } from '../components/Text/Text';
import { useRelationshipTargetSearch } from '../elements/useRelationshipTargetSearch';
import type { BriefSlot } from './changeBriefTemplates';
import styles from './DraftWithAi.module.css';
import formStyles from './ChangesView.module.css';

/** A search that can never match a real element, so nothing is excluded from the results. */
const NO_ELEMENT = '00000000-0000-0000-0000-000000000000';

export interface BriefSlotPickerProps {
  slot: BriefSlot;
  value: string;
  onChange: (name: string) => void;
  commitId: UUID;
  modelId: UUID;
  disabled: boolean;
}

/** One blank of a starting-point brief: pick an existing system or capability, or type a name or a date. */
export function BriefSlotPicker({ slot, value, onChange, commitId, modelId, disabled }: BriefSlotPickerProps) {
  const inputId = useId();
  if (slot.kind === 'system' || slot.kind === 'capability') {
    return <ElementSlot slot={slot} value={value} onChange={onChange} commitId={commitId} modelId={modelId} disabled={disabled} />;
  }
  return (
    <div className={styles.slot}>
      <label htmlFor={inputId}>
        <Text as="span" size="sm">
          {slot.label}
        </Text>
      </label>
      <input
        id={inputId}
        className={formStyles.input}
        type={slot.kind === 'date' ? 'date' : 'text'}
        value={value}
        maxLength={slot.kind === 'date' ? undefined : 100}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function ElementSlot({ slot, value, onChange, commitId, modelId, disabled }: BriefSlotPickerProps) {
  const inputId = useId();
  const search = useRelationshipTargetSearch(commitId, modelId, [slot.kind === 'capability' ? 'capability' : 'system'], NO_ELEMENT);

  if (value !== '') {
    return (
      <div className={styles.slot}>
        <Text as="span" size="sm">
          {slot.label}
        </Text>
        <div className={styles.chosen}>
          <Text as="span">
            <strong>{value}</strong>
          </Text>
          <Button
            variant="ghost"
            disabled={disabled}
            aria-label={`Change ${slot.label.toLowerCase()}`}
            onClick={() => {
              search.setQuery('');
              onChange('');
            }}
          >
            Change
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.slot}>
      <label htmlFor={inputId}>
        <Text as="span" size="sm">
          {slot.label}
        </Text>
      </label>
      <input
        id={inputId}
        className={formStyles.input}
        type="text"
        placeholder={slot.kind === 'capability' ? 'Search capabilities…' : 'Search systems…'}
        value={search.query}
        disabled={disabled}
        onChange={(event) => {
          search.setQuery(event.target.value);
        }}
      />
      {search.status === 'loading' && (
        <Text as="p" tone="muted" size="sm">
          Loading…
        </Text>
      )}
      {search.status === 'error' && (
        <p role="alert">Could not load the list. Try again in a moment.</p>
      )}
      {search.results.length > 0 && (
        <ul className={styles.results}>
          {search.results.map((result) => (
            <li key={result.element_id}>
              <button
                type="button"
                className={styles.resultButton}
                disabled={disabled}
                onClick={() => {
                  onChange(result.name);
                }}
              >
                {result.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.status === 'ready' && search.results.length === 0 && (
        <Text as="p" tone="muted" size="sm">
          {search.query.trim() === '' ? `This model has no ${slot.kind === 'capability' ? 'capabilities' : 'systems'} yet.` : 'Nothing found. Check the spelling.'}
        </Text>
      )}
    </div>
  );
}
