/**
 * F2-lite ("spreadsheet import as reconciliation") — the downloadable
 * template the import dialog offers: the format's own column headers plus
 * one example row, so someone building a file by hand knows both the exact
 * header spelling and roughly what a filled-in cell looks like. Pure — row
 * data only; `src/ui/import/importTemplateXlsx.ts` is the one place SheetJS
 * writes it to a real file, same split `elementExportXlsx.ts` already
 * established for the export side (`src/capture` never imports `xlsx`
 * directly outside `parseImportFile.ts`).
 */
import { IMPORT_COLUMNS, type ImportColumn } from './importRowSchema';

const EXAMPLE_ROW: Record<ImportColumn, string> = {
  name: 'Council Tax System',
  description: 'Handles resident council tax accounts and billing.',
  kind: 'application',
  lifecycle: 'active',
  criticality: 'high',
  domain: 'it',
  hosting_model: 'public_cloud',
  vendor: 'Acme Corp',
  platform: '',
  capability: 'Billing',
  business_owner: 'Jane Doe',
  technical_owner: 'John Smith',
};

/** Header row, then one example row — the exact shape a `.csv`/`.xlsx` writer turns into a real file. */
export function importTemplateRows(): string[][] {
  return [[...IMPORT_COLUMNS], IMPORT_COLUMNS.map((column) => EXAMPLE_ROW[column])];
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** RFC 4180 CSV of the template — the same escaping `elementExport.ts`'s own `csvCell` uses, kept local rather than imported: `src/capture` is a pipeline stage `src/ui` depends on, never the other way (CLAUDE.md's own layering). */
export function importTemplateCsv(): string {
  return importTemplateRows()
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
