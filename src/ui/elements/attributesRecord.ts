import type { Json } from '../../contracts/rows';

/** `Json`'s union includes non-object variants at the type level; an element/relationship's `attributes` is always an object at runtime (SPEC §3.5's `default '{}'`) — this is the one place that assumption is made explicit, shared by every component that reads a specific attribute key off a head row. */
export function attributesRecord(attributes: Json): Record<string, Json> {
  return attributes !== null && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
}
