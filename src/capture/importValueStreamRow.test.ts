import { describe, expect, it } from 'vitest';
import { validateImportValueStreamRow } from './importValueStreamRow';

describe('validateImportValueStreamRow', () => {
  it('parses a stream with stages and enables', () => {
    const result = validateImportValueStreamRow({ name: 'Getting Connected', stages: [{ name: 'Apply & Quote', enables: ['Connection Quotations'] }] }, 1);
    expect(result).toEqual({ ok: true, row: { rowNumber: 1, name: 'Getting Connected', stages: [{ name: 'Apply & Quote', enables: ['Connection Quotations'] }] } });
  });

  it('requires a name', () => {
    expect(validateImportValueStreamRow({ stages: [{ name: 'x', enables: [] }] }, 1)).toEqual({ ok: false, rowNumber: 1, error: '"name" is required' });
  });

  it('requires a non-empty stages array', () => {
    expect(validateImportValueStreamRow({ name: 'X', stages: [] }, 1)).toEqual({ ok: false, rowNumber: 1, error: '"stages" must be a non-empty array' });
    expect(validateImportValueStreamRow({ name: 'X' }, 1)).toEqual({ ok: false, rowNumber: 1, error: '"stages" must be a non-empty array' });
  });

  it('requires each stage to have a name', () => {
    expect(validateImportValueStreamRow({ name: 'X', stages: [{ enables: [] }] }, 1)).toEqual({ ok: false, rowNumber: 1, error: '"stages"[0].name is required' });
  });

  it('allows an empty enables array but rejects a non-string entry', () => {
    expect(validateImportValueStreamRow({ name: 'X', stages: [{ name: 'S', enables: [] }] }, 1)).toMatchObject({ ok: true });
    expect(validateImportValueStreamRow({ name: 'X', stages: [{ name: 'S', enables: [null] }] }, 1)).toEqual({ ok: false, rowNumber: 1, error: '"stages"[0].enables entries must be non-empty strings' });
  });
});
