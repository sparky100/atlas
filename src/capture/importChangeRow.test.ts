import { describe, expect, it } from 'vitest';
import { validateImportChangeRow } from './importChangeRow';

describe('validateImportChangeRow', () => {
  it('accepts a minimal retire row', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire' }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null } });
  });

  it('accepts a restore row with a reason', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'restore', reason: 'Decommission was reversed' }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Legacy CRM', action: 'restore', reason: 'Decommission was reversed' } });
  });

  it('requires name', () => {
    const result = validateImportChangeRow({ action: 'retire' }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"name" is required' });
  });

  it('requires action to be retire or restore', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'delete' }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"action" must be "retire" or "restore"' });
  });

  it('requires action at all', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM' }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"action" must be "retire" or "restore"' });
  });
});
