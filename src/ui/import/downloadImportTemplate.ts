/**
 * "Download a blank spreadsheet" on the Import page: the importer's own
 * columns as an `.xlsx`, built by `src/capture/importTemplate.ts` (pure) and
 * written here — the only place the template touches SheetJS.
 */
import * as XLSX from 'xlsx';
import { buildImportTemplateSheets } from '../../capture/importTemplate';

export function importTemplateXlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  for (const sheet of buildImportTemplateSheets()) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.cells);
    const widest = sheet.cells.reduce<number[]>((acc, row) => row.map((cell, i) => Math.max(acc[i] ?? 0, Math.min(cell.length, sheet.name === 'Read me first' ? 110 : 40))), []);
    ws['!cols'] = widest.map((wch) => ({ wch: wch + 2 }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadImportTemplate(): void {
  const url = URL.createObjectURL(importTemplateXlsxBlob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'atlas-import-template.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
