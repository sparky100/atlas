import { describe, expect, it } from 'vitest';
import { layoutMarkdown, parseInline, toWinAnsi, type MeasureText, type PageGeometry } from './markdownPdf';

/** Every character 0.5em wide — enough to test wrapping without a font. */
const measure: MeasureText = (text, _bold, size) => [...text].length * size * 0.5;
const SMALL: PageGeometry = { width: 200, height: 200, margin: 20, footer: 10 };

describe('parseInline', () => {
  it('splits bold runs and unwraps autolinks', () => {
    expect(parseInline('**Status:** Active, see <https://example.org>')).toEqual([
      { text: 'Status:', bold: true },
      { text: ' Active, see https://example.org', bold: false },
    ]);
  });
});

describe('layoutMarkdown (F13 step 2)', () => {
  it('draws headings bold and larger, bullets with a bullet mark, and drops the Markdown markers', () => {
    const [page] = layoutMarkdown('# Title\n\n- **Item** one\n\nPlain text', measure);
    const texts = (page ?? []).map((t) => t.text);
    expect(texts).toEqual(['Title', '•', 'Item', 'one', 'Plain text']);
    const title = page?.[0];
    expect(title?.bold).toBe(true);
    expect(title?.size).toBeGreaterThan(page?.[4]?.size ?? 0);
    expect(page?.[2]?.bold).toBe(true);
    expect(page?.[3]?.bold).toBe(false);
  });

  it('wraps a long paragraph inside the margins', () => {
    const pages = layoutMarkdown('word '.repeat(40).trim(), measure, SMALL);
    const lines = pages.flat();
    expect(lines.length).toBeGreaterThan(1);
    for (const t of lines) expect(t.x + measure(t.text, t.bold, t.size)).toBeLessThanOrEqual(SMALL.width - SMALL.margin + 0.001);
  });

  it('breaks a word wider than the page rather than running off it', () => {
    const lines = layoutMarkdown('x'.repeat(80), measure, SMALL).flat();
    expect(lines.map((t) => t.text).join('')).toBe('x'.repeat(80));
    for (const t of lines) expect(measure(t.text, t.bold, t.size)).toBeLessThanOrEqual(SMALL.width - 2 * SMALL.margin);
  });

  it('starts a new page when the text runs past the bottom, losing nothing', () => {
    const markdown = Array.from({ length: 30 }, (_, i) => `Line ${String(i)}`).join('\n\n');
    const pages = layoutMarkdown(markdown, measure, SMALL);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().map((t) => t.text)).toEqual(Array.from({ length: 30 }, (_, i) => `Line ${String(i)}`));
    for (const page of pages) for (const t of page) expect(t.y).toBeLessThanOrEqual(SMALL.height - SMALL.margin - SMALL.footer);
  });

  it('never leaves a heading alone at the foot of a page', () => {
    // A section heading straight after a sub-heading — the case that once left the section heading alone at a page foot.
    const filler = Array.from({ length: 3 }, (_, i) => `Line ${String(i)}`).join('\n\n');
    const pages = layoutMarkdown(`${filler}\n\n## Next section\n\n### Sub-heading\n\nBody`, measure, SMALL);
    const headingPage = pages.findIndex((p) => p.some((t) => t.text === 'Next section'));
    const subPage = pages.findIndex((p) => p.some((t) => t.text === 'Sub-heading'));
    const bodyPage = pages.findIndex((p) => p.some((t) => t.text === 'Body'));
    expect(pages.length).toBeGreaterThan(1);
    expect(headingPage).toBe(subPage);
    expect(subPage).toBe(bodyPage);
  });

  it('always returns at least one page', () => {
    expect(layoutMarkdown('', measure)).toEqual([[]]);
  });
});

describe('toWinAnsi', () => {
  it('keeps Western European text, swaps arrows for look-alikes and anything else for "?"', () => {
    expect(toWinAnsi('Café — “quoted” · £5 €')).toBe('Café — “quoted” · £5 €');
    expect(toWinAnsi('vendor → Acme ≥ 2')).toBe('vendor -> Acme >= 2');
    expect(toWinAnsi('東京')).toBe('??');
  });
});
