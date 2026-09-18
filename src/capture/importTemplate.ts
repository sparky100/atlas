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
import { RELATIONSHIP_IMPORT_COLUMNS, type RelationshipImportColumn } from './importRelationshipRow';

const EXAMPLE_ROW: Record<ImportColumn, string> = {
  name: 'Council Tax System',
  description: 'Handles resident council tax accounts and billing.',
  kind: 'application',
  lifecycle: 'active',
  criticality: 'high',
  domain: 'it',
  hosting_model: 'public_cloud',
  vendor: 'Acme Corp',
  is_external: 'false',
  external_organisation: '',
  platform: '',
  capability: 'Billing|Customer Accounts',
  business_owner: 'Jane Doe',
  technical_owner: 'Ofgem (External: Energy regulator)',
};

/**
 * A second example row — a module of a platform, so "platform column alone
 * decides structure" is shown, not just described. `business_owner` is
 * filled in too, deliberately: a module can carry its own owner,
 * independent of its platform's (or its sibling modules') — SAP's FI and PM
 * modules routinely answer to different business units, exactly the case
 * `RELATIONSHIP_TYPE_RULES`'s `owns: actor → container` row exists for.
 */
const EXAMPLE_MODULE_ROW: Record<ImportColumn, string> = {
  name: 'PM',
  description: 'Plant maintenance module.',
  kind: '',
  lifecycle: 'active',
  criticality: '',
  domain: '',
  hosting_model: '',
  vendor: '',
  is_external: 'false',
  external_organisation: '',
  platform: 'SAP',
  capability: 'Asset Maintenance',
  business_owner: 'Priya Patel',
  technical_owner: '',
};

/** Header row, then two example rows — the exact shape a `.csv`/`.xlsx` writer turns into a real file. */
export function importTemplateRows(): string[][] {
  return [[...IMPORT_COLUMNS], IMPORT_COLUMNS.map((column) => EXAMPLE_ROW[column]), IMPORT_COLUMNS.map((column) => EXAMPLE_MODULE_ROW[column])];
}

const EXAMPLE_RELATIONSHIP_ROW: Record<RelationshipImportColumn, string> = {
  from: 'Council Tax System',
  type: 'flows_to',
  to: 'SAP · PM',
  description: 'sends payment confirmations to',
  via: '',
  data_classification: 'official',
};

/** Header row, then one example row, for the optional "Relationships" sheet (import close-out; XLSX only — a plain CSV has no second sheet to carry one). Shows the "Platform · Module" compound endpoint form. */
export function importRelationshipTemplateRows(): string[][] {
  return [[...RELATIONSHIP_IMPORT_COLUMNS], RELATIONSHIP_IMPORT_COLUMNS.map((column) => EXAMPLE_RELATIONSHIP_ROW[column])];
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** RFC 4180 CSV of the template — the same escaping `elementExport.ts`'s own `csvCell` uses, kept local rather than imported: `src/capture` is a pipeline stage `src/ui` depends on, never the other way (CLAUDE.md's own layering). CSV is single-sheet by construction, so this never includes the Relationships example — only the XLSX template does. */
export function importTemplateCsv(): string {
  return importTemplateRows()
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
