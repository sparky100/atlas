import type { MergeRequestRow } from '../../db/types';
import type { MergeClassification } from '../../engine/merge';

/**
 * `merge_requests.classification` round-trips a `MergeClassification`
 * (src/engine/merge.ts) through jsonb losslessly — every field is a plain
 * string/number/boolean/array/object — so this is a direct cast, not a
 * schema-checked parse, same as src/db/mergeRequests.ts's own
 * `classificationJson` going the other way. `null` only for a request
 * whose cached value somehow isn't shaped like one at all (never produced
 * by this codebase's own writers, but this reads a jsonb column, not a
 * type-checked value).
 */
export function cachedClassification(row: MergeRequestRow): MergeClassification | null {
  const c = row.classification;
  if (!('findings' in c) || !Array.isArray(c.findings)) return null;
  return c as unknown as MergeClassification;
}
