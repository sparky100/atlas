import { describe, expect, it } from 'vitest';
import { validateImportRow } from './importRowSchema';

describe('validateImportRow', () => {
  it('accepts a minimal row with only a name', () => {
    const result = validateImportRow({ name: 'Northgate' }, 2);
    expect(result).toEqual({ ok: true, row: { rowNumber: 2, name: 'Northgate', elementType: 'system', attributes: {}, isExternal: undefined, platformName: null, capabilityNames: [], businessOwner: null, technicalOwner: null } });
  });

  it('requires name', () => {
    const result = validateImportRow({ description: 'no name here' }, 3);
    expect(result).toEqual({ ok: false, rowNumber: 3, error: '"name" is required' });
  });

  it('trims a name and every optional text field', () => {
    const result = validateImportRow({ name: '  Northgate  ', description: '  A system  ' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.name).toBe('Northgate');
      expect(result.row.attributes.description).toBe('A system');
    }
  });

  it('a blank platform column makes the row a top-level system', () => {
    const result = validateImportRow({ name: 'Northgate' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.elementType).toBe('system');
  });

  it('a filled platform column makes the row a module, carrying the platform name unresolved', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.elementType).toBe('container');
      expect(result.row.platformName).toBe('SAP');
    }
  });

  it('accepts a valid lifecycle enum value, stored under the lifecycleStatus attribute key', () => {
    const result = validateImportRow({ name: 'Northgate', lifecycle: 'retiring' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes.lifecycleStatus).toBe('retiring');
  });

  it('rejects an invalid lifecycle enum value, naming the real options', () => {
    const result = validateImportRow({ name: 'Northgate', lifecycle: 'deprecated' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"lifecycle": Lifecycle must be one of: planned, active, retiring, retired' });
  });

  it('rejects an invalid criticality enum value', () => {
    const result = validateImportRow({ name: 'Northgate', criticality: 'urgent' }, 2);
    expect(result.ok).toBe(false);
  });

  it('accepts kind and vendor on a top-level system row', () => {
    const result = validateImportRow({ name: 'Northgate', kind: 'platform', vendor: 'Acme' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.attributes.kind).toBe('platform');
      expect(result.row.attributes.vendor).toBe('Acme');
    }
  });

  it('rejects kind on a module row — a module has no kind of its own', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP', kind: 'application' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"kind": container has no attribute "kind"' });
  });

  it('rejects vendor on a module row — a module never overrides its platform’s vendor', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP', vendor: 'Acme' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"vendor": container has no attribute "vendor"' });
  });

  it('accepts a module override of lifecycle/criticality/domain/hosting_model', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP', lifecycle: 'active', criticality: 'high', domain: 'ot', hosting_model: 'on_premises' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.attributes.lifecycleStatus).toBe('active');
      expect(result.row.attributes.criticality).toBe('high');
      expect(result.row.attributes.domain).toBe('ot');
      expect(result.row.attributes.hostingModel).toBe('on_premises');
    }
  });

  it('carries the capability/business_owner/technical_owner columns through unresolved, for runCapture to resolve', () => {
    const result = validateImportRow({ name: 'Northgate', capability: 'Billing', business_owner: 'Jane Doe', technical_owner: 'John Smith' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.capabilityNames).toEqual(['Billing']);
      expect(result.row.businessOwner).toEqual({ name: 'Jane Doe', externalOrganisation: null });
      expect(result.row.technicalOwner).toEqual({ name: 'John Smith', externalOrganisation: null });
    }
  });

  it('splits a "|"-delimited capability list, trimming each name', () => {
    const result = validateImportRow({ name: 'Northgate', capability: ' Billing | Customer Accounts |' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.capabilityNames).toEqual(['Billing', 'Customer Accounts']);
  });

  it('deduplicates a repeated capability name in the same cell, case-insensitively, keeping the first casing seen — a copy-paste typo like "Billing | Billing" must never produce two supports creates for the same pair (V6)', () => {
    const result = validateImportRow({ name: 'Northgate', capability: 'Billing | billing | Customer Accounts' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.capabilityNames).toEqual(['Billing', 'Customer Accounts']);
  });

  it('parses "Name (External: Org)" into an owner reference with externalOrganisation set', () => {
    const result = validateImportRow({ name: 'Northgate', business_owner: 'Ofgem (External: Energy regulator)' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.businessOwner).toEqual({ name: 'Ofgem', externalOrganisation: 'Energy regulator' });
  });

  it('accepts is_external as true/false (or yes/no)', () => {
    const result = validateImportRow({ name: 'Northgate', is_external: 'yes' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.isExternal).toBe(true);
  });

  it('rejects an unrecognised is_external value', () => {
    const result = validateImportRow({ name: 'Northgate', is_external: 'maybe' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"is_external" must be true/false (or yes/no), got "maybe"' });
  });

  it('accepts external_organisation on a top-level system row', () => {
    const result = validateImportRow({ name: 'Ofgem', is_external: 'true', external_organisation: 'Energy regulator' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes.externalOrganisation).toBe('Energy regulator');
  });

  it('rejects external_organisation on a module row — a module has none of its own', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP', external_organisation: 'Acme' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"external_organisation": container has no attribute "externalOrganisation"' });
  });

  it('treats a blank optional cell the same as an absent one', () => {
    const result = validateImportRow({ name: 'Northgate', description: '', vendor: null }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes).toEqual({});
  });

  it('ignores columns outside the fixed format', () => {
    const result = validateImportRow({ name: 'Northgate', someRandomColumn: 'whatever' }, 2);
    expect(result.ok).toBe(true);
  });

  it('accepts an optional quote and confidence, carried through unresolved', () => {
    const result = validateImportRow({ name: 'Northgate', quote: 'Northgate handles all revenue billing', confidence: 0.8 }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.quote).toBe('Northgate handles all revenue billing');
      expect(result.row.confidence).toBe(0.8);
    }
  });

  it('rejects a confidence outside [0,1]', () => {
    const result = validateImportRow({ name: 'Northgate', confidence: -0.1 }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"confidence": must be a number between 0 and 1' });
  });

  describe('a module row’s own name redundantly pre-qualified as "Platform · Module"', () => {
    it('strips the prefix when it matches this row’s own platform', () => {
      const result = validateImportRow({ name: 'SAP · PM', platform: 'SAP' }, 2);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.row.name).toBe('PM');
    });

    it('is case- and whitespace-insensitive about the platform half', () => {
      const result = validateImportRow({ name: '  sap  ·  PM  ', platform: 'SAP' }, 2);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.row.name).toBe('PM');
    });

    it('leaves the name alone when the prefix names a different platform', () => {
      const result = validateImportRow({ name: 'Salesforce · CRM', platform: 'SAP' }, 2);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.row.name).toBe('Salesforce · CRM');
    });

    it('leaves a top-level system’s own name alone, even if it happens to contain "·"', () => {
      const result = validateImportRow({ name: 'SAP · PM' }, 2);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.row.name).toBe('SAP · PM');
    });
  });

  it('accepts the roadmap date columns as ISO dates', () => {
    const result = validateImportRow({ name: 'SAP', introduced: '2014-04-01', planned_end: '2028-03-31', support_ends_at: '2027-12-31' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes).toMatchObject({ introduced: '2014-04-01', plannedEnd: '2028-03-31', supportEndsAt: '2027-12-31' });
  });

  it('rejects a date that is not a real ISO calendar date', () => {
    const result = validateImportRow({ name: 'SAP', planned_end: '2028-02-30' }, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"planned_end"');
  });

  it('rejects support_ends_at on a module row', () => {
    const result = validateImportRow({ name: 'PM', platform: 'SAP', support_ends_at: '2027-12-31' }, 2);
    expect(result.ok).toBe(false);
  });

  it('accepts the two AI columns (owner-approved importer exception) and rejects values outside their choices', () => {
    const ok = validateImportRow({ name: 'Fault Triage Assistant', ai_autonomy: 'suggests', ai_use: 'external_service' }, 2);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.attributes).toMatchObject({ aiAutonomy: 'suggests', aiUse: 'external_service' });
    const bad = validateImportRow({ name: 'X', ai_autonomy: 'sometimes' }, 3);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('"ai_autonomy"');
    const badUse = validateImportRow({ name: 'X', ai_use: 'maybe' }, 4);
    expect(badUse.ok).toBe(false);
  });

  it('leaves the AI attributes untouched when the columns are blank', () => {
    const result = validateImportRow({ name: 'SAP', ai_autonomy: '', ai_use: null }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes).toEqual({});
  });
});
