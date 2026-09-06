import type { AttributeFieldSchema } from '../../../contracts/attributeSchema';
import type { DraftValue } from '../../elements/useElementEditor';
import styles from './AttributeValueInput.module.css';

export interface AttributeValueInputProps {
  id: string;
  field: AttributeFieldSchema;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  invalid: boolean;
}

/**
 * One control per attribute `kind` (src/contracts/attributeSchema.ts) — the
 * edit-mode counterpart to AttributeRow's read-only display. Every kind
 * still produces a plain string except `boolean`'s checkbox; normalising
 * that into a real value is `validateAttributeValue`'s job at save time,
 * not this component's.
 */
export function AttributeValueInput({ id, field, value, onChange, invalid }: AttributeValueInputProps) {
  const stringValue = typeof value === 'string' ? value : '';

  if (field.kind === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        className={styles.checkbox}
        checked={value === true}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        aria-invalid={invalid}
      />
    );
  }

  if (field.kind === 'date') {
    return (
      <input
        id={id}
        type="date"
        className={styles.input}
        value={stringValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={invalid}
      />
    );
  }

  if (field.kind === 'enum') {
    return (
      <select
        id={id}
        className={styles.input}
        value={stringValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={invalid}
      >
        <option value="">{field.required ? 'Select…' : '—'}</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'number') {
    return (
      <input
        id={id}
        type="number"
        className={styles.input}
        value={stringValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={invalid}
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      className={styles.input}
      value={stringValue}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      aria-invalid={invalid}
    />
  );
}
