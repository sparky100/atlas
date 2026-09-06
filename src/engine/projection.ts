/**
 * Serialises a folded `Head` (src/engine/deltas.ts) into the row shapes
 * `atlas.replace_main_head_projection` writes verbatim (SPEC §6.5's
 * "materialise" step). Pure, no I/O — src/db/commits.ts calls this after
 * folding, then passes the result as jsonb to the `commit_deltas` RPC.
 *
 * `deserializeHeadProjection` (below) is the reverse: rows already read
 * back from `elements_head`/`relationships_head`/`facts` → a `Head`-shaped
 * value, for the one place this codebase needs to hash *whatever the
 * materialised projection currently says* rather than a freshly-folded
 * one — src/db/tags.ts's tag-creation check (SPEC §6.6 point 3: "fold(commit)
 * is recomputed from genesis before the tag row is inserted", verified
 * against the live projection so a corrupted `elements_head` row — P-7 —
 * is caught, not silently tagged over).
 *
 * Kept in src/engine, not src/contracts: this is a transformation of the
 * engine's own `Head`, and src/contracts has no reason to import engine
 * types (the dependency runs the other way — engine depends on contracts).
 */
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { ElementRow, FactRow, Head, RelationshipRow } from './deltas';
import { emptyHead, factMapKey } from './deltas';

export interface HeadProjection {
  elementsHead: ElementsHeadRow[];
  relationshipsHead: RelationshipsHeadRow[];
  facts: FactsRow[];
}

export function serializeHeadProjection(head: Head): HeadProjection {
  const elementsHead: ElementsHeadRow[] = Array.from(head.elements, ([elementId, row]) => ({
    element_id: elementId,
    element_type: row.elementType,
    name: row.name,
    parent_id: row.parentId,
    attributes: row.attributes,
    exists_delta_id: row.existsDeltaId,
  }));

  const relationshipsHead: RelationshipsHeadRow[] = Array.from(head.relationships, ([relationshipId, row]) => ({
    relationship_id: relationshipId,
    relationship_type: row.relationshipType,
    from_element_id: row.fromElementId,
    to_element_id: row.toElementId,
    attributes: row.attributes,
    exists_delta_id: row.existsDeltaId,
  }));

  // Every subject appearing in a live fact is currently either an element
  // or a relationship — never both, never neither: `head.facts` only holds
  // facts for currently-existing subjects (a retract removes them, per
  // deltas.ts's deleteAllFactsFor), and element/relationship ids are
  // disjoint by construction.
  const facts: FactsRow[] = Array.from(head.facts.values()).map((fact) => ({
    subject_type: head.elements.has(fact.subjectId) ? 'element' : 'relationship',
    subject_id: fact.subjectId,
    attribute: fact.attribute,
    value: fact.value,
    delta_id: fact.deltaId,
    source_id: fact.sourceId,
    source_ref: fact.sourceRef ?? null,
    effective_date: fact.effectiveDate ?? null,
    confidence: fact.confidence,
    asserted_by: fact.authorId,
    asserted_at: fact.createdAt,
  }));

  return { elementsHead, relationshipsHead, facts };
}

/**
 * The reverse of `serializeHeadProjection`: rows read back from
 * `elements_head`/`relationships_head`/`facts` at one commit → a `Head`
 * whose `elements`/`relationships`/`facts` maps are exactly what
 * `canonicalizeHead`/`headHash` need (src/engine/head.ts) to hash it.
 * `retractedElements`/`retractedRelationships`/`factHistory` are left
 * empty — `apply`'s own bookkeeping, never part of a `Head`'s identity
 * (Head's own doc comment), so a caller that only ever hashes or reads
 * this result (never folds further deltas onto it) doesn't need them
 * populated correctly.
 */
export function deserializeHeadProjection(elementsHead: readonly ElementsHeadRow[], relationshipsHead: readonly RelationshipsHeadRow[], facts: readonly FactsRow[]): Head {
  const head: Head = emptyHead();

  for (const row of elementsHead) {
    const element: ElementRow = { elementType: row.element_type, name: row.name, parentId: row.parent_id, attributes: (row.attributes ?? {}) as Record<string, ElementRow['attributes'][string]>, existsDeltaId: row.exists_delta_id };
    head.elements.set(row.element_id, element);
  }

  for (const row of relationshipsHead) {
    const relationship: RelationshipRow = {
      relationshipType: row.relationship_type,
      fromElementId: row.from_element_id,
      toElementId: row.to_element_id,
      attributes: (row.attributes ?? {}) as Record<string, RelationshipRow['attributes'][string]>,
      existsDeltaId: row.exists_delta_id,
    };
    head.relationships.set(row.relationship_id, relationship);
  }

  for (const row of facts) {
    const fact: FactRow = {
      subjectId: row.subject_id,
      attribute: row.attribute,
      deltaId: row.delta_id,
      sourceId: row.source_id,
      ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
      ...(row.effective_date !== null ? { effectiveDate: row.effective_date } : {}),
      confidence: row.confidence,
      authorId: row.asserted_by,
      createdAt: row.asserted_at,
      value: row.value,
    };
    head.facts.set(factMapKey(row.subject_id, row.attribute), fact);
  }

  return head;
}
