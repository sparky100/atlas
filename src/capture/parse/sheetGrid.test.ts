import { describe, expect, it } from 'vitest';
import { detectHeaderRow, extractDataRows, type RawSheet } from './sheetGrid';

describe('detectHeaderRow', () => {
  it('finds a header row immediately at the top', () => {
    const grid = [
      ['Application', 'Supplier', 'Status'],
      ['CRM', 'Acme', 'Active'],
      ['ERP', 'Beta', 'Active'],
    ];
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it('skips title rows and "Generated on…" banners above the real header', () => {
    const grid = [
      ['Application Register 2026'],
      ['Generated 03/04/2026'],
      [''],
      ['Application', 'Supplier', 'Status'],
      ['CRM', 'Acme', 'Active'],
    ];
    expect(detectHeaderRow(grid)).toBe(3);
  });

  it('rejects a row as a header when more than a third of its cells look like dates/numbers', () => {
    const grid = [
      ['1', '2026-01-01', 'x'],
      ['CRM', 'Acme', 'Active'],
    ];
    expect(detectHeaderRow(grid)).toBeNull();
  });

  it('rejects a candidate row not followed by a row with ≥ 2 non-empty cells', () => {
    const grid = [
      ['Application', 'Supplier', 'Status'],
      ['only one'],
    ];
    expect(detectHeaderRow(grid)).toBeNull();
  });

  it('requires at least 3 non-empty cells', () => {
    const grid = [
      ['Application', 'Supplier'],
      ['CRM', 'Acme'],
    ];
    expect(detectHeaderRow(grid)).toBeNull();
  });

  it('returns null when nothing in the top 15 rows qualifies', () => {
    const grid = Array.from({ length: 20 }, () => ['', '', '']);
    expect(detectHeaderRow(grid)).toBeNull();
  });
});

function makeSheet(grid: string[][]): RawSheet {
  return { sheetName: 'Sheet1', grid, cellMeta: new Map() };
}

describe('extractDataRows', () => {
  it('returns every data row after the header, with 1-based row numbers', () => {
    const sheet = makeSheet([
      ['Application', 'Status'],
      ['CRM', 'Active'],
      ['ERP', 'Retired'],
    ]);
    const rows = extractDataRows(sheet, 0, 0);
    expect(rows).toEqual([
      { rowNumber: 2, cells: ['CRM', 'Active'], cellMeta: new Map() },
      { rowNumber: 3, cells: ['ERP', 'Retired'], cellMeta: new Map() },
    ]);
  });

  it('skips an individual fully-blank row without stopping', () => {
    const sheet = makeSheet([
      ['Application', 'Status'],
      ['CRM', 'Active'],
      ['', ''],
      ['ERP', 'Retired'],
    ]);
    const rows = extractDataRows(sheet, 0, 0);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('stops before a run of 3 consecutive fully-blank rows', () => {
    const sheet = makeSheet([
      ['Application', 'Status'],
      ['CRM', 'Active'],
      ['', ''],
      ['', ''],
      ['', ''],
      ['ERP', 'Retired'],
    ]);
    const rows = extractDataRows(sheet, 0, 0);
    expect(rows.map((r) => r.rowNumber)).toEqual([2]);
  });

  it('stops before a Total/Totals/Count row, case-insensitively, without emitting it', () => {
    const sheet = makeSheet([
      ['Application', 'Status'],
      ['CRM', 'Active'],
      ['TOTAL', ''],
      ['ERP', 'Retired'],
    ]);
    const rows = extractDataRows(sheet, 0, 0);
    expect(rows.map((r) => r.rowNumber)).toEqual([2]);
  });

  it('carries per-column cell metadata for a row, keyed by column index', () => {
    const sheet: RawSheet = {
      sheetName: 'Sheet1',
      grid: [
        ['Application', 'Vendor'],
        ['CRM', 'Civica / Northgate'],
      ],
      cellMeta: new Map([['1,1', { merged: true }]]),
    };
    const rows = extractDataRows(sheet, 0, 0);
    expect(rows[0]?.cellMeta.get(1)).toEqual({ merged: true });
    expect(rows[0]?.cellMeta.get(0)).toBeUndefined();
  });
});
