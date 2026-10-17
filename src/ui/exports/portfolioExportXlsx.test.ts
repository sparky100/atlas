import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { portfolioTableToXlsxBlob } from './portfolioExportXlsx';

function sheet(wb: XLSX.WorkBook, name: string): XLSX.WorkSheet {
  const found = wb.Sheets[name];
  if (!found) throw new Error(`no sheet "${name}"`);
  return found;
}

describe('portfolioTableToXlsxBlob', () => {
  it('writes the table on a Portfolio sheet and the stamp on an About sheet', async () => {
    const blob = portfolioTableToXlsxBlob([['Name', 'Kind'], ['Housing CRM', 'System']], { modelName: 'Acme', viewLabel: 'Portfolio', refLabel: 'Main', date: '2026-10-16' });
    const wb = XLSX.read(await blob.arrayBuffer());
    expect(wb.SheetNames).toEqual(['Portfolio', 'About']);
    expect(XLSX.utils.sheet_to_json(sheet(wb, 'Portfolio'), { header: 1 })).toEqual([['Name', 'Kind'], ['Housing CRM', 'System']]);
    expect(XLSX.utils.sheet_to_json(sheet(wb, 'About'), { header: 1 })).toEqual([['Model', 'Acme'], ['View', 'Portfolio'], ['State', 'Main'], ['Exported', '2026-10-16'], ['Rows', '1']]);
  });
});
