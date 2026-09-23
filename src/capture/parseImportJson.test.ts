import { describe, expect, it } from 'vitest';
import { ImportFileParseError } from './parseImportFile';
import { parseImportJson, parseImportJsonText } from './parseImportJson';

function jsonFile(body: unknown, name = 'import.json'): File {
  return new File([JSON.stringify(body)], name, { type: 'application/json' });
}

describe('parseImportJsonText (Sprint F2b) — the pure half runCapture.ts calls directly', () => {
  it('parses text with no File/browser API involved, same shape as parseImportJson', () => {
    const result = parseImportJsonText(JSON.stringify({ systems: [{ name: 'CRM' }] }), 'import.json');
    expect(result.fileName).toBe('import.json');
    expect(result.rows).toEqual([expect.objectContaining({ name: 'CRM' })]);
  });

  it('throws ImportFileParseError on malformed JSON, naming the file', () => {
    expect(() => parseImportJsonText('not json', 'bad.json')).toThrow(ImportFileParseError);
    expect(() => parseImportJsonText('not json', 'bad.json')).toThrow(/bad\.json/);
  });
});

describe('parseImportJson', () => {
  it('parses a systems-only file the same way parseImportFile would', async () => {
    const file = jsonFile({ systems: [{ name: 'Northgate', description: "The borough's new revenues platform." }, { name: 'Council Tax System' }] });
    const result = await parseImportJson(file);
    expect(result.fileName).toBe('import.json');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rowNumber: 1, name: 'Northgate', attributes: { description: "The borough's new revenues platform." } });
    expect(result.relationshipRows).toEqual([]);
    expect(result.changeRows).toEqual([]);
  });

  it('parses relationships and changes sections alongside systems', async () => {
    const file = jsonFile({
      systems: [{ name: 'Northgate' }, { name: 'Southgate' }],
      relationships: [{ from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads accounts from' }],
      changes: [{ name: 'Legacy CRM', action: 'retire', reason: 'Decommissioned' }],
    });
    const result = await parseImportJson(file);
    expect(result.errors).toEqual([]);
    expect(result.relationshipErrors).toEqual([]);
    expect(result.relationshipRows).toEqual([{ rowNumber: 1, from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads accounts from', via: null, dataClassification: null }]);
    expect(result.changeErrors).toEqual([]);
    expect(result.changeRows).toEqual([{ rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: 'Decommissioned', replacedBy: null, quote: undefined, confidence: undefined }]);
  });

  it('collects a per-entry error in each section without discarding the entries that did validate', async () => {
    const file = jsonFile({
      systems: [{ name: 'Northgate' }, { lifecycle: 'active' }],
      relationships: [{ from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads from' }, { from: 'A', type: 'nope', to: 'B', description: 'x' }],
      changes: [{ name: 'Legacy CRM', action: 'retire' }, { name: 'Bad', action: 'delete' }],
    });
    const result = await parseImportJson(file);
    expect(result.rows.map((r) => r.name)).toEqual(['Northgate']);
    expect(result.errors).toEqual([{ rowNumber: 2, error: '"name" is required' }]);
    expect(result.relationshipRows).toHaveLength(1);
    expect(result.relationshipErrors).toEqual([{ rowNumber: 2, error: '"type" must be "uses" or "flows_to"' }]);
    expect(result.changeRows).toHaveLength(1);
    expect(result.changeErrors).toEqual([{ rowNumber: 2, error: '"action" must be "retire" or "restore"' }]);
  });

  it('reports the top-level section names as detected columns, and a preview of the first systems entries', async () => {
    const file = jsonFile({ systems: [{ name: 'PM' }, { name: 'FI' }], relationships: [] });
    const result = await parseImportJson(file);
    expect(result.detectedColumns).toEqual(['systems', 'relationships']);
    expect(result.previewRows).toEqual([{ name: 'PM' }, { name: 'FI' }]);
  });

  it('throws a real error for invalid JSON', async () => {
    const file = new File(['not json at all {{{'], 'garbage.json');
    await expect(parseImportJson(file)).rejects.toThrow(ImportFileParseError);
  });

  it('throws a real error for a JSON value that is not an object', async () => {
    const file = jsonFile([1, 2, 3]);
    await expect(parseImportJson(file)).rejects.toThrow(ImportFileParseError);
  });

  it('throws a real error when systems is missing or empty', async () => {
    await expect(parseImportJson(jsonFile({}))).rejects.toThrow(ImportFileParseError);
    await expect(parseImportJson(jsonFile({ systems: [] }))).rejects.toThrow(ImportFileParseError);
  });

  it('parses replaced_by, quote, and confidence on a changes entry', async () => {
    const file = jsonFile({
      systems: [{ name: 'Legacy CRM' }, { name: 'Electron' }],
      changes: [{ name: 'Legacy CRM', action: 'retire', replaced_by: 'Electron', quote: 'CRM was decommissioned in March', confidence: 0.9 }],
    });
    const result = await parseImportJson(file);
    expect(result.changeErrors).toEqual([]);
    expect(result.changeRows).toEqual([{ rowNumber: 1, name: 'Legacy CRM', action: 'retire', reason: null, replacedBy: 'Electron', quote: 'CRM was decommissioned in March', confidence: 0.9 }]);
  });

  it('parses quote and confidence on systems and relationships entries', async () => {
    const file = jsonFile({
      systems: [{ name: 'Northgate', quote: 'Northgate handles billing', confidence: 0.8 }],
      relationships: [{ from: 'Northgate', type: 'uses', to: 'Southgate', description: 'reads from', quote: 'Northgate reads from Southgate', confidence: 0.65 }],
    });
    const result = await parseImportJson(file);
    expect(result.rows[0]).toMatchObject({ quote: 'Northgate handles billing', confidence: 0.8 });
    expect(result.relationshipRows[0]).toMatchObject({ quote: 'Northgate reads from Southgate', confidence: 0.65 });
  });

  it('parses a value_streams section alongside systems, and reports it as a detected column', async () => {
    const file = jsonFile({
      systems: [{ name: 'Northgate' }],
      value_streams: [{ name: 'Getting Connected', stages: [{ name: 'Apply & Quote', enables: ['Connection Quotations'] }] }],
    });
    const result = await parseImportJson(file);
    expect(result.valueStreamErrors).toEqual([]);
    expect(result.valueStreamRows).toEqual([{ rowNumber: 1, name: 'Getting Connected', stages: [{ name: 'Apply & Quote', enables: ['Connection Quotations'] }] }]);
    expect(result.detectedColumns).toEqual(['systems', 'value_streams']);
  });

  it('collects a per-entry error in value_streams without discarding the entries that did validate', async () => {
    const file = jsonFile({
      systems: [{ name: 'Northgate' }],
      value_streams: [{ name: 'Getting Connected', stages: [{ name: 'Apply', enables: [] }] }, { stages: [] }],
    });
    const result = await parseImportJson(file);
    expect(result.valueStreamRows).toHaveLength(1);
    expect(result.valueStreamErrors).toEqual([{ rowNumber: 2, error: '"name" is required' }]);
  });
});
