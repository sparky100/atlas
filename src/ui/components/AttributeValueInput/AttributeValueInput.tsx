import type { AttributeFieldSchema } from '../../../contracts/attributeSchema';
import type { DraftValue } from '../../elements/useElementEditor';
import styles from './AttributeValueInput.module.css';

export interface AttributeValueInputProps {
  id: string;
  field: AttributeFieldSchema;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  invalid: boolean;
  /** `AttributeEditRow`'s help-text element id, when the field declares `field.help` — wired onto the control so screen readers announce the guidance with it. Absent on every field with no help text. */
  describedBy?: string | undefined;
}

/**
 * One control per attribute `kind` (src/contracts/attributeSchema.ts) — the
 * edit-mode counterpart to AttributeRow's read-only display. Every kind
 * still produces a plain string except `boolean`'s checkbox; normalising
 * that into a real value is `validateAttributeValue`'s job at save time,
 * not this component's.
 *
 * Check C2 (docs/CHECK-U4-2a.md): a `text` field with `multiline: true`
 * (every `description`, `attributeSchema.ts`'s own comment on the flag) is
 * a `<textarea>` instead — min 2 rows, growing with content up to ~8 via
 * `.textarea`'s own `field-sizing: content` (`AttributeValueInput.module.css`),
 * not a fixed-height box the value scrolls inside from the first line.
 */
export function AttributeValueInput({ id, field, value, onChange, invalid, describedBy }: AttributeValueInputProps) {
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
        aria-describedby={describedBy}
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
        aria-describedby={describedBy}
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
        aria-describedby={describedBy}
      >
        <option value="">{field.required ? 'Select…' : (field.emptyLabel ?? '—')}</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {field.optionLabels?.[option] ?? option}
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
        aria-describedby={describedBy}
      />
    );
  }

  if (field.kind === 'link') {
    return (
      <input
        id={id}
        type="url"
        className={styles.input}
        value={stringValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }

  if (field.multiline === true) {
    return (
      <textarea
        id={id}
        rows={2}
        className={styles.textarea}
        value={stringValue}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        aria-invalid={invalid}
        aria-describedby={describedBy}
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
      aria-describedby={describedBy}
    />
  );
}
