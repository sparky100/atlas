import { describe, expect, it } from 'vitest';
import { findRelationshipTypeRule, RELATIONSHIP_TYPE_RULES } from './relationshipTypeRules';

describe('RELATIONSHIP_TYPE_RULES', () => {
  it('has no duplicate (relationshipType, fromType, toType) triples', () => {
    const keys = RELATIONSHIP_TYPE_RULES.map((r) => `${r.relationshipType}:${r.fromType}:${r.toType}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('S1 item 11a: an actor can use a system or a container directly ("Ofgem uses the reporting system")', () => {
    expect(findRelationshipTypeRule('uses', 'actor', 'system')).toBeDefined();
    expect(findRelationshipTypeRule('uses', 'actor', 'container')).toBeDefined();
  });

  it('S1 item 11a: an actor still cannot use a capability, or flow to anything at all', () => {
    expect(findRelationshipTypeRule('uses', 'actor', 'capability')).toBeUndefined();
    expect(findRelationshipTypeRule('flows_to', 'actor', 'system')).toBeUndefined();
  });

  it('an actor uses/container edge has no cardinality cap, same as every other uses row', () => {
    expect(findRelationshipTypeRule('uses', 'actor', 'system')).toMatchObject({ maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null });
    expect(findRelationshipTypeRule('uses', 'actor', 'container')).toMatchObject({ maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null });
  });
});
