import { describe, expect, it } from 'vitest';
import { validateImportRow } from './importRowSchema';

describe('validateImportRow', () => {
  it('accepts a minimal row with only a name', () => {
    const result = validateImportRow({ name: 'Northgate' }, 2);
    expect(result).toEqual({ ok: true, row: { rowNumber: 2, id: null, name: 'Northgate', attributes: {}, supportsCapabilityName: null } });
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

  it('accepts a valid id column', () => {
    const result = validateImportRow({ name: 'Northgate', id: '11111111-1111-1111-1111-111111111111' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('rejects an id that is not a valid uuid', () => {
    const result = validateImportRow({ name: 'Northgate', id: 'not-a-uuid' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"id" must be a valid element id (uuid) or left blank, got "not-a-uuid"' });
  });

  it('accepts a valid lifecycleStatus enum value', () => {
    const result = validateImportRow({ name: 'Northgate', lifecycleStatus: 'retiring' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes.lifecycleStatus).toBe('retiring');
  });

  it('rejects an invalid lifecycleStatus enum value, naming the real options', () => {
    const result = validateImportRow({ name: 'Northgate', lifecycleStatus: 'deprecated' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: 'Lifecycle must be one of: planned, active, retiring, retired' });
  });

  it('rejects an invalid criticality enum value', () => {
    const result = validateImportRow({ name: 'Northgate', criticality: 'urgent' }, 2);
    expect(result.ok).toBe(false);
  });

  it('carries the supports column through unresolved, for matchImportRows to resolve', () => {
    const result = validateImportRow({ name: 'Northgate', supports: 'Billing' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.supportsCapabilityName).toBe('Billing');
  });

  it('treats a blank optional cell the same as an absent one', () => {
    const result = validateImportRow({ name: 'Northgate', description: '', vendor: null }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.attributes).toEqual({});
  });

  it('ignores columns outside the fixed v1 format', () => {
    const result = validateImportRow({ name: 'Northgate', someRandomColumn: 'whatever' }, 2);
    expect(result.ok).toBe(true);
  });
});
