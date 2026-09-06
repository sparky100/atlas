/**
 * Serialises a folded `Head` (src/engine/deltas.ts) into the row shapes
 * `atlas.replace_main_head_projection` writes verbatim (SPEC §6.5's
 * "materialise" step). Pure, no I/O — src/db/commits.ts calls this after
 * folding, then passes the result as jsonb to the `commit_deltas` RPC.
 *
 * Kept in src/engine, not src/contracts: this is a transformation of the
 * engine's own `Head`, and src/contracts has no reason to import engine
 * types (the dependency runs the other way — engine depends on contracts).
 */
import type { ElementsHeadRow, FactsRow, RelationshipsHeadRow } from '../contracts/rows';
import type { Head } from './deltas';

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
