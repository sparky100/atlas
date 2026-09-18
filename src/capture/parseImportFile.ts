/**
 * F2-lite ("spreadsheet import as reconciliation") — reads a `.csv` or
 * `.xlsx` file into validated rows. The only place SheetJS (`xlsx`) is
 * imported in this module (`importRowSchema.ts`'s own validation stays
 * testable without it), same split `elementExportXlsx.ts` already
 * established for export.
 *
 * `XLSX.read` auto-detects CSV (SheetJS's own documented behaviour) —
 * there is deliberately no separate CSV parser here; both file types go
 * through the one code path below.
 */
import * as XLSX from 'xlsx';
import { validateImportRow, type ImportRow, type ImportRowResult } from './importRowSchema';

export interface ParsedImportFile {
  fileName: string;
  /** Every column header the file's own header row actually has, in file order — the dialog's "detected columns" preview, before any per-row validation runs. */
  detectedColumns: string[];
  /** The file's own first few raw rows (pre-validation, keyed by header) — the dialog's "first rows" preview. */
  previewRows: Record<string, unknown>[];
  /** Every row that validated. */
  rows: ImportRow[];
  /** Every row that didn't, in source order — a real error per row (`ImportRowResult`'s own `error`), never silently dropped. */
  errors: { rowNumber: number; error: string }[];
}

/** How many of the file's own raw rows the dialog's preview shows, before any matching/classification runs. */
const PREVIEW_ROW_COUNT = 5;

export class ImportFileParseError extends Error {}

/**
 * `file.arrayBuffer()` → `XLSX.read` → one row object per sheet row, keyed
 * by header (`sheet_to_json`'s own `defval: null` — a cell the row's own
 * source didn't fill reads as `null`, not `undefined`, so a genuinely
 * blank optional column and a column the file never had at all look the
 * same to `validateImportRow`, which is the right behaviour for both).
 * Reads the first sheet only — a v1 scope choice (this session's plan's
 * own "Explicitly out of scope" list), not a silent limitation: multi-sheet
 * input is Phase 3's own "different file formats/structures" territory.
 */
export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const buffer = await file.arrayBuffer();
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch (e) {
    throw new ImportFileParseError(`Could not read "${file.name}" as a CSV or XLSX file: ${e instanceof Error ? e.message : String(e)}`);
  }

  const firstSheetName = workbook.SheetNames[0];
  if (firstSheetName === undefined) {
    throw new ImportFileParseError(`"${file.name}" has no sheets to read.`);
  }
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw new ImportFileParseError(`"${file.name}"'s first sheet could not be read.`);
  }

  const rawRows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  // `header: 1` reads the sheet as a plain array-of-arrays — its own first
  // row is the file's real header cells, in file order, independent of
  // `sheet_to_json`'s own object-keying (which silently drops a header
  // cell that's blank or a duplicate) — exactly what "detected columns"
  // should show, including a column this format doesn't recognise.
  const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] ?? []) as unknown[];
  const detectedColumns = headerRow
    .map((cell) => (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' ? String(cell).trim() : ''))
    .filter((cell) => cell.length > 0);

  const rows: ImportRow[] = [];
  const errors: { rowNumber: number; error: string }[] = [];
  rawRows.forEach((raw, index) => {
    // +2: row 1 is the header row, and this is 1-based like every spreadsheet a reader would open in Excel.
    const result: ImportRowResult = validateImportRow(raw, index + 2);
    if (result.ok) rows.push(result.row);
    else errors.push({ rowNumber: result.rowNumber, error: result.error });
  });

  if (rows.length === 0 && errors.length === 0) {
    throw new ImportFileParseError(`"${file.name}" has a header row but no data rows.`);
  }

  return { fileName: file.name, detectedColumns, previewRows: rawRows.slice(0, PREVIEW_ROW_COUNT), rows, errors };
}
