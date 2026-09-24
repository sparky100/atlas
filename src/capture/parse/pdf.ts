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
 * whatever order the PDF's content stream happens to store runs in.
 *
 * Real multi-column documents (found via capture review: two runs from
 * unrelated columns landing at a similar y got glued onto one output line,
 * mid-sentence, by the original plain "sort every run on the page by (y,
 * x)" pass — the gap between them was still small enough to read as just a
 * wide inter-word space) need column awareness, not only a line-join
 * heuristic: a page's text runs are now grouped into column bands first
 * (`confirmedGutterXs`, below — a horizontal gap this wide, recurring at
 * roughly the same x across several distinct lines, is a real column
 * gutter; a single line's own one-off wide gap, e.g. a table's own cell
 * padding or a full-width heading that happens to span where a gutter
 * would be, never accumulates enough support to count), then each band is
 * read in full, top-to-bottom, before the next — the same (y, x) rule as
 * before, just applied within a column rather than across the whole page
 * width. A page with no recurring gutter (the common single-column case)
 * has exactly one band and produces byte-identical output to the
 * pre-column-detection algorithm.
 *
 * Disclosed limitation: this reads column-major (all of column 1, then all
 * of column 2), not row-major — it stops unrelated columns' words from
 * being glued into one nonsense line, which was the reported failure, but
 * it does not reconstruct a table's own row structure. A fact that spans
 * cells in the same row across columns can still misground. Genuine table
 * extraction is a materially larger feature this pass doesn't attempt.
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
/** A gap this wide within one visual line is far beyond any ordinary inter-word space — a candidate column gutter, not a wide space, subject to `confirmedGutterXs`' own recurring-across-lines check before it's trusted. */
const COLUMN_GAP_THRESHOLD = 24;
/** Candidate gutter x-midpoints from different lines within this of each other are the same real gutter, not two coincidentally-close ones — generous enough for ordinary jitter between rows' own run boundaries, well under `COLUMN_GAP_THRESHOLD` so it can never itself merge two genuinely distinct gutters. */
const GUTTER_CLUSTER_TOLERANCE = 6;
/** A candidate gutter needs at least this many distinct lines agreeing on roughly the same x before it's trusted as a real column boundary — one line's own one-off wide gap (a table's own cell padding, trailing whitespace before a full-width heading ends) never reaches this alone. */
const MIN_GUTTER_SUPPORT = 2;

interface Run {
  x: number;
  xEnd: number;
  y: number;
  str: string;
}

function toRuns(items: readonly unknown[]): Run[] {
  return items
    .filter(isRawTextItem)
    .filter((item) => item.str.trim() !== '')
    .map((item) => {
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      // No per-run width is tracked by `RawTextItem` — the same
      // character-count approximation the original algorithm already used,
      // good enough to decide "is there a gap" (both within a line and,
      // now, between columns), not to measure one precisely.
      return { x, xEnd: x + item.str.length, y, str: item.str };
    });
}

/** y-proximity grouping (`Y_EPSILON`-tolerant, since two runs on the same visual line are rarely at *exactly* the same baseline), each line's own runs left-to-right sorted — the page-wide, column-blind version of "(y, x)" every band below is built from. */
function groupIntoLines(runs: readonly Run[]): { y: number; runs: Run[] }[] {
  const lines: { y: number; runs: Run[] }[] = [];
  for (const run of runs) {
    const line = lines.find((l) => Math.abs(l.y - run.y) <= Y_EPSILON);
    if (line) line.runs.push(run);
    else lines.push({ y: run.y, runs: [run] });
  }
  for (const line of lines) line.runs.sort((a, b) => a.x - b.x);
  return lines;
}

/** Every candidate gutter midpoint within one already-x-sorted line. */
function gutterMidpointsInLine(sortedRuns: readonly Run[]): number[] {
  const midpoints: number[] = [];
  for (let i = 1; i < sortedRuns.length; i++) {
    const prev = sortedRuns[i - 1];
    const curr = sortedRuns[i];
    if (prev === undefined || curr === undefined) continue;
    if (curr.x - prev.xEnd >= COLUMN_GAP_THRESHOLD) midpoints.push((prev.xEnd + curr.x) / 2);
  }
  return midpoints;
}

/** Clusters candidate gutter midpoints from across every line on the page and keeps only the ones enough distinct lines agree on — see this module's own top comment for why that's what tells a real column gutter apart from a one-off wide gap. */
function confirmedGutterXs(allMidpoints: readonly number[]): number[] {
  const sorted = [...allMidpoints].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const x of sorted) {
    const last = clusters[clusters.length - 1];
    const lastX = last?.[last.length - 1];
    if (last && lastX !== undefined && x - lastX <= GUTTER_CLUSTER_TOLERANCE) last.push(x);
    else clusters.push([x]);
  }
  return clusters.filter((c) => c.length >= MIN_GUTTER_SUPPORT).map((c) => c.reduce((sum, x) => sum + x, 0) / c.length);
}

/** Which column band (0-indexed, left to right) an x-position falls in, given ascending confirmed gutter x-positions. */
function bandIndexFor(x: number, gutters: readonly number[]): number {
  let index = 0;
  for (const gutter of gutters) {
    if (x >= gutter) index++;
    else break;
  }
  return index;
}

function joinLine(sortedRuns: readonly Run[]): string {
  let text = '';
  let previousEndX: number | null = null;
  for (const run of sortedRuns) {
    // pdfjs splits a line into several runs on any font/style change, not
    // only at real word boundaries — inserting one extra space where two
    // runs already abut costs nothing once `ground.ts`'s own whitespace-
    // normalised search band is available; silently gluing two words
    // together would cost a fact.
    if (previousEndX !== null && run.x - previousEndX > X_GAP_FOR_SPACE && !text.endsWith(' ') && !run.str.startsWith(' ')) {
      text += ' ';
    }
    text += run.str;
    previousEndX = run.xEnd;
  }
  return text;
}

/** §5.1's own "(y, x) with a line-join heuristic," column-aware — see this module's own top comment for the shape (band the page by recurring gutters, then read each band's own lines top-to-bottom left-to-right, band by band left to right). */
function pageTextFromItems(items: readonly unknown[]): string {
  const lines = groupIntoLines(toRuns(items));
  const gutters = confirmedGutterXs(lines.flatMap((line) => gutterMidpointsInLine(line.runs)));

  // The common single-column case: one band, holding every line unchanged
  // — byte-identical to the pre-column-detection algorithm's own output.
  const bands: { y: number; runs: Run[] }[][] = gutters.length === 0 ? [lines] : Array.from({ length: gutters.length + 1 }, () => []);
  if (gutters.length > 0) {
    for (const line of lines) {
      // A line can itself straddle a gutter (a wide multi-column row) — its
      // own runs are split by band before being regrouped, so two runs
      // sharing a y are never joined onto one output line just because
      // they're at the same visual height, once they're known to be in
      // different columns.
      const runsByBand = new Map<number, Run[]>();
      for (const run of line.runs) {
        const band = bandIndexFor(run.x, gutters);
        const list = runsByBand.get(band);
        if (list) list.push(run);
        else runsByBand.set(band, [run]);
      }
      for (const [band, runsInBand] of runsByBand) {
        const target = bands[band];
        target?.push({ y: line.y, runs: runsInBand });
      }
    }
  }

  return bands
    .map((bandLines) => {
      const sorted = [...bandLines].sort((a, b) => b.y - a.y);
      return sorted.map((line) => joinLine(line.runs)).join('\n');
    })
    .filter((columnText) => columnText !== '')
    .join('\n\n');
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
