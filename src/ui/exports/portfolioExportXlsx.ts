/**
 * The Portfolio as an `.xlsx` — the only place SheetJS is imported for it, loaded on demand so the Portfolio page doesn't carry it until someone asks for Excel.
 */
import * as XLSX from 'xlsx';
import type { ExportStamp } from './viewExport';

/** One `Portfolio` sheet with the table, and an `About` sheet carrying the stamp (which model, which state, when) so a file passed around says what it shows. */
export function portfolioTableToXlsxBlob(table: readonly (readonly string[])[], stamp: ExportStamp): Blob {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(table.map((row) => [...row]));
  sheet['!cols'] = (table[0] ?? []).map((_, column) => ({ wch: Math.min(48, Math.max(10, ...table.map((row) => (row[column] ?? '').length))) }));
  XLSX.utils.book_append_sheet(wb, sheet, 'Portfolio');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Model', stamp.modelName],
      ['View', stamp.viewLabel],
      ['State', stamp.refLabel],
      ['Exported', stamp.date],
      ['Rows', String(Math.max(0, table.length - 1))],
    ]),
    'About',
  );
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
