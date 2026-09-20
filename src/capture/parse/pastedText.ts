/**
 * F2 (full K1) PR11, SPEC-capture.md §5.1: pasted text needs no real
 * parser — "none" is the table's own entry — but text pasted from Word,
 * Outlook or a browser routinely carries a leading BOM and CRLF line
 * endings, neither of which `chunk.ts`'s own paragraph-boundary regex
 * (`\n\s*\n`) or a passage's own byte-exact grounding should have to know
 * about. Normalising both away here, once, keeps every downstream offset
 * (chunking, grounding, `SourceRef`) counted against the same text a
 * person actually sees.
 */

export interface ParsedPastedText {
  text: string;
  charCount: number;
}

const BOM = '﻿';

export function parsePastedText(raw: string): ParsedPastedText {
  const withoutBom = raw.startsWith(BOM) ? raw.slice(1) : raw;
  const text = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return { text, charCount: text.length };
}
