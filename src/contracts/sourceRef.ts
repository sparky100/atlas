/**
 * F2 (full K1), SPEC-capture.md §4.1: the three grammars a capture delta's
 * `source_ref` (`deltas.source_ref`, plain text) can hold — bijective with
 * `SourceRef` (RT-K3), so a capture-produced ref round-trips exactly and a
 * hand-typed ref that isn't in any of the three grammars parses to `null`
 * rather than throwing (a manually-recorded delta's own `source_ref` is
 * free text today and stays free text — this module only ever needs to
 * recognise its *own* three shapes, never reject anything else).
 *
 * Sheet names can't contain `!` in a real spreadsheet (Excel's own
 * worksheet-name restriction), so splitting a `sheet:` ref on its first `!`
 * is unambiguous.
 */

export type SourceRef =
  | { kind: 'sheet'; sheet: string; range: string }
  | { kind: 'pdf'; page: number; start: number; end: number }
  | { kind: 'text'; start: number; end: number };

export function formatSourceRef(ref: SourceRef): string {
  if (ref.kind === 'sheet') return `sheet:${ref.sheet}!${ref.range}`;
  if (ref.kind === 'pdf') return `pdf:p${String(ref.page)}!${String(ref.start)}-${String(ref.end)}`;
  return `text:${String(ref.start)}-${String(ref.end)}`;
}

const PDF_PATTERN = /^pdf:p(\d+)!(\d+)-(\d+)$/;
const TEXT_PATTERN = /^text:(\d+)-(\d+)$/;
const SHEET_PATTERN = /^sheet:([^!]+)!(.+)$/;

export function parseSourceRef(text: string): SourceRef | null {
  const sheetMatch = SHEET_PATTERN.exec(text);
  if (sheetMatch?.[1] !== undefined && sheetMatch[2] !== undefined) {
    return { kind: 'sheet', sheet: sheetMatch[1], range: sheetMatch[2] };
  }

  const pdfMatch = PDF_PATTERN.exec(text);
  if (pdfMatch?.[1] !== undefined && pdfMatch[2] !== undefined && pdfMatch[3] !== undefined) {
    return { kind: 'pdf', page: Number(pdfMatch[1]), start: Number(pdfMatch[2]), end: Number(pdfMatch[3]) };
  }

  const textMatch = TEXT_PATTERN.exec(text);
  if (textMatch?.[1] !== undefined && textMatch[2] !== undefined) {
    return { kind: 'text', start: Number(textMatch[1]), end: Number(textMatch[2]) };
  }

  return null;
}
