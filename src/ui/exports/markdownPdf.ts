/**
 * F13 step 2: the project pack's PDF — the same Markdown the .md download
 * holds, laid out as A4 pages, so the two formats can never disagree.
 *
 * Handles only what the pack's own builders emit (`projectPack.ts`,
 * `exportDecisionAsAdr.ts`): `#`–`######` headings, `- ` bullets (two-space
 * indents nest), `**bold**` runs, `<url>` autolinks and plain paragraphs.
 * The layout is pure (`layoutMarkdown`, text measured through a callback)
 * so it is unit-testable; `markdownToPdfBytes` draws it with `pdf-lib`,
 * loaded only when a PDF is asked for.
 *
 * The PDF uses the standard Helvetica font, which covers Western European
 * text (Windows-1252). Anything outside that set is replaced — arrows and
 * comparison signs with ASCII look-alikes, anything else with "?" — and
 * the .md download keeps every character as written.
 */

export interface TextRun {
  text: string;
  bold: boolean;
}

export interface PlacedText {
  x: number;
  /** Baseline, measured from the top of the page. */
  y: number;
  text: string;
  bold: boolean;
  size: number;
}

export type MeasureText = (text: string, bold: boolean, size: number) => number;

export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
  /** Space kept clear at the bottom for the footer. */
  footer: number;
}

export const A4: PageGeometry = { width: 595.28, height: 841.89, margin: 56, footer: 24 };

const BODY_SIZE = 10.5;
const HEADING_SIZES = [20, 15, 12.5, 11, 11, 11];
const LINE_HEIGHT = 1.4;
const BULLET_INDENT = 14;

/** `**bold**` runs and `<url>` autolinks split into plain runs. */
export function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const unlinked = text.replace(/<(https?:\/\/[^>\s]+)>/gi, '$1');
  const parts = unlinked.split('**');
  parts.forEach((part, i) => {
    if (part.length > 0) runs.push({ text: part, bold: i % 2 === 1 });
  });
  return runs;
}

interface Word {
  text: string;
  bold: boolean;
  /** Whether a space precedes this word on the same line. */
  spaced: boolean;
}

function words(runs: readonly TextRun[]): Word[] {
  const out: Word[] = [];
  let pendingSpace = false;
  for (const run of runs) {
    const tokens = run.text.split(/(\s+)/);
    for (const token of tokens) {
      if (token.length === 0) continue;
      if (/^\s+$/.test(token)) {
        pendingSpace = true;
        continue;
      }
      out.push({ text: token, bold: run.bold, spaced: pendingSpace && out.length > 0 });
      pendingSpace = false;
    }
  }
  return out;
}

/** Breaks one over-long word (a URL, say) into pieces no wider than `maxWidth`. */
function splitLongWord(word: Word, maxWidth: number, size: number, measure: MeasureText): Word[] {
  if (measure(word.text, word.bold, size) <= maxWidth) return [word];
  const pieces: Word[] = [];
  let current = '';
  for (const ch of word.text) {
    if (current.length > 0 && measure(current + ch, word.bold, size) > maxWidth) {
      pieces.push({ text: current, bold: word.bold, spaced: pieces.length === 0 ? word.spaced : false });
      current = '';
    }
    current += ch;
  }
  if (current.length > 0) pieces.push({ text: current, bold: word.bold, spaced: pieces.length === 0 ? word.spaced : false });
  return pieces;
}

