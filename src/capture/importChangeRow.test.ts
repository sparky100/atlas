import { describe, expect, it } from 'vitest';
import { validateImportChangeRow } from './importChangeRow';

describe('validateImportChangeRow', () => {
  it('accepts a minimal retire row', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire' }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null, replacedBy: null, quote: undefined, confidence: undefined } });
  });

  it('accepts a restore row with a reason', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'restore', reason: 'Decommission was reversed' }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Legacy CRM', action: 'restore', reason: 'Decommission was reversed', replacedBy: null, quote: undefined, confidence: undefined } });
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

  it('accepts replaced_by on a retire row', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire', replaced_by: 'Electron' }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null, replacedBy: 'Electron', quote: undefined, confidence: undefined } });
  });

  it('rejects replaced_by on a restore row', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'restore', replaced_by: 'Electron' }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"replaced_by" is only valid with action "retire"' });
  });

  it('accepts quote and confidence', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire', quote: 'CRM was decommissioned in March', confidence: 0.8 }, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.quote).toBe('CRM was decommissioned in March');
      expect(result.row.confidence).toBe(0.8);
    }
  });

  it('rejects a confidence outside [0,1]', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire', confidence: 1.5 }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"confidence": must be a number between 0 and 1' });
  });

  it('rejects an unparseable confidence', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire', confidence: 'very sure' }, 1);
    expect(result).toEqual({ ok: false, rowNumber: 1, error: '"confidence": must be a number between 0 and 1' });
  });

  it('treats a blank confidence cell as omitted, not an error', () => {
    const result = validateImportChangeRow({ name: 'Legacy CRM', action: 'retire', confidence: '' }, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.confidence).toBeUndefined();
  });
});
