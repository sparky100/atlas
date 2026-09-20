import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { NO_TEXT_THRESHOLD, PdfParseError, pageHasNoText, parsePdf } from './pdf';

async function buildPdf(pages: readonly { lines?: readonly string[]; twoColumn?: readonly [string, string] }[]): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage([400, 600]);
    page.setFont(font);
    if (spec.lines) {
      let y = 550;
      for (const line of spec.lines) {
        page.drawText(line, { x: 50, y, size: 12 });
        y -= 20;
      }
    }
    if (spec.twoColumn) {
      const [left, right] = spec.twoColumn;
      // Two runs on the same visual line, left column first in the content stream — reading order must still put the left column's own text before the right's.
      page.drawText(right, { x: 250, y: 550, size: 12 });
      page.drawText(left, { x: 50, y: 550, size: 12 });
    }
  }
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('parsePdf', () => {
  it('extracts each page\'s own text, one page object per page, 1-indexed', async () => {
    const bytes = await buildPdf([{ lines: ['Page one line one.', 'Page one line two.'] }, { lines: ['Page two says hello.'] }]);
    const result = await parsePdf(bytes);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.page).toBe(1);
    expect(result.pages[0]?.text).toBe('Page one line one.\nPage one line two.');
    expect(result.pages[1]?.page).toBe(2);
    expect(result.pages[1]?.text).toBe('Page two says hello.');
  });

  it('flags a page with no meaningful text as pageHasNoText (NO_TEXT_LAYER candidate)', async () => {
    const bytes = await buildPdf([{ lines: [] }]);
    const result = await parsePdf(bytes);
    const page = result.pages[0];
    if (page === undefined) throw new Error('expected one page');
    expect(pageHasNoText(page)).toBe(true);
    expect(page.nonWhitespaceCharCount).toBeLessThan(NO_TEXT_THRESHOLD);
  });

  it('does not flag a page with real text as having no text layer', async () => {
    const bytes = await buildPdf([{ lines: ['This page has plenty of readable text on it.'] }]);
    const result = await parsePdf(bytes);
    const page = result.pages[0];
    if (page === undefined) throw new Error('expected one page');
    expect(pageHasNoText(page)).toBe(false);
  });

  it('reads left-to-right within a line regardless of the order text runs were drawn in', async () => {
    const bytes = await buildPdf([{ twoColumn: ['Left column text', 'Right column text'] }]);
    const result = await parsePdf(bytes);
    const page = result.pages[0];
    if (page === undefined) throw new Error('expected one page');
    const leftIndex = page.text.indexOf('Left column text');
    const rightIndex = page.text.indexOf('Right column text');
    expect(leftIndex).toBeGreaterThanOrEqual(0);
    expect(rightIndex).toBeGreaterThan(leftIndex);
  });

  it('throws PdfParseError for bytes that are not a real PDF', async () => {
    const garbage = new TextEncoder().encode('this is not a pdf').buffer;
    await expect(parsePdf(garbage)).rejects.toBeInstanceOf(PdfParseError);
  });
});
