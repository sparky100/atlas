/**
 * F8's `.xlsx` writer — the only place SheetJS (`xlsx`) is imported, so the
 * pure sheet-building in `elementExport.ts` stays testable without it.
 */
import * as XLSX from 'xlsx';
import { buildExportSheets } from './elementExport';
import type { RelationshipExportRow, ExportProvenance } from './elementExport';
import type { AttributeDefinitionRow } from '../../db/types';
import type { BrowseRow } from '../../db/elementBrowse';
import type { UUID } from '../../contracts/delta';

/** Builds the workbook and writes it to a Blob — one sheet per element type plus `Relationships`. */
export function browseRowsToXlsxBlob(rows: readonly BrowseRow[], definitions: readonly AttributeDefinitionRow[], provenanceById: ReadonlyMap<UUID, ExportProvenance>, relationships: readonly RelationshipExportRow[]): Blob {
  const sheets = buildExportSheets(rows, definitions, provenanceById, relationships);
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.cells);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
