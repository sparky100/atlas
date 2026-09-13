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

  it('S1 item 20: uses and flows_to reach container<->system in both directions', () => {
    expect(findRelationshipTypeRule('uses', 'container', 'system')).toBeDefined();
    expect(findRelationshipTypeRule('uses', 'system', 'container')).toBeDefined();
    expect(findRelationshipTypeRule('flows_to', 'container', 'system')).toBeDefined();
    expect(findRelationshipTypeRule('flows_to', 'system', 'container')).toBeDefined();
  });

  it('S1 item 20: the three new rows have no cardinality cap, same as every other uses/flows_to row', () => {
    expect(findRelationshipTypeRule('uses', 'system', 'container')).toMatchObject({ maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null });
    expect(findRelationshipTypeRule('flows_to', 'container', 'system')).toMatchObject({ maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null });
    expect(findRelationshipTypeRule('flows_to', 'system', 'container')).toMatchObject({ maxPerFrom: null, maxPrimaryPerTo: null, maxPrimaryPerFrom: null });
  });

  it('S1 item 20: uses/flows_to still never reach a capability or an actor endpoint beyond what 11a already allows', () => {
    expect(findRelationshipTypeRule('uses', 'system', 'capability')).toBeUndefined();
    expect(findRelationshipTypeRule('flows_to', 'container', 'capability')).toBeUndefined();
    expect(findRelationshipTypeRule('flows_to', 'system', 'actor')).toBeUndefined();
  });
});
