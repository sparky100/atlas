/**
 * F2 (full K1), SPEC-capture.md §5.1/§5.2: the free-header `.xlsx`/`.xlsm`
 * parser — a genuinely new parser, distinct from F2-lite's own
 * `parseImportFile.ts` (fixed columns, header always row 1), which keeps
 * serving F2-lite's own reconciliation-importer flow untouched.
 *
 * SheetJS (`xlsx`) only — same library F2-lite and export already use,
 * `elementExportXlsx.ts`'s own precedent for keeping it to one import site
 * per concern.
 */
import * as XLSX from 'xlsx';
import { cellMetaKey, detectHeaderRow, type CellMeta, type RawSheet } from './sheetGrid';

export class SpreadsheetParseError extends Error {}

function cellToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (cell.t === 'e') return '';
  if (typeof cell.w === 'string') return cell.w;
  if (cell.v === undefined) return '';
  if (cell.v instanceof Date) return cell.v.toISOString();
  return String(cell.v);
}

/** Builds `RawSheet.grid`/`cellMeta` from a SheetJS worksheet — merges (`MERGED_CELL`) and formula-error cells (`FORMULA_ERROR`, `t === 'e'`) are the only two things `.xlsx` can carry that a plain grid can't. */
function toRawSheet(sheetName: string, sheet: XLSX.WorkSheet): RawSheet {
  const ref = sheet['!ref'];
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };

  const grid: string[][] = [];
  const cellMeta = new Map<string, CellMeta>();

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      row.push(cellToString(cell));
      if (cell?.t === 'e') cellMeta.set(cellMetaKey(r - range.s.r, c - range.s.c), { formulaError: true });
    }
    grid.push(row);
  }

  for (const merge of sheet['!merges'] ?? []) {
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const key = cellMetaKey(r - range.s.r, c - range.s.c);
        cellMeta.set(key, { ...cellMeta.get(key), merged: true });
      }
    }
  }

  return { sheetName, grid, cellMeta };
}

export interface ParsedSpreadsheetSheet {
  sheetName: string;
  /** `null` → `SHEET_NO_HEADER` (§5.1 table); the sheet contributes nothing. */
  headerRowIndex: number | null;
  /** Header cell text, aligned 1:1 with `headerColumnRefs` — `''` for a blank header cell (never itself given a role). */
  headers: string[];
  /** A1 column letters, e.g. `["A","B","C"]`, aligned to `headers`. */
  headerColumnRefs: string[];
  /**
   * The full sheet (every row, header included) — `null` when
   * `headerRowIndex` is `null`. Deliberately *not* windowed into data rows
   * here: §5.2 step 3's own blank-run/`Total` row stopping rule needs to
   * know which column is `name`, which isn't decided until step 2 (column
   * mapping) runs — that windowing is `rowsToCandidates.ts`'s own first
   * move, via `extractDataRows` (`sheetGrid.ts`), not this parser's.
   */
  rawSheet: RawSheet | null;
}

/** §5.1: reads every sheet in the workbook; a sheet with no detectable header row is still returned (with `headerRowIndex: null`) so the caller can record `SHEET_NO_HEADER` rather than silently dropping it. */
export function parseXlsxWorkbook(buffer: ArrayBuffer): ParsedSpreadsheetSheet[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellFormula: false });
  } catch (e) {
    throw new SpreadsheetParseError(`Could not read workbook: ${e instanceof Error ? e.message : String(e)}`);
  }

  return workbook.SheetNames.map((sheetName): ParsedSpreadsheetSheet => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return { sheetName, headerRowIndex: null, headers: [], headerColumnRefs: [], rawSheet: null };

    const raw = toRawSheet(sheetName, sheet);
    const headerRowIndex = detectHeaderRow(raw.grid);
    if (headerRowIndex === null) return { sheetName, headerRowIndex: null, headers: [], headerColumnRefs: [], rawSheet: raw };

    const headerRow = raw.grid[headerRowIndex] ?? [];
    const headers = headerRow.map((cell) => cell.trim());
    const headerColumnRefs = headers.map((_, c) => XLSX.utils.encode_col(c));

    return { sheetName, headerRowIndex, headers, headerColumnRefs, rawSheet: raw };
  });
}
