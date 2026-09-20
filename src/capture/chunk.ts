/**
 * F2 (full K1) PR11, SPEC-capture.md §5.3 "Chunking": groups a PDF's own
 * per-page text into ≤ 12,000-character chunks without ever splitting a
 * page, and splits pasted text into ≤ 12,000-character chunks at paragraph
 * boundaries when the whole thing doesn't fit in one. Each chunk carries
 * enough of its own offset bookkeeping that `ground.ts`'s own found-offset
 * (into the chunk's own concatenated text) can be translated back to a real
 * `SourceRef` (§4.1: `pdf:p{page}!{start}-{end}` needs the *page-local*
 * offset; `text:{start}-{end}` needs the offset into the *whole pasted
 * text*) — `runCapture.ts` (the only caller) does that translation, this
 * module only hands it the ranges to do it with.
 */

export const MAX_CHUNK_CHARS = 12000;
const PAGE_JOIN = '\n\n';

export interface PdfPageInput {
  /** 1-indexed, matching how a PDF viewer numbers its own pages. */
  page: number;
  text: string;
}

/** One page's own span within a `PdfChunk.text` — `[start, end)`. */
export interface PdfChunkPageRange {
  page: number;
  start: number;
  end: number;
}

export interface PdfChunk {
  text: string;
  firstPage: number;
  lastPage: number;
  totalPages: number;
  pageRanges: PdfChunkPageRange[];
}

/** §5.3: "consecutive pages are grouped into chunks of ≤ 12,000 characters, never splitting a page" — a single page longer than the cap still gets its own chunk alone, over the cap, rather than being cut mid-page. */
export function chunkPdfPages(pages: readonly PdfPageInput[], maxChunkChars = MAX_CHUNK_CHARS): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  let texts: string[] = [];
  let pageRanges: PdfChunkPageRange[] = [];
  let length = 0;

  const flush = (): void => {
    const firstRange = pageRanges[0];
    const lastRange = pageRanges[pageRanges.length - 1];
    if (!firstRange || !lastRange) return;
    chunks.push({ text: texts.join(PAGE_JOIN), firstPage: firstRange.page, lastPage: lastRange.page, totalPages: pages.length, pageRanges });
    texts = [];
    pageRanges = [];
    length = 0;
  };

  for (const p of pages) {
    const joinLength = texts.length > 0 ? PAGE_JOIN.length : 0;
    if (texts.length > 0 && length + joinLength + p.text.length > maxChunkChars) flush();

    const start = length + (texts.length > 0 ? PAGE_JOIN.length : 0);
    texts.push(p.text);
    pageRanges.push({ page: p.page, start, end: start + p.text.length });
    length = start + p.text.length;
  }
  flush();

  return chunks;
}

export interface TextChunk {
  text: string;
  /** Offsets into the *original*, un-chunked pasted text. */
  start: number;
  end: number;
  total: number;
}

const PARAGRAPH_BREAK = /\n\s*\n/g;

interface Paragraph {
  start: number;
  end: number;
}

/** Every run of text between blank-line separators, offsets into `text` — the whole string is one "paragraph" when it contains no blank line at all. */
function splitIntoParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let lastIndex = 0;
  PARAGRAPH_BREAK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PARAGRAPH_BREAK.exec(text))) {
    paragraphs.push({ start: lastIndex, end: match.index });
    lastIndex = PARAGRAPH_BREAK.lastIndex;
  }
  paragraphs.push({ start: lastIndex, end: text.length });
  return paragraphs;
}

/** §5.3: "one chunk if ≤ 12,000 chars, else split at paragraph boundaries" — mirrors `chunkPdfPages`'s own "never split the unit" rule: a single paragraph longer than the cap still gets its own chunk alone. */
export function chunkPastedText(text: string, maxChunkChars = MAX_CHUNK_CHARS): TextChunk[] {
  if (text.length <= maxChunkChars) return [{ text, start: 0, end: text.length, total: text.length }];

  const paragraphs = splitIntoParagraphs(text);
  const chunks: TextChunk[] = [];
  let currentStart: number | null = null;
  let currentEnd = 0;

  for (const paragraph of paragraphs) {
    if (currentStart === null) {
      currentStart = paragraph.start;
      currentEnd = paragraph.end;
      continue;
    }
    if (paragraph.end - currentStart > maxChunkChars) {
      chunks.push({ text: text.slice(currentStart, currentEnd), start: currentStart, end: currentEnd, total: text.length });
      currentStart = paragraph.start;
      currentEnd = paragraph.end;
    } else {
      currentEnd = paragraph.end;
    }
  }
  if (currentStart !== null) chunks.push({ text: text.slice(currentStart, currentEnd), start: currentStart, end: currentEnd, total: text.length });

  return chunks;
}
