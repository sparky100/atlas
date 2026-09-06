import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from './delta';
import { ATTRIBUTE_SCHEMA_BY_TYPE, validateAttributeValue } from './attributeSchema';

describe('ATTRIBUTE_SCHEMA_BY_TYPE', () => {
  it('has a schema for every element type', () => {
    for (const type of ELEMENT_TYPES) {
      expect(ATTRIBUTE_SCHEMA_BY_TYPE[type].length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate keys within a type', () => {
    for (const type of ELEMENT_TYPES) {
      const keys = ATTRIBUTE_SCHEMA_BY_TYPE[type].map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("system's required fields match SystemAttributes' own required fields (lifecycleStatus, isExternal)", () => {
    const required = ATTRIBUTE_SCHEMA_BY_TYPE.system.filter((f) => f.required).map((f) => f.key);
    expect(required.sort()).toEqual(['isExternal', 'lifecycleStatus']);
  });

  it('every field declares a kind, and enum/number fields declare their allowed values', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        expect(field.kind).toBeTruthy();
        if (field.kind === 'enum') expect(field.options?.length ?? 0).toBeGreaterThan(0);
        if (field.kind === 'number' && field.allowedNumbers) expect(field.allowedNumbers.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('validateAttributeValue', () => {
  it('rejects clearing a required field', () => {
    expect(validateAttributeValue('system', 'lifecycleStatus', '')).toEqual({ ok: false, error: 'Lifecycle is required' });
    expect(validateAttributeValue('system', 'isExternal', undefined)).toMatchObject({ ok: false });
  });

  it('normalises clearing an optional field to null', () => {
    expect(validateAttributeValue('system', 'vendor', '')).toEqual({ ok: true, value: null });
    expect(validateAttributeValue('system', 'introduced', undefined)).toEqual({ ok: true, value: null });
  });

  it('rejects an unknown attribute', () => {
    expect(validateAttributeValue('system', 'notARealField', 'x')).toMatchObject({ ok: false });
  });

  it('refuses to validate a non-editable field (Capability.templateRef)', () => {
    expect(validateAttributeValue('capability', 'templateRef', 'anything')).toMatchObject({ ok: false });
  });

  it('validates boolean fields strictly by type, not truthiness', () => {
    expect(validateAttributeValue('system', 'isExternal', true)).toEqual({ ok: true, value: true });
    expect(validateAttributeValue('system', 'isExternal', 'true')).toMatchObject({ ok: false });
  });

  it('trims text fields', () => {
    expect(validateAttributeValue('system', 'vendor', '  Acme  ')).toEqual({ ok: true, value: 'Acme' });
  });

  it('validates dates, rejecting malformed and out-of-range calendar dates', () => {
    expect(validateAttributeValue('system', 'introduced', '2026-01-15')).toEqual({ ok: true, value: '2026-01-15' });
    expect(validateAttributeValue('system', 'introduced', '15/01/2026')).toMatchObject({ ok: false });
    expect(validateAttributeValue('system', 'introduced', '2026-02-30')).toMatchObject({ ok: false });
  });

  it('validates enum fields against the declared options', () => {
    expect(validateAttributeValue('system', 'lifecycleStatus', 'active')).toEqual({ ok: true, value: 'active' });
    expect(validateAttributeValue('system', 'lifecycleStatus', 'deprecated')).toMatchObject({ ok: false });
  });

  it('validates a number field against its allowed set (Capability.level)', () => {
    expect(validateAttributeValue('capability', 'level', '2')).toEqual({ ok: true, value: 2 });
    expect(validateAttributeValue('capability', 'level', 4)).toMatchObject({ ok: false });
    expect(validateAttributeValue('capability', 'level', 'not a number')).toMatchObject({ ok: false });
  });
});
