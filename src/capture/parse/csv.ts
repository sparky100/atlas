/**
 * F2 (full K1), SPEC-capture.md §5.1: "own parser (RFC 4180, BOM-tolerant,
 * delimiter sniffed from the first 20 lines)." Deliberately not SheetJS —
 * `spreadsheet.ts` is XLSX's own parser; a `.csv`/`.tsv` file gets a real
 * RFC 4180 reader (quoted fields, embedded delimiters/newlines, `""` as an
 * escaped quote) rather than routing through a spreadsheet library that
 * happens to also read CSV.
 */
import { detectHeaderRow, type RawSheet } from './sheetGrid';
import type { ParsedSpreadsheetSheet } from './spreadsheet';

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const;
const SNIFF_LINE_COUNT = 20;
const BOM_CHAR = String.fromCharCode(0xfeff);

/** Splits on bare `\n`/`\r\n` — safe here because it only runs over the *sniff* sample, never inside a quoted field (a quoted field's own embedded newline would just shift the sniff sample by one row, which doesn't change which delimiter wins). */
function sniffLines(text: string): string[] {
  return text.split(/\r\n|\n/).slice(0, SNIFF_LINE_COUNT);
}

/** Picks the delimiter whose per-line field count (naive split, quoting ignored — good enough for sniffing) is most consistent across the sample and > 1 on average; falls back to comma. */
function sniffDelimiter(text: string): string {
  let best: { delimiter: string; score: number } | null = null;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = sniffLines(text)
      .filter((line) => line.trim() !== '')
      .map((line) => line.split(delimiter).length);
    if (counts.length === 0) continue;
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 1;
    if (mode <= 1) continue;
    const consistency = counts.filter((c) => c === mode).length / counts.length;
    const score = consistency * mode;
    if (!best || score > best.score) best = { delimiter, score };
  }
  return best?.delimiter ?? ',';
}

/** RFC 4180: a field is either unquoted (no delimiter/quote/newline) or `"..."` with `""` as an escaped literal quote. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i] ?? '';
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += char;
      i++;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Strips a leading UTF-8 BOM (U+FEFF), sniffs the delimiter, then parses. Every row is padded to the grid's own widest row width, matching `spreadsheet.ts`'s own `RawSheet.grid` contract (a blank trailing cell reads as `''`, not "missing"). */
export function parseCsv(text: string, sheetName: string): ParsedSpreadsheetSheet {
  const withoutBom = text.startsWith(BOM_CHAR) ? text.slice(1) : text;
  const delimiter = sniffDelimiter(withoutBom);
  const rawRows = parseRows(withoutBom, delimiter).filter((row) => !(row.length === 1 && row[0] === ''));

  const width = rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const grid = rawRows.map((row) => Array.from({ length: width }, (_, c) => row[c] ?? ''));

  const rawSheet: RawSheet = { sheetName, grid, cellMeta: new Map() };
  const headerRowIndex = detectHeaderRow(grid);
  if (headerRowIndex === null) return { sheetName, headerRowIndex: null, headers: [], headerColumnRefs: [], rawSheet };

  const headerRow = grid[headerRowIndex] ?? [];
  const headers = headerRow.map((cell) => cell.trim());
  const headerColumnRefs = headers.map((_, c) => encodeColumnLetter(c));

  return { sheetName, headerRowIndex, headers, headerColumnRefs, rawSheet };
}

/** 0-indexed column number → A1 column letters (`0` → `"A"`, `26` → `"AA"`) — a plain reimplementation rather than importing `xlsx` just for this into what is otherwise a from-scratch parser. */
function encodeColumnLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}
