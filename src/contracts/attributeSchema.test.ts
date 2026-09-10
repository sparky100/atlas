import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from './delta';
import { ATTRIBUTE_SCHEMA_BY_TYPE, defaultCreateAttributes, validateAttributeValue } from './attributeSchema';

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

  it('every field declares a kind, and enum fields declare their allowed values', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        expect(field.kind).toBeTruthy();
        if (field.kind === 'enum') expect(field.options?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('has no `level` field on capability — it is computed from parent_id depth (ADR-016), never a stored, independently-editable attribute', () => {
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.capability.some((f) => f.key === 'level')).toBe(false);
  });

  it('Sprint U4-1 D2: only Capability.templateRef is hidden from the read-only attributes list — every other field, including its own not-editable sibling `order`, still shows', () => {
    const capability = ATTRIBUTE_SCHEMA_BY_TYPE.capability;
    expect(capability.find((f) => f.key === 'templateRef')?.hidden).toBe(true);
    expect(capability.find((f) => f.key === 'order')?.hidden).not.toBe(true);
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (field.key !== 'templateRef') expect(field.hidden).not.toBe(true);
      }
    }
  });

  it('check C2: every `description` field is multiline; no other field is — a short field like Code/Vendor/Email never gets the auto-growing textarea', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (field.key === 'description') expect(field.multiline).toBe(true);
        else expect(field.multiline).not.toBe(true);
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
});

describe('defaultCreateAttributes', () => {
  it('defaults every required boolean field to false and every other required enum to its schema-declared first option', () => {
    expect(defaultCreateAttributes('container')).toEqual({ isExternal: false });
    expect(defaultCreateAttributes('actor')).toEqual({ subtype: 'person', isExternal: false });
  });

  it('has no required fields to default for capability or component', () => {
    expect(defaultCreateAttributes('capability')).toEqual({});
    expect(defaultCreateAttributes('component')).toEqual({});
  });

  it("defaults a system's lifecycleStatus to active on main — an architect quick-adding it is recording an estate that already exists", () => {
    expect(defaultCreateAttributes('system', { onMain: true })).toEqual({ lifecycleStatus: 'active', isExternal: false });
  });

  it("defaults a system's lifecycleStatus to planned off main — a system proposed on a change branch isn't live yet", () => {
    expect(defaultCreateAttributes('system', { onMain: false })).toEqual({ lifecycleStatus: 'planned', isExternal: false });
  });

  it('defaults onMain to true when omitted', () => {
    expect(defaultCreateAttributes('system')).toEqual({ lifecycleStatus: 'active', isExternal: false });
  });
});
