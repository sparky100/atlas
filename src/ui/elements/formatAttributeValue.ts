import type { Json } from '../../contracts/delta';

/**
 * A stored attribute value, formatted for plain-text display — shared by
 * `AttributeRow.tsx` (the Attributes section) and `HistoryTimeline.tsx`
 * (an `element_update`/`relationship_update` entry's own value), so the
 * same fact reads the same way in both places rather than one showing
 * `true`/`false` and raw `JSON.stringify` quoting where the other shows
 * `Yes`/`No` and a plain string.
 */
export function formatAttributeValue(value: Json | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
