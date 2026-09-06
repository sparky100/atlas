/**
 * `RELATIONSHIP_TYPE_RULES` (ADR-001, SPEC-data-model.md §3.3, C9/V3):
 * which `(relationshipType, fromType, toType)` triples are legal, and
 * cardinality. SPEC deferred the *table* (`relationship_type_rules`) to a
 * later sprint alongside `type_schemas` — see that section's own note — but
 * unlike `type_schemas` (real JSON-Schema infrastructure the element page
 * never needed), this taxonomy has been fully known since ADR-001 and has
 * zero runtime enforcement anywhere without it (Sprint H1, per
 * docs/AUDIT-2026-09-U2.md §6.2/§6.3). It is a constant here, not a table,
 * for the same reason attribute definitions live in `src/contracts` rather
 * than in `type_schemas` today: the taxonomy is code until Sprint K1's
 * capture pipeline needs it to be queryable product content instead.
 *
 * The seed rows below are transcribed verbatim from SPEC-data-model.md
 * §3.3's `relationship_type_rules` seed table — this constant is that
 * table's content, not a fresh design.
 */
import type { ElementType, RelationshipType } from './delta';

export interface RelationshipTypeRule {
  relationshipType: RelationshipType;
  fromType: ElementType;
  toType: ElementType;
  /** Max live relationships of this type from one element. `null` = unbounded. */
  maxPerFrom: number | null;
  /** Max live relationships with `primary: true` into one element (`owns` only). `null` = unbounded. */
  maxPrimaryPerTo: number | null;
}

export const RELATIONSHIP_TYPE_RULES: readonly RelationshipTypeRule[] = [
  { relationshipType: 'supports', fromType: 'system', toType: 'capability', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'uses', fromType: 'system', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'uses', fromType: 'container', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'uses', fromType: 'component', toType: 'component', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'uses', fromType: 'container', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'uses', fromType: 'component', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'owns', fromType: 'actor', toType: 'capability', maxPerFrom: null, maxPrimaryPerTo: 1 },
  { relationshipType: 'owns', fromType: 'actor', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: 1 },
  { relationshipType: 'flows_to', fromType: 'system', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null },
  { relationshipType: 'flows_to', fromType: 'container', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null },
] as const;

/** The rule for a triple, or `undefined` if the triple isn't legal (C9/V3). */
export function findRelationshipTypeRule(relationshipType: RelationshipType, fromType: ElementType, toType: ElementType): RelationshipTypeRule | undefined {
  return RELATIONSHIP_TYPE_RULES.find((rule) => rule.relationshipType === relationshipType && rule.fromType === fromType && rule.toType === toType);
}

/** C9/V3's own predicate: is `(relationshipType, fromType, toType)` in `RELATIONSHIP_TYPE_RULES`? */
export function isRelationshipTripleAllowed(relationshipType: RelationshipType, fromType: ElementType, toType: ElementType): boolean {
  return findRelationshipTypeRule(relationshipType, fromType, toType) !== undefined;
}
