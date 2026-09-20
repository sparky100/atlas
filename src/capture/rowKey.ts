/**
 * F2 (full K1) PR9, SPEC-capture.md §9.1: `row_key` — identifies "the
 * same row" across re-import runs of the same document lineage, priority
 * order: an `atlasId`, then a source-system key, then name+type+parent.
 * The same triple `(type, normaliseName(name), normaliseName(parent) | '')`
 * §5.2's own intra-document grouping already uses for the name-fallback
 * case, so a row's key is stable whether it collapsed with duplicates in
 * this run or not.
 *
 * Pure string composition; every input here is already resolved by the
 * caller (`rowsToCandidates.ts`'s own `matchHints`, or a relationship's
 * own resolved endpoints) — this module has no matching logic of its own.
 */
import type { ElementType, RelationshipType, UUID } from '../contracts/delta';
import { normaliseName } from './normalise';

export interface ElementRowKeyInput {
  elementType: ElementType;
  name: string;
  /** The document's own stated parent name for this row (a container's own parent system, a capability's own parent) — matches the triple intra-document grouping already uses (§5.2). `null`/undefined for a top-level row. */
  parentName?: string | null;
  /** §7.3 level 1 — an `atlasId` column value the document itself names for this row. */
  atlasId?: UUID;
  /** §7.3 level 2 — every source-system key the document carries for this row; the first one wins when more than one is present (a row key identifies one row, not a set). */
  sourceKeys?: readonly string[];
}

export function elementRowKey(input: ElementRowKeyInput): string {
  if (input.atlasId !== undefined) return `id:${input.atlasId}`;
  const sourceKey = input.sourceKeys?.[0];
  if (sourceKey !== undefined) return `key:${normaliseName(sourceKey)}`;
  return `name:${input.elementType}:${normaliseName(input.name)}:${input.parentName ? normaliseName(input.parentName) : ''}`;
}

/**
 * §9.1: "A relationship candidate's key is rel:{type}:{fromKey}→{toKey}".
 * `fromKey`/`toKey` are each endpoint's own row key — an `elementRowKey()`
 * call for an endpoint this same run also proposed, or the equivalent
 * computed from an already-matched main element's own name/type when the
 * endpoint is pre-existing. Composing those is the caller's own job
 * (it's the one with the resolved endpoints in hand), not this function's.
 */
export function relationshipRowKey(relationshipType: RelationshipType, fromKey: string, toKey: string): string {
  return `rel:${relationshipType}:${fromKey}→${toKey}`;
}
