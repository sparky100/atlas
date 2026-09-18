import { describe, expect, it } from 'vitest';
import { validateImportRelationshipRow } from './importRelationshipRow';

describe('validateImportRelationshipRow', () => {
  it('accepts a minimal uses row', () => {
    const result = validateImportRelationshipRow({ from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads accounts from' }, 2);
    expect(result).toEqual({ ok: true, row: { rowNumber: 2, from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads accounts from', via: null, dataClassification: null } });
  });

  it('requires from', () => {
    const result = validateImportRelationshipRow({ type: 'uses', to: 'Southgate', description: 'reads from' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"from" is required' });
  });

  it('requires to', () => {
    const result = validateImportRelationshipRow({ from: 'Northgate', type: 'uses', description: 'reads from' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"to" is required' });
  });

  it('rejects a type outside uses/flows_to', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'supports', to: 'B', description: 'x' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"type" must be "uses" or "flows_to"' });
  });

  it('requires description (the verb phrase) for uses', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'uses', to: 'B' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"description": Verb phrase is required' });
  });

  it('requires description for flows_to too', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'flows_to', to: 'B' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"description": Verb phrase is required' });
  });

  it('accepts data_classification on a flows_to row', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'flows_to', to: 'B', description: 'sends to', data_classification: 'official' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.dataClassification).toBe('official');
  });

  it('rejects data_classification on a uses row — uses has no such attribute', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'uses', to: 'B', description: 'reads from', data_classification: 'official' }, 2);
    expect(result).toEqual({ ok: false, rowNumber: 2, error: '"data_classification": uses has no attribute "dataClassification"' });
  });

  it('rejects an invalid data_classification value', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'flows_to', to: 'B', description: 'sends to', data_classification: 'top_secret' }, 2);
    expect(result.ok).toBe(false);
  });

  it('captures via as raw text, unresolved', () => {
    const result = validateImportRelationshipRow({ from: 'A', type: 'flows_to', to: 'B', description: 'sends to', via: 'ESB' }, 2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.via).toBe('ESB');
  });
});
