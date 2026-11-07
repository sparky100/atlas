import type { Json } from '../../contracts/rows';

/** `Json`'s union includes non-object variants at the type level; an element/relationship's `attributes` is always an object at runtime (SPEC §3.5's `default '{}'`) — this is the one place that assumption is made explicit, shared by every component that reads a specific attribute key off a head row. */
export function attributesRecord(attributes: Json): Record<string, Json> {
  return attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
}

/** A custom attribute's raw `Json` value, formatted the same way for a table cell and a CSV export (`ElementBrowseTable.tsx`, `elementBrowseCsv.ts`, F8 issue #162) — one place so the two can never drift apart. */
export function formatCustomAttributeValue(value: Json | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
