/**
 * A saved report (or saved copy) as an `.xlsx` — a `Report` sheet with the
 * table and an `About` sheet saying what it is and when it was read. Loaded
 * on demand, like `portfolioExportXlsx.ts`.
 */
import * as XLSX from 'xlsx';

export interface ReportXlsxAbout {
  report: string;
  model: string;
  /** e.g. "main · as at 2026-11-06" */
  state: string;
  /** Extra lines, e.g. the commit a saved copy was read at. */
  extra?: readonly (readonly [string, string])[];
}

export function reportTableToXlsxBlob(table: readonly (readonly string[])[], about: ReportXlsxAbout): Blob {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(table.map((row) => [...row]));
  sheet['!cols'] = (table[0] ?? []).map((_, column) => ({ wch: Math.min(48, Math.max(10, ...table.map((row) => (row[column] ?? '').length))) }));
  XLSX.utils.book_append_sheet(wb, sheet, 'Report');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['Report', about.report], ['Model', about.model], ['State', about.state], ...(about.extra ?? []).map(([k, v]) => [k, v]), ['Rows', String(Math.max(0, table.length - 1))]]),
    'About',
  );
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
