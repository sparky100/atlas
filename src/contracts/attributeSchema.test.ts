import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES } from './delta';
import {
  ANNUAL_RUN_COST_BANDS,
  ANNUAL_RUN_COST_HELP,
  ANNUAL_RUN_COST_LABELS,
  ANNUAL_RUN_COST_OPTIONS,
  ATTRIBUTE_SCHEMA_BY_TYPE,
  attributeDefinitionToFieldSchema,
  defaultCreateAttributes,
  isCoreAttributeKey,
  validateAttributeValue,
  validateCustomAttributeValue,
} from './attributeSchema';

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

  it('Sprint U4-1 D2: only Capability.templateRef (and F3a Actor.memberId, handled by its own picker) are hidden from the read-only attributes list — every other field, including its own not-editable sibling `order`, still shows', () => {
    const capability = ATTRIBUTE_SCHEMA_BY_TYPE.capability;
    expect(capability.find((f) => f.key === 'templateRef')?.hidden).toBe(true);
    expect(capability.find((f) => f.key === 'order')?.hidden).not.toBe(true);
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (field.key !== 'templateRef' && field.key !== 'memberId') expect(field.hidden).not.toBe(true);
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

  it('a field declaring optionLabels labels every one of its own options — a stored value can never render as an unlabelled key on a labelled enum', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (!field.optionLabels) continue;
        expect(field.options, `${type}.${field.key} has options`).toBeDefined();
        for (const option of field.options ?? []) expect(field.optionLabels[option], `${type}.${field.key} option ${option}`).toBeTruthy();
      }
    }
  });

  it('only annualRunCost declares an emptyLabel or help text — the two mechanisms are for Run cost alone, every other field keeps §4.3\'s bare "—" and a silent row', () => {
    for (const type of ELEMENT_TYPES) {
      for (const field of ATTRIBUTE_SCHEMA_BY_TYPE[type]) {
        if (field.key !== 'annualRunCost') {
          expect(field.emptyLabel, `${type}.${field.key}`).toBeUndefined();
          expect(field.help, `${type}.${field.key}`).toBeUndefined();
        }
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

describe('Run cost (annualRunCost)', () => {
  const EXPECTED_BANDS = [
    { key: 'none_included', label: 'None / included' },
    { key: 'under_50k', label: 'Under £50k' },
    { key: '50k_250k', label: '£50k–£250k' },
    { key: '250k_1m', label: '£250k–£1m' },
    { key: '1m_5m', label: '£1m–£5m' },
    { key: 'over_5m', label: 'Over £5m' },
  ];

  it('declares its six bands in cost order, keys stored and labels in code', () => {
    expect(ANNUAL_RUN_COST_BANDS).toEqual(EXPECTED_BANDS);
    expect(ANNUAL_RUN_COST_OPTIONS).toEqual(EXPECTED_BANDS.map((b) => b.key));
    expect(ANNUAL_RUN_COST_LABELS['50k_250k']).toBe('£50k–£250k');
  });

  it('is an optional enum on system and container only — capability, actor and value_stream never carry it', () => {
    for (const type of ['system', 'container'] as const) {
      expect(ATTRIBUTE_SCHEMA_BY_TYPE[type].find((f) => f.key === 'annualRunCost')).toMatchObject({
        label: 'Run cost',
        required: false,
        kind: 'enum',
        options: ANNUAL_RUN_COST_OPTIONS,
        help: ANNUAL_RUN_COST_HELP,
        emptyLabel: 'Not entered',
      });
    }
    for (const type of ['capability', 'actor', 'value_stream'] as const) {
      expect(ATTRIBUTE_SCHEMA_BY_TYPE[type].some((f) => f.key === 'annualRunCost')).toBe(false);
    }
  });

  it('sits directly after criticality in both display orders', () => {
    const systemKeys = ATTRIBUTE_SCHEMA_BY_TYPE.system.map((f) => f.key);
    const containerKeys = ATTRIBUTE_SCHEMA_BY_TYPE.container.map((f) => f.key);
    expect(systemKeys[systemKeys.indexOf('annualRunCost') - 1]).toBe('criticality');
    expect(containerKeys[containerKeys.indexOf('annualRunCost') - 1]).toBe('criticality');
  });

  it('validateAttributeValue accepts every declared band on system and container', () => {
    for (const type of ['system', 'container'] as const) {
      for (const band of ANNUAL_RUN_COST_OPTIONS) {
        expect(validateAttributeValue(type, 'annualRunCost', band)).toEqual({ ok: true, value: band });
      }
    }
  });

  it('rejects a key that is not one of the six bands', () => {
    expect(validateAttributeValue('system', 'annualRunCost', '10m_50m')).toMatchObject({ ok: false });
    expect(validateAttributeValue('container', 'annualRunCost', 'None / included')).toMatchObject({ ok: false });
    expect(validateAttributeValue('system', 'annualRunCost', '')).toEqual({ ok: true, value: null });
  });

  it('rejects annualRunCost on ineligible element types — the attribute simply does not exist there', () => {
    for (const type of ['capability', 'actor', 'value_stream'] as const) {
      expect(validateAttributeValue(type, 'annualRunCost', 'under_50k')).toEqual({ ok: false, error: `${type} has no attribute "annualRunCost"` });
    }
  });

  it('never treats unset as a band: clearing normalises to null, and "Not entered" is visibly distinct from the recorded "None / included"', () => {
    const systemField = ATTRIBUTE_SCHEMA_BY_TYPE.system.find((f) => f.key === 'annualRunCost');
    expect(validateAttributeValue('system', 'annualRunCost', '')).toEqual({ ok: true, value: null });
    expect(systemField?.emptyLabel).toBe('Not entered');
    expect(systemField?.emptyLabel).not.toBe(systemField?.optionLabels?.none_included);
    expect(systemField?.optionLabels?.none_included).toBe('None / included');
  });
});

describe('isCoreAttributeKey', () => {
  it('claims a core key from any element type', () => {
    expect(isCoreAttributeKey('annualRunCost')).toBe(true);
    expect(isCoreAttributeKey('criticality')).toBe(true);
    expect(isCoreAttributeKey('description')).toBe(true);
    expect(isCoreAttributeKey('templateRef')).toBe(true);
  });

  it('refuses a key that belongs to no core schema', () => {
    expect(isCoreAttributeKey('annualRunCostTypo')).toBe(false);
    expect(isCoreAttributeKey('region')).toBe(false);
    expect(isCoreAttributeKey('')).toBe(false);
  });
});

describe('Actor description', () => {
  it('is an optional, multiline text field, same as every other element type\'s own description', () => {
    expect(ATTRIBUTE_SCHEMA_BY_TYPE.actor.find((f) => f.key === 'description')).toMatchObject({ label: 'Description', required: false, kind: 'text', multiline: true });
  });

  it('is never defaulted at create — only a required boolean/enum field gets a default', () => {
    expect(defaultCreateAttributes('actor')).not.toHaveProperty('description');
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
