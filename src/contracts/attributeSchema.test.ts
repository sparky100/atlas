import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from './delta';
import { ATTRIBUTE_SCHEMA_BY_TYPE, attributeDefinitionToFieldSchema, defaultCreateAttributes, validateAttributeValue, validateCustomAttributeValue } from './attributeSchema';

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

  it('check C2: every `description` field is multiline; no other field is — a short field like Reference/Vendor/Email never gets the auto-growing textarea', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (field.key === 'description') expect(field.multiline).toBe(true);
        else expect(field.multiline).not.toBe(true);
      }
    }
  });

  it('ADR-020: only Capability.code ("Reference") hides when empty — every other field still shows a bare "—" per §4.3\'s default', () => {
    const capability = ATTRIBUTE_SCHEMA_BY_TYPE.capability;
    expect(capability.find((f) => f.key === 'code')).toMatchObject({ label: 'Reference', hideWhenEmpty: true });
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (!(type === 'capability' && field.key === 'code')) expect(field.hideWhenEmpty).not.toBe(true);
      }
    }
  });
});

describe('System/container version (S1 item 11)', () => {
  it('is a plain, optional text field on both system and container, not on capability/actor', () => {
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.system.find((f) => f.key === 'version')).toMatchObject({ label: 'Version', required: false, kind: 'text' });
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.container.find((f) => f.key === 'version')).toMatchObject({ label: 'Version', required: false, kind: 'text' });
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.capability.some((f) => f.key === 'version')).toBe(false);
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.actor.some((f) => f.key === 'version')).toBe(false);
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

describe('F1: validateCustomAttributeValue (number/date/link/enum kinds via an ad hoc field schema)', () => {
  it('validates a number field, accepting both a numeric and a numeric-string raw value and rejecting non-numeric text', () => {
    const field = { key: 'headcount', label: 'Headcount', required: false, kind: 'number' } as const;
    expect(validateCustomAttributeValue(field, 42)).toEqual({ ok: true, value: 42 });
    expect(validateCustomAttributeValue(field, '42')).toEqual({ ok: true, value: 42 });
    expect(validateCustomAttributeValue(field, 'not-a-number')).toMatchObject({ ok: false });
    expect(validateCustomAttributeValue(field, true)).toMatchObject({ ok: false });
  });

  it('rejects clearing a required number field, and normalises clearing an optional one to null', () => {
    const required = { key: 'headcount', label: 'Headcount', required: true, kind: 'number' } as const;
    const optional = { key: 'headcount', label: 'Headcount', required: false, kind: 'number' } as const;
    expect(validateCustomAttributeValue(required, '')).toEqual({ ok: false, error: 'Headcount is required' });
    expect(validateCustomAttributeValue(optional, undefined)).toEqual({ ok: true, value: null });
  });

  it('validates a link field, trimming and requiring a parseable absolute URL', () => {
    const field = { key: 'docsUrl', label: 'Docs URL', required: false, kind: 'link' } as const;
    expect(validateCustomAttributeValue(field, '  https://example.com/docs  ')).toEqual({ ok: true, value: 'https://example.com/docs' });
    expect(validateCustomAttributeValue(field, 'not a url')).toMatchObject({ ok: false });
    expect(validateCustomAttributeValue(field, '')).toEqual({ ok: true, value: null });
  });

  it('rejects clearing a required link field', () => {
    const field = { key: 'docsUrl', label: 'Docs URL', required: true, kind: 'link' } as const;
    expect(validateCustomAttributeValue(field, '')).toEqual({ ok: false, error: 'Docs URL is required' });
  });

  it('validates a select (enum) custom field against its own options, independent of any core schema', () => {
    const field = { key: 'region', label: 'Region', required: true, kind: 'enum', options: ['emea', 'amer', 'apac'] } as const;
    expect(validateCustomAttributeValue(field, 'emea')).toEqual({ ok: true, value: 'emea' });
    expect(validateCustomAttributeValue(field, 'mars')).toMatchObject({ ok: false });
  });
});

describe('F1: attributeDefinitionToFieldSchema', () => {
  it('maps a definition straight through for text/number/date/boolean/link kinds', () => {
    expect(attributeDefinitionToFieldSchema({ key: 'note', label: 'Note', kind: 'text', options: null, required: false })).toEqual({
      key: 'note',
      label: 'Note',
      kind: 'text',
      required: false,
    });
    expect(attributeDefinitionToFieldSchema({ key: 'count', label: 'Count', kind: 'number', options: null, required: true })).toEqual({
      key: 'count',
      label: 'Count',
      kind: 'number',
      required: true,
    });
  });

  it("maps F1's own 'select' kind to this file's 'enum' kind, carrying the options through", () => {
    expect(
      attributeDefinitionToFieldSchema({ key: 'region', label: 'Region', kind: 'select', options: ['emea', 'amer'], required: true }),
    ).toEqual({
      key: 'region',
      label: 'Region',
      kind: 'enum',
      required: true,
      options: ['emea', 'amer'],
    });
  });

  it('omits the options field entirely when the definition has none, rather than carrying a null through', () => {
    const schema = attributeDefinitionToFieldSchema({ key: 'note', label: 'Note', kind: 'text', options: null, required: false });
    expect('options' in schema).toBe(false);
  });

  it('the mapped schema validates through validateCustomAttributeValue exactly like a hand-built field schema', () => {
    const schema = attributeDefinitionToFieldSchema({ key: 'region', label: 'Region', kind: 'select', options: ['emea', 'amer'], required: true });
    expect(validateCustomAttributeValue(schema, 'emea')).toEqual({ ok: true, value: 'emea' });
    expect(validateCustomAttributeValue(schema, 'mars')).toMatchObject({ ok: false });
  });
});

describe('defaultCreateAttributes', () => {
  it('defaults every required boolean field to false and every other required enum to its schema-declared first option', () => {
    expect(defaultCreateAttributes('container')).toEqual({ isExternal: false });
    expect(defaultCreateAttributes('actor')).toEqual({ subtype: 'person', isExternal: false });
  });

  it('has no required fields to default for capability', () => {
    expect(defaultCreateAttributes('capability')).toEqual({});
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
