import { describe, expect, it } from 'vitest';
import { isImportChange } from './importChange';

describe('isImportChange', () => {
  it('is true for the importer’s auto-created change', () => {
    expect(isImportChange({ title: 'Import: systems.xlsx', name: 'import-systems' })).toBe(true);
  });
  it('falls back to the name when there is no title', () => {
    expect(isImportChange({ title: null, name: 'Import: systems.xlsx' })).toBe(true);
  });
  it('is false for any other change', () => {
    expect(isImportChange({ title: 'Replace CRM', name: 'replace-crm' })).toBe(false);
  });
});
