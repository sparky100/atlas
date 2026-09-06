import { useId } from 'react';
import type { AttributeFieldSchema } from '../../../contracts/attributeSchema';
import type { DraftValue } from '../../elements/useElementEditor';
import { AttributeValueInput } from '../AttributeValueInput/AttributeValueInput';
import { Text } from '../Text/Text';
import styles from './AttributeEditRow.module.css';

export interface AttributeEditRowProps {
  field: AttributeFieldSchema;
  value: DraftValue;
  onChange: (value: DraftValue) => void;
  error: string | undefined;
}

/** Edit-mode counterpart to AttributeRow (§4.3's read-only row) — one per editable field, `Edit` (§4.2) replaces the whole Attributes section with these. Non-editable fields (Capability.templateRef) never reach here — src/ui/elements/useElementEditor.ts skips them building its draft state, the same place ATTRIBUTE_SCHEMA_BY_TYPE says they aren't. */
export function AttributeEditRow({ field, value, onChange, error }: AttributeEditRowProps) {
  const id = useId();
  return (
    <div className={styles.row}>
      <label htmlFor={id}>
        <Text tone="muted" as="span">
          {field.label}
          {field.required ? ' *' : ''}
        </Text>
      </label>
      <div className={styles.value}>
        <AttributeValueInput id={id} field={field} value={value} onChange={onChange} invalid={error !== undefined} />
        {error !== undefined && (
          <Text as="span" className={styles.error} size="sm">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}
