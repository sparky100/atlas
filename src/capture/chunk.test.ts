import { describe, expect, it } from 'vitest';
import { chunkPastedText, chunkPdfPages } from './chunk';

describe('chunkPdfPages', () => {
  it('puts every page in one chunk when the total is under the cap', () => {
    const pages = [
      { page: 1, text: 'a'.repeat(100) },
      { page: 2, text: 'b'.repeat(100) },
    ];
    const chunks = chunkPdfPages(pages, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ firstPage: 1, lastPage: 2, totalPages: 2 });
    expect(chunks[0]?.text).toBe(`${'a'.repeat(100)}\n\n${'b'.repeat(100)}`);
  });

  it('never splits a single page, even one longer than the cap', () => {
    const pages = [{ page: 1, text: 'x'.repeat(50) }];
    const chunks = chunkPdfPages(pages, 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toHaveLength(50);
  });

  it('starts a new chunk once the next page would push it over the cap', () => {
    const pages = [
      { page: 1, text: 'a'.repeat(60) },
      { page: 2, text: 'b'.repeat(60) },
      { page: 3, text: 'c'.repeat(10) },
    ];
    const chunks = chunkPdfPages(pages, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ firstPage: 1, lastPage: 1 });
    expect(chunks[1]).toMatchObject({ firstPage: 2, lastPage: 3 });
  });

  it('reports each page\'s own offset range within the chunk text, translatable back to a page-local offset', () => {
    const pages = [
      { page: 5, text: 'hello' },
      { page: 6, text: 'world' },
    ];
    const [chunk] = chunkPdfPages(pages, 1000);
    expect(chunk?.pageRanges).toEqual([
      { page: 5, start: 0, end: 5 },
      { page: 6, start: 7, end: 12 },
    ]);
    expect(chunk?.text.slice(7, 12)).toBe('world');
  });
});

describe('chunkPastedText', () => {
  it('returns one chunk for text under the cap', () => {
    const text = 'A short pasted note.';
    const chunks = chunkPastedText(text, 1000);
    expect(chunks).toEqual([{ text, start: 0, end: text.length, total: text.length }]);
  });

  it('splits at paragraph boundaries once the text exceeds the cap', () => {
    const para1 = 'a'.repeat(60);
    const para2 = 'b'.repeat(60);
    const para3 = 'c'.repeat(10);
    const text = [para1, para2, para3].join('\n\n');
    const chunks = chunkPastedText(text, 100);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe(para1);
    expect(chunks[1]?.text).toBe(`${para2}\n\n${para3}`);
    // offsets are into the original text.
    expect(text.slice(chunks[1]?.start, chunks[1]?.end)).toBe(chunks[1]?.text);
  });

  it('never splits a single paragraph, even one longer than the cap', () => {
    const text = 'x'.repeat(200);
    const chunks = chunkPastedText(text, 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toHaveLength(200);
  });
});
