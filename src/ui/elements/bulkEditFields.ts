import { attributeDefinitionToFieldSchema, attributeFieldSchema, type AttributeFieldSchema } from '../../contracts/attributeSchema';
import type { ElementsHeadRow } from '../../contracts/rows';
import type { AttributeDefinitionRow } from '../../db/types';

/** The grid's editable columns, by their core attribute key. */
export const BULK_EDIT_CORE_KEYS = { lifecycle: 'lifecycleStatus', criticality: 'criticality', disposition: 'disposition' } as const;

/**
 * The field a grid cell edits for this element, or `null` when the
 * attribute doesn't apply to its type (a capability has no criticality) or
 * isn't directly editable — such a cell stays read-only in edit mode.
 */
export function bulkEditFieldFor(element: ElementsHeadRow, key: string, customDefinition?: AttributeDefinitionRow): AttributeFieldSchema | null {
  if (customDefinition) return customDefinition.applies_to.includes(element.element_type) ? attributeDefinitionToFieldSchema(customDefinition) : null;
  const field = attributeFieldSchema(element.element_type, key);
  return field && field.editable !== false ? field : null;
}