/** Wraps runs into lines of placed pieces, each piece a same-weight stretch of text. */
function wrap(runs: readonly TextRun[], maxWidth: number, size: number, measure: MeasureText): { text: string; bold: boolean; x: number }[][] {
  const lines: { text: string; bold: boolean; x: number }[][] = [];
  let line: { text: string; bold: boolean; x: number }[] = [];
  let x = 0;
  const space = (bold: boolean) => measure(' ', bold, size);
  for (const original of words(runs)) {
    for (const word of splitLongWord(original, maxWidth, size, measure)) {
      const lead = word.spaced && line.length > 0 ? space(word.bold) : 0;
      const w = measure(word.text, word.bold, size);
      if (line.length > 0 && x + lead + w > maxWidth) {
        lines.push(line);
        line = [];
        x = 0;
      }
      const effectiveLead = line.length > 0 ? lead : 0;
      const last = line[line.length - 1];
      if (last?.bold === word.bold) {
        last.text += (effectiveLead > 0 ? ' ' : '') + word.text;
      } else {
        line.push({ text: word.text, bold: word.bold, x: x + effectiveLead });
      }
      x += effectiveLead + w;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

/** Lays the Markdown out as pages of placed text. Always at least one page. */
export function layoutMarkdown(markdown: string, measure: MeasureText, page: PageGeometry = A4): PlacedText[][] {
  const pages: PlacedText[][] = [[]];
  const contentWidth = page.width - 2 * page.margin;
  const bottom = page.height - page.margin - page.footer;
  let y = page.margin;

  const current = () => pages[pages.length - 1] ?? [];
  const ensureRoom = (height: number) => {
    if (y + height > bottom && current().length > 0) {
      pages.push([]);
      y = page.margin;
    }
  };
  const block = (runs: TextRun[], size: number, indent: number, bullet: boolean, spaceBefore: number) => {
    const lineHeight = size * LINE_HEIGHT;
    const lines = wrap(runs, contentWidth - indent, size, measure);
    if (current().length > 0) y += spaceBefore;
    lines.forEach((pieces, i) => {
      ensureRoom(lineHeight);
      const baseline = y + size;
      if (bullet && i === 0) current().push({ x: page.margin + indent - 10, y: baseline, text: '•', bold: false, size });
      for (const piece of pieces) current().push({ x: page.margin + indent + piece.x, y: baseline, text: piece.text, bold: piece.bold, size });
      y += lineHeight;
    });
  };

  type Block = { kind: 'heading'; level: number; text: string } | { kind: 'bullet'; depth: number; text: string } | { kind: 'paragraph'; text: string } | { kind: 'blank' };
  const blocks: Block[] = markdown.split('\n').map((raw): Block => {
    const line = raw.replace(/\s+$/, '');
    if (line.length === 0) return { kind: 'blank' };
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) return { kind: 'heading', level: heading[1].length, text: heading[2].replace(/\*\*/g, '') };
    const bullet = /^(\s*)- (.*)$/.exec(line);
    if (bullet?.[1] !== undefined && bullet[2] !== undefined) return { kind: 'bullet', depth: Math.floor(bullet[1].length / 2), text: bullet[2] };
    return { kind: 'paragraph', text: line };
  });
  const headingHeight = (level: number) => {
    const size = HEADING_SIZES[level - 1] ?? BODY_SIZE;
    return size * 0.9 + size * LINE_HEIGHT;
  };
  /** A heading keeps with what follows it: any headings straight after it, then three lines of body text. */
  const keepWithNext = (index: number) => {
    let height = 0;
    for (let i = index; i < blocks.length; i++) {
      const b = blocks[i];
      if (!b || b.kind === 'blank') continue;
      if (b.kind !== 'heading') break;
      height += headingHeight(b.level);
    }
    return height + BODY_SIZE * LINE_HEIGHT * 3;
  };

  let previousWasBullet = false;
  blocks.forEach((b, i) => {
    if (b.kind === 'blank') {
      previousWasBullet = false;
      return;
    }
    if (b.kind === 'heading') {
      const size = HEADING_SIZES[b.level - 1] ?? BODY_SIZE;
      ensureRoom(keepWithNext(i));
      block([{ text: b.text, bold: true }], size, 0, false, size * 0.9);
      previousWasBullet = false;
      return;
    }
    if (b.kind === 'bullet') {
      block(parseInline(b.text), BODY_SIZE, BULLET_INDENT * (b.depth + 1), true, previousWasBullet ? 1 : BODY_SIZE * 0.5);
      previousWasBullet = true;
      return;
    }
    block(parseInline(b.text), BODY_SIZE, 0, false, BODY_SIZE * 0.5);
    previousWasBullet = false;
  });
  return pages;
}

const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const LOOKALIKES: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≥': '>=', '≤': '<=', '≠': '!=', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', ' ': ' ', '\t': ' ' };

/** Text the standard PDF fonts can draw: Windows-1252 kept, look-alikes for arrows and signs, "?" for anything else. */
export function toWinAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (LOOKALIKES[ch] !== undefined) out += LOOKALIKES[ch];
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

/** The Markdown as PDF bytes: A4 pages, a footer naming the document and the page, and the title as the PDF's own title. */
export async function markdownToPdfBytes(markdown: string, title: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsi(title));
  pdf.setCreator('Atlas');
  const [regular, bold] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.HelveticaBold)]);
  const measure: MeasureText = (text, isBold, size) => (isBold ? bold : regular).widthOfTextAtSize(toWinAnsi(text), size);
  const pages = layoutMarkdown(markdown, measure, A4);
  const ink = rgb(0.08, 0.09, 0.12);
  const muted = rgb(0.36, 0.39, 0.45);
  pages.forEach((placed, i) => {
    const page = pdf.addPage([A4.width, A4.height]);
    for (const t of placed) page.drawText(toWinAnsi(t.text), { x: t.x, y: A4.height - t.y, size: t.size, font: t.bold ? bold : regular, color: ink });
    const footer = toWinAnsi(`${title.length > 80 ? `${title.slice(0, 79)}…` : title} · page ${String(i + 1)} of ${String(pages.length)}`);
    page.drawText(footer, { x: A4.margin, y: A4.margin / 2, size: 8, font: regular, color: muted});
  });
  return pdf.save();
}
