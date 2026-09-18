/**
 * F2-lite's `.xlsx` template writer — the only place SheetJS (`xlsx`) is
 * imported for the template, so `src/capture/importTemplate.ts`'s pure row-
 * building stays testable without it (`elementExportXlsx.ts`'s own split).
 */
import * as XLSX from 'xlsx';
import { importRelationshipTemplateRows, importTemplateRows } from '../../capture/importTemplate';

/** Two sheets: "Systems" (the main element rows every import needs) and "Relationships" (import close-out's own optional sheet — the exact name `parseImportFile.ts` looks for). */
export function importTemplateXlsxBlob(): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(importTemplateRows()), 'Systems');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(importRelationshipTemplateRows()), 'Relationships');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
