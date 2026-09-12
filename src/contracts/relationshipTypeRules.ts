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
  /** Max live relationships with any one `role` value into one element (`owns` only — Prompt 7k item 2: cardinality is per `(toElementId, role)`, not "one owner total", so this caps each role independently, not the target's total owner count). `null` = unbounded. */
  maxPrimaryPerTo: number | null;
  /** Max live relationships with `role: 'primary'` from one element (`supports` only, Sprint U4-1 B4 — the landscape lane a system's tile is placed in). `null` = unbounded. Enforced by a partial unique index (`supabase/migrations`), not by engine validation — see that migration's own comment on why. */
  maxPrimaryPerFrom: number | null;
}

export const RELATIONSHIP_TYPE_RULES: readonly RelationshipTypeRule[] = [
  { relationshipType: 'supports', fromType: 'system', toType: 'capability', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: 1 },
  /**
   * "Platforms and modules": a platform's own `Container` children
   * (modules) support a capability directly, not the platform itself —
   * same cardinality shape as the system row above (`maxPrimaryPerFrom: 1`,
   * one landscape lane per module). Legal for any container, not gated to
   * "only when the container's parent has `kind: 'platform'`" —
   * `RELATIONSHIP_TYPE_RULES` has never expressed anything finer than
   * (relationshipType, fromType, toType), and adding a parent-kind
   * invariant here would be materially more machinery than this feature
   * needs.
   */
  { relationshipType: 'supports', fromType: 'container', toType: 'capability', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: 1 },
  { relationshipType: 'uses', fromType: 'system', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'uses', fromType: 'container', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'uses', fromType: 'component', toType: 'component', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'uses', fromType: 'container', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'uses', fromType: 'component', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  // S1 item 11a: an actor (a person, team, or external organisation) can
  // use a system or container directly — "Ofgem uses the reporting
  // system" is a `uses` edge, not an `owns` one; `owns` stays reserved for
  // actual ownership. Engine validation for the new "external actor" rule
  // this item also adds (C20, delta.ts) lives on `owns` only — a `uses`
  // edge from an external actor needs no extra check beyond this triple
  // being legal at all.
  { relationshipType: 'uses', fromType: 'actor', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'uses', fromType: 'actor', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'owns', fromType: 'actor', toType: 'capability', maxPerFrom: null, maxPrimaryPerTo: 1, maxPrimaryPerFrom: null },
  { relationshipType: 'owns', fromType: 'actor', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: 1, maxPrimaryPerFrom: null },
  { relationshipType: 'flows_to', fromType: 'system', toType: 'system', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
  { relationshipType: 'flows_to', fromType: 'container', toType: 'container', maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null },
] as const;

/** The rule for a triple, or `undefined` if the triple isn't legal (C9/V3). */
export function findRelationshipTypeRule(relationshipType: RelationshipType, fromType: ElementType, toType: ElementType): RelationshipTypeRule | undefined {
  return RELATIONSHIP_TYPE_RULES.find((rule) => rule.relationshipType === relationshipType && rule.fromType === fromType && rule.toType === toType);
}

/** C9/V3's own predicate: is `(relationshipType, fromType, toType)` in `RELATIONSHIP_TYPE_RULES`? */
export function isRelationshipTripleAllowed(relationshipType: RelationshipType, fromType: ElementType, toType: ElementType): boolean {
  return findRelationshipTypeRule(relationshipType, fromType, toType) !== undefined;
}

/** One relationship "+ Add" slot (Blocking: element creation's relationship-add control, RelationshipsSection.tsx): a type plus every element type legally on the other end — more than one when the same `(relationshipType, direction)` allows different target types (e.g. a container `uses` either a container or a system). */
export interface RelationshipGroupSlot {
  relationshipType: RelationshipType;
  targetTypes: ElementType[];
}

function groupSlotsFor(elementType: ElementType, thisSide: 'fromType' | 'toType', otherSide: 'fromType' | 'toType'): RelationshipGroupSlot[] {
  const targetTypesByRelationship = new Map<RelationshipType, Set<ElementType>>();
  for (const rule of RELATIONSHIP_TYPE_RULES) {
    if (rule[thisSide] !== elementType) continue;
    const set = targetTypesByRelationship.get(rule.relationshipType) ?? new Set<ElementType>();
    set.add(rule[otherSide]);
    targetTypesByRelationship.set(rule.relationshipType, set);
  }
  return [...targetTypesByRelationship.entries()].map(([relationshipType, targetTypes]) => ({ relationshipType, targetTypes: [...targetTypes] }));
}

/** Every relationship type `elementType` can be the *from* side of, with the legal target type(s) for the *to* side. */
export function outboundRelationshipGroups(elementType: ElementType): RelationshipGroupSlot[] {
  return groupSlotsFor(elementType, 'fromType', 'toType');
}

/** Every relationship type `elementType` can be the *to* side of, with the legal target type(s) for the *from* side. */
export function inboundRelationshipGroups(elementType: ElementType): RelationshipGroupSlot[] {
  return groupSlotsFor(elementType, 'toType', 'fromType');
}
