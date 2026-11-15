import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { importTemplateXlsxBlob } from './downloadImportTemplate';

describe('importTemplateXlsxBlob', () => {
  it('writes a workbook with the three sheets', async () => {
    const wb = XLSX.read(await importTemplateXlsxBlob().arrayBuffer(), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Read me first', 'Systems', 'Relationships']);
    const sheet = wb.Sheets.Systems;
    expect(sheet).toBeDefined();
    const systems = XLSX.utils.sheet_to_json<string[]>(sheet ?? {}, { header: 1 });
    expect(systems[0]?.[0]).toBe('Name');
  });
});
