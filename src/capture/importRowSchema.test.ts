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

  it('carries the capability/business_owner/technical_owner columns through unresolved, for matchImportRows to resolve', () => {
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
});
