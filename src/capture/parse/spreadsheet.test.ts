import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseXlsxWorkbook } from './spreadsheet';

function buildWorkbookBuffer(sheets: Record<string, string[][]>, merges?: Record<string, XLSX.Range[]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    if (merges?.[name]) sheet['!merges'] = merges[name];
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  const buffer: ArrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return buffer;
}

describe('parseXlsxWorkbook', () => {
  it('reads every sheet, detecting its header row and columns', () => {
    const buffer = buildWorkbookBuffer({
      Applications: [
        ['Application', 'Supplier', 'Status'],
        ['CRM', 'Acme', 'Active'],
        ['ERP', 'Beta', 'Retired'],
      ],
    });
    const sheets = parseXlsxWorkbook(buffer);
    expect(sheets).toHaveLength(1);
    const sheet = sheets[0];
    expect(sheet?.sheetName).toBe('Applications');
    expect(sheet?.headerRowIndex).toBe(0);
    expect(sheet?.headers).toEqual(['Application', 'Supplier', 'Status']);
    expect(sheet?.headerColumnRefs).toEqual(['A', 'B', 'C']);
    expect(sheet?.rawSheet?.grid[1]).toEqual(['CRM', 'Acme', 'Active']);
  });

  it('skips a title row and a "Generated on…" banner above the real header', () => {
    const buffer = buildWorkbookBuffer({
      Sheet1: [['Application Register 2026'], ['Generated 03/04/2026'], [], ['Application', 'Supplier', 'Status'], ['CRM', 'Acme', 'Active']],
    });
    const sheet = parseXlsxWorkbook(buffer)[0];
    expect(sheet?.headerRowIndex).toBe(3);
    expect(sheet?.headers).toEqual(['Application', 'Supplier', 'Status']);
  });

  it('reads multiple sheets in workbook order', () => {
    const buffer = buildWorkbookBuffer({
      Systems: [
        ['Application', 'Status'],
        ['CRM', 'Active'],
      ],
      Modules: [
        ['Module', 'Parent system'],
        ['Billing', 'CRM'],
      ],
    });
    const sheets = parseXlsxWorkbook(buffer);
    expect(sheets.map((s) => s.sheetName)).toEqual(['Systems', 'Modules']);
  });

  it('marks a merged range in cellMeta', () => {
    const buffer = buildWorkbookBuffer(
      {
        Sheet1: [
          ['Application', 'Vendor', 'Status'],
          ['CRM', 'Acme', 'Active'],
        ],
      },
      { Sheet1: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }] },
    );
    const sheet = parseXlsxWorkbook(buffer)[0];
    expect(sheet?.rawSheet?.cellMeta.get('0,0')).toEqual({ merged: true });
    expect(sheet?.rawSheet?.cellMeta.get('0,1')).toEqual({ merged: true });
    expect(sheet?.rawSheet?.cellMeta.get('0,2')).toBeUndefined();
  });

  it('marks a formula-error cell in cellMeta and reads it as an empty string', () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Application', 'Vendor', 'Status'],
      ['CRM', 'Acme', 'Active'],
    ]);
    sheet.D2 = { t: 'e', v: '#REF!' };
    sheet['!ref'] = 'A1:D2';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
    const buffer: ArrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    const parsed = parseXlsxWorkbook(buffer)[0];
    expect(parsed?.rawSheet?.cellMeta.get('1,3')).toEqual({ formulaError: true });
    expect(parsed?.rawSheet?.grid[1]?.[3]).toBe('');
  });

  it('returns headerRowIndex: null for a sheet with no usable header', () => {
    const buffer = buildWorkbookBuffer({ Sheet1: [[''], [''], ['']] });
    const sheet = parseXlsxWorkbook(buffer)[0];
    expect(sheet?.headerRowIndex).toBeNull();
  });
});
