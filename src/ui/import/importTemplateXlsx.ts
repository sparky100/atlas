/**
 * F2-lite's `.xlsx` template writer — the only place SheetJS (`xlsx`) is
 * imported for the template, so `src/capture/importTemplate.ts`'s pure row-
 * building stays testable without it (`elementExportXlsx.ts`'s own split).
 */
import * as XLSX from 'xlsx';
import { importTemplateRows } from '../../capture/importTemplate';

export function importTemplateXlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(importTemplateRows());
  XLSX.utils.book_append_sheet(wb, ws, 'Systems');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
