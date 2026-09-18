import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ImportFileParseError, parseImportFile } from './parseImportFile';

/** Builds a real `.xlsx` file (not a mock) from a plain array-of-arrays sheet — the same construction `elementExportXlsx.ts` uses for export, just wrapped in a `File` for this module's own `file.arrayBuffer()` entry point. */
function xlsxFile(rows: (string | null)[][], name = 'systems.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new File([buffer], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function csvFile(text: string, name = 'systems.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('parseImportFile', () => {
  it('parses a real .xlsx file into validated rows', async () => {
    const file = xlsxFile([
      ['name', 'description'],
      ['Northgate', "The borough's new revenues platform."],
      ['Council Tax System', null],
    ]);
    const result = await parseImportFile(file);
    expect(result.fileName).toBe('systems.xlsx');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rowNumber: 2, name: 'Northgate', attributes: { description: "The borough's new revenues platform." } });
    expect(result.rows[1]).toMatchObject({ rowNumber: 3, name: 'Council Tax System' });
  });

  it('parses a real .csv file the same way — no separate CSV code path', async () => {
    const file = csvFile('name,description\nNorthgate,"The borough\'s new revenues platform."\n');
    const result = await parseImportFile(file);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: 'Northgate' });
  });

  it('collects a per-row error without discarding the rows that did validate', async () => {
    const file = xlsxFile([
      ['name', 'lifecycle'],
      ['Northgate', 'active'],
      ['Bad Row', 'not-a-real-status'],
      ['Council Tax System', null],
    ]);
    const result = await parseImportFile(file);
    expect(result.rows.map((r) => r.name)).toEqual(['Northgate', 'Council Tax System']);
    expect(result.errors).toEqual([{ rowNumber: 3, error: '"lifecycle": Lifecycle must be one of: planned, active, retiring, retired' }]);
  });

  it('reports the file’s own detected columns and a preview of its first raw rows, for the dialog’s own preview', async () => {
    const file = xlsxFile([
      ['name', 'platform'],
      ['PM', 'SAP'],
      ['FI', 'SAP'],
    ]);
    const result = await parseImportFile(file);
    expect(result.detectedColumns).toEqual(['name', 'platform']);
    expect(result.previewRows).toEqual([{ name: 'PM', platform: 'SAP' }, { name: 'FI', platform: 'SAP' }]);
  });

  it('numbers rows starting at 2 (row 1 is the header), matching what a reader sees in Excel', async () => {
    const file = xlsxFile([
      ['name'],
      ['First'],
      ['Second'],
    ]);
    const result = await parseImportFile(file);
    expect(result.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it('throws a real error for a file with a header row but no data', async () => {
    const file = xlsxFile([['name']]);
    await expect(parseImportFile(file)).rejects.toThrow(ImportFileParseError);
  });

  it('throws a real error for a file that is not a spreadsheet at all', async () => {
    const file = new File(['not a spreadsheet, just plain garbage bytes \0\0\0'], 'garbage.xlsx');
    await expect(parseImportFile(file)).rejects.toThrow(ImportFileParseError);
  });
});
