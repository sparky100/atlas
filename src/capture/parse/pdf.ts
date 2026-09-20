/**
 * F2 (full K1) PR11, SPEC-capture.md §5.1: ".pdf | pdfjs-dist text
 * extraction per page, reading order by (y, x) with a line-join heuristic
 * | per page: text, char offsets; a page with < 20 non-whitespace
 * characters is flagged NO_TEXT." `pdfjs-dist` (community build, pinned —
 * same "one library, one import site" precedent `parse/spreadsheet.ts`
 * already set for `xlsx`) is loaded from its own `legacy/build` entry
 * point with `disableWorker: true`: this runs inside `capture-run` (a Deno
 * edge function, K-15) and, in this repo, inside plain Node under Vitest —
 * neither is a browser main thread with a `Worker` global pdfjs's own
 * default build assumes.
 *
 * `getTextContent()`'s own item order already interleaves multi-column
 * text in reading order more often than not, but SPEC's own "(y, x)"
 * wording asks for an explicit, checkable rule rather than trusting
 * whatever order the PDF's content stream happens to store runs in — this
 * module re-sorts every page's own text runs top-to-bottom
 * (descending `y` — PDF page co-ordinates grow upward) then left-to-right
 * within a line (`Y_EPSILON`-tolerant grouping, since two runs on the same
 * visual line are rarely at *exactly* the same baseline).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export class PdfParseError extends Error {}
export class PdfPasswordProtectedError extends PdfParseError {}

export const NO_TEXT_THRESHOLD = 20;

export interface PdfPage {
  /** 1-indexed, matching how a PDF viewer numbers its own pages. */
  page: number;
  text: string;
  /** Non-whitespace character count — the §5.1/§11 `NO_TEXT_LAYER` test is against this, not `text.length` (a page of pure layout whitespace should not count as having text). */
  nonWhitespaceCharCount: number;
}

export interface ParsedPdf {
  pages: PdfPage[];
}

/** True for a page that, on its own, would trigger `NO_TEXT_LAYER` — the caller (`runCapture.ts`) only fails the whole job when *every* page is like this (a text-and-scanned-pages mix still parses). */
export function pageHasNoText(page: PdfPage): boolean {
  return page.nonWhitespaceCharCount < NO_TEXT_THRESHOLD;
}

interface RawTextItem {
  str: string;
  transform: number[];
}

function isRawTextItem(item: unknown): item is RawTextItem {
  return typeof item === 'object' && item !== null && 'str' in item && 'transform' in item;
}

const Y_EPSILON = 2;
const X_GAP_FOR_SPACE = 1;

/**
 * §5.1's own "(y, x) with a line-join heuristic": group text runs into
 * lines by y-proximity, sort each line left-to-right, join runs on one
 * line with a single space when they don't already touch (pdfjs splits a
 * line into several runs on any font/style change, not only at real word
 * boundaries — inserting one extra space where two runs already abut
 * costs nothing once `ground.ts`'s own whitespace-normalised search band
 * is available; silently gluing two words together would cost a fact).
 */
function pageTextFromItems(items: readonly unknown[]): string {
  const runs = items.filter(isRawTextItem).filter((item) => item.str.trim() !== '');
  const lines: { y: number; runs: { x: number; str: string }[] }[] = [];

  for (const run of runs) {
    const x = run.transform[4] ?? 0;
    const y = run.transform[5] ?? 0;
    const line = lines.find((l) => Math.abs(l.y - y) <= Y_EPSILON);
    if (line) line.runs.push({ x, str: run.str });
    else lines.push({ y, runs: [{ x, str: run.str }] });
  }

  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) => {
      const sorted = [...line.runs].sort((a, b) => a.x - b.x);
      let text = '';
      let previousEndX: number | null = null;
      for (const run of sorted) {
        if (previousEndX !== null && run.x - previousEndX > X_GAP_FOR_SPACE && !text.endsWith(' ') && !run.str.startsWith(' ')) {
          text += ' ';
        }
        text += run.str;
        previousEndX = run.x + run.str.length; // an approximation (no per-run width tracked) — good enough to decide "is there a gap", not to measure it.
      }
      return text;
    })
    .join('\n');
}

function countNonWhitespace(text: string): number {
  return text.replace(/\s/g, '').length;
}

/** pdfjs doesn't export its own `PasswordException` class from the public entry point (only `InvalidPDFException`/`MissingPDFException`/`UnexpectedResponseException`/`AbortException` are) — a name check on the rejection is the documented way callers detect it. */
function isPasswordException(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'name' in e && e.name === 'PasswordException';
}

async function loadPdfDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    // No `workerSrc`/`Worker` global is configured — outside a browser main thread (`capture-run` is a Deno edge function, K-15; this repo's own tests run under plain Node) pdfjs falls back to running its "worker" code in-process, which is exactly what a stateless, one-document-at-a-time parse needs.
    return await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  } catch (e) {
    if (isPasswordException(e)) throw new PdfPasswordProtectedError('PDF is password-protected (INPUT_ENCRYPTED).');
    throw new PdfParseError(`Could not read PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function parsePdf(bytes: ArrayBuffer): Promise<ParsedPdf> {
  const doc = await loadPdfDocument(bytes);
  const pages: PdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    // pdfjs's own per-page API is inherently sequential (each getPage/getTextContent call depends on the shared document handle); there is nothing to parallelise against.
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = pageTextFromItems(content.items);
    pages.push({ page: pageNumber, text, nonWhitespaceCharCount: countNonWhitespace(text) });
  }
  return { pages };
}
