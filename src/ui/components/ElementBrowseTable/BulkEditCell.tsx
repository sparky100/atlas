import { useId } from 'react';
import type { AttributeFieldSchema } from '../../../contracts/attributeSchema';
import type { ElementsHeadRow } from '../../../contracts/rows';
import { bulkEditCellKey } from '../../../engine/bulkEdit';
import type { BulkEditController } from '../../elements/useBulkEdit';
import { AttributeValueInput } from '../AttributeValueInput/AttributeValueInput';
import { Text } from '../Text/Text';
import styles from './ElementBrowseTable.module.css';

/** One editable grid cell: the attribute's own control, named for its element, with any save error under it. */
export function BulkEditCell({ element, field, controller }: { element: ElementsHeadRow; field: AttributeFieldSchema; controller: BulkEditController }) {
  const id = useId();
  const error = controller.errors.get(bulkEditCellKey(element.element_id, field.key));
  return (
    <span className={styles.bulkEditCell}>
      <AttributeValueInput
        id={id}
        field={field}
        value={controller.draftFor(element, field.key)}
        onChange={(draft) => {
          controller.setDraft(element, field.key, draft);
        }}
        invalid={error !== undefined}
        ariaLabel={`${field.label} for ${element.name}`}
      />
      {error !== undefined && (
        <Text as="span" size="sm" className={styles.bulkEditError}>
          {error}
        </Text>
      )}
    </span>
  );
}
