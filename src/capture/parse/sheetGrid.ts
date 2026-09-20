/**
 * F2 (full K1), SPEC-capture.md §5.1/§5.2: the shared grid shape both
 * `spreadsheet.ts` (XLSX) and `csv.ts` produce, plus the two pieces of
 * header/row logic that apply identically to either format — "for each
 * sheet" (§5.2 step 1) doesn't care where the sheet came from. CSV always
 * has an empty `cellMeta` (no merges, no formula errors are possible in a
 * plain-text format).
 */
import { parseDate } from '../normaliseValue';

export interface CellMeta {
  merged?: boolean;
  formulaError?: boolean;
}

/** `${row},${col}`, both 0-indexed — the one place a cell's grid position is turned into a lookup key, so `spreadsheet.ts`'s writer and every reader agree on the format. */
export function cellMetaKey(row: number, col: number): string {
  return `${String(row)},${String(col)}`;
}

export interface RawSheet {
  sheetName: string;
  /** Row-major, 0-indexed. `''` for a blank cell — never `undefined`, so every row has the same length as the sheet's own widest row. */
  grid: string[][];
  cellMeta: ReadonlyMap<string, CellMeta>;
}

const HEADER_SEARCH_WINDOW = 15;
const MIN_HEADER_NON_EMPTY = 3;
const MAX_DATE_OR_NUMBER_FRACTION = 1 / 3;
const MIN_FOLLOWING_ROW_NON_EMPTY = 2;

function isBlank(cell: string): boolean {
  return cell.trim() === '';
}

/** A cell that would make a *data* row look like a header if it dominated — parseable as a plain number, or as one of `parseDate`'s own recognised shapes. */
function looksLikeDateOrNumber(cell: string): boolean {
  const trimmed = cell.trim();
  if (trimmed === '') return false;
  if (Number.isFinite(Number(trimmed))) return true;
  return parseDate(trimmed) !== null;
}

/**
 * §5.2 step 1: the first row in the top 15 that (a) has ≥ 3 non-empty
 * cells, (b) has no cell parseable as a date or number in more than a
 * third of its cells, and (c) is followed by a row with ≥ 2 non-empty
 * cells. Returns `null` (→ `SHEET_NO_HEADER`) when nothing in the window
 * qualifies.
 */
export function detectHeaderRow(grid: readonly (readonly string[])[]): number | null {
  const limit = Math.min(grid.length, HEADER_SEARCH_WINDOW);
  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? [];
    const nonEmpty = row.filter((cell) => !isBlank(cell));
    if (nonEmpty.length < MIN_HEADER_NON_EMPTY) continue;

    const dateOrNumberCount = nonEmpty.filter(looksLikeDateOrNumber).length;
    if (dateOrNumberCount / nonEmpty.length > MAX_DATE_OR_NUMBER_FRACTION) continue;

    const nextRow = grid[r + 1] ?? [];
    const nextNonEmpty = nextRow.filter((cell) => !isBlank(cell)).length;
    if (nextNonEmpty < MIN_FOLLOWING_ROW_NON_EMPTY) continue;

    return r;
  }
  return null;
}

const TOTAL_ROW_NAME_VALUES = new Set(['total', 'totals', 'count']);
const BLANK_RUN_STOP_LENGTH = 3;

export interface SpreadsheetRow {
  /** 1-based, matching how a real spreadsheet numbers its own rows. */
  rowNumber: number;
  /** Aligned to the sheet's headers. */
  cells: readonly string[];
  /** This row's own per-column metadata, keyed by column index (0-indexed, aligned to `cells`) — already sliced out of the sheet-wide `cellMeta` map, so a caller never needs `cellMetaKey`/the row's absolute grid position. */
  cellMeta: ReadonlyMap<number, CellMeta>;
}

/**
 * §5.2 step 3's row window: starts just after the header row; skips an
 * individual fully-blank row without stopping; stops before a run of
 * `BLANK_RUN_STOP_LENGTH` consecutive fully-blank rows, and before a row
 * whose `name` cell is `Total`/`Totals`/`Count` (case-insensitive) —
 * neither is emitted as a data row.
 */
export function extractDataRows(sheet: RawSheet, headerRowIndex: number, nameColIndex: number): SpreadsheetRow[] {
  const rows: SpreadsheetRow[] = [];
  let consecutiveBlank = 0;

  for (let r = headerRowIndex + 1; r < sheet.grid.length; r++) {
    const cells = sheet.grid[r] ?? [];
    const rowIsBlank = cells.every(isBlank);

    if (rowIsBlank) {
      consecutiveBlank++;
      if (consecutiveBlank >= BLANK_RUN_STOP_LENGTH) break;
      continue;
    }
    consecutiveBlank = 0;

    const nameCell = (cells[nameColIndex] ?? '').trim().toLowerCase();
    if (TOTAL_ROW_NAME_VALUES.has(nameCell)) break;

    const rowMeta = new Map<number, CellMeta>();
    for (let c = 0; c < cells.length; c++) {
      const meta = sheet.cellMeta.get(cellMetaKey(r, c));
      if (meta) rowMeta.set(c, meta);
    }
    rows.push({ rowNumber: r + 1, cells, cellMeta: rowMeta });
  }

  return rows;
}
