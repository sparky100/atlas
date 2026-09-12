import { describe, expect, it } from 'vitest';
import { RELATIONSHIP_TYPES } from './delta';
import { RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE, validateRelationshipAttributeValue } from './relationshipAttributeSchema';

describe('RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE', () => {
  it('has a schema for every relationship type', () => {
    for (const type of RELATIONSHIP_TYPES) {
      expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[type].length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate keys within a type', () => {
    for (const type of RELATIONSHIP_TYPES) {
      const keys = RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[type].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never lists `via` — it is an element reference, rendered separately by RelationshipsSection.tsx, not through this schema', () => {
    for (const type of RELATIONSHIP_TYPES) {
      expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[type].some((f) => f.key === 'via')).toBe(false);
    }
  });

  it('every field declares a kind, and enum fields declare their allowed values', () => {
    for (const type of RELATIONSHIP_TYPES) {
      for (const field of RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        expect(field.kind).toBeTruthy();
        if (field.kind === 'enum') expect(field.options?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("uses'/flows_to's description is labelled and required as the verb phrase (SPEC §3's own decision)", () => {
    expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.uses.find((f) => f.key === 'description')).toMatchObject({ label: 'Verb phrase', required: true });
    expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.flows_to.find((f) => f.key === 'description')).toMatchObject({ label: 'Verb phrase', required: true });
  });

  it('supports.role and owns.role are each required enums with the right options', () => {
    expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.supports.find((f) => f.key === 'role')).toMatchObject({ required: true, kind: 'enum', options: ['primary', 'secondary'] });
    expect(RELATIONSHIP_ATTRIBUTE_SCHEMA_BY_TYPE.owns.find((f) => f.key === 'role')).toMatchObject({ required: true, kind: 'enum', options: ['business', 'technical', 'service'] });
  });
});

describe('validateRelationshipAttributeValue', () => {
  it('accepts a trimmed verb phrase and rejects an empty one on uses', () => {
    expect(validateRelationshipAttributeValue('uses', 'description', '  reads customer records from  ')).toEqual({ ok: true, value: 'reads customer records from' });
    expect(validateRelationshipAttributeValue('uses', 'description', '')).toEqual({ ok: false, error: 'Verb phrase is required' });
  });

  it('accepts a valid supports.role and rejects an unknown one', () => {
    expect(validateRelationshipAttributeValue('supports', 'role', 'primary')).toEqual({ ok: true, value: 'primary' });
    expect(validateRelationshipAttributeValue('supports', 'role', 'tertiary').ok).toBe(false);
  });

  it('clears an optional field (flows_to.dataClassification) to null when left empty', () => {
    expect(validateRelationshipAttributeValue('flows_to', 'dataClassification', '')).toEqual({ ok: true, value: null });
  });

  it('rejects an attribute this relationship type does not have', () => {
    expect(validateRelationshipAttributeValue('supports', 'protocol', 'https').ok).toBe(false);
  });

  it('refuses to validate `via` — not directly editable through this schema', () => {
    expect(validateRelationshipAttributeValue('uses', 'via', 'anything').ok).toBe(false);
  });
});
