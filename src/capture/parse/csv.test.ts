import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a plain comma-delimited file with a header row', () => {
    const text = 'Application,Supplier,Status\nCRM,Acme,Active\nERP,Beta,Retired\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.headerRowIndex).toBe(0);
    expect(result.headers).toEqual(['Application', 'Supplier', 'Status']);
    expect(result.headerColumnRefs).toEqual(['A', 'B', 'C']);
    expect(result.rawSheet?.grid.slice(1)).toEqual([
      ['CRM', 'Acme', 'Active'],
      ['ERP', 'Beta', 'Retired'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    const text = `${bom}Application,Supplier,Status\nCRM,Acme,Active\n`;
    const result = parseCsv(text, 'input.csv');
    expect(result.headers).toEqual(['Application', 'Supplier', 'Status']);
  });

  it('sniffs a semicolon delimiter', () => {
    const text = 'Application;Supplier;Status\nCRM;Acme;Active\nERP;Beta;Retired\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.headers).toEqual(['Application', 'Supplier', 'Status']);
  });

  it('sniffs a tab delimiter (.tsv)', () => {
    const text = 'Application\tSupplier\tStatus\nCRM\tAcme\tActive\n';
    const result = parseCsv(text, 'input.tsv');
    expect(result.headers).toEqual(['Application', 'Supplier', 'Status']);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const text = 'Application,Description\n"CRM","Handles ""customer"" records, and more"\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.rawSheet?.grid[1]).toEqual(['CRM', 'Handles "customer" records, and more']);
  });

  it('handles a quoted field with an embedded newline', () => {
    const text = 'Application,Description\n"CRM","Line one\nLine two"\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.rawSheet?.grid[1]).toEqual(['CRM', 'Line one\nLine two']);
  });

  it('pads short rows to the grid\'s own widest row width', () => {
    const text = 'Application,Supplier,Status\nCRM,Acme\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.rawSheet?.grid[1]).toEqual(['CRM', 'Acme', '']);
  });

  it('returns headerRowIndex: null for a sheet with no detectable header', () => {
    const text = '\n\n\n';
    const result = parseCsv(text, 'input.csv');
    expect(result.headerRowIndex).toBeNull();
  });
});
