/**
 * Reads the decision write-up (the markdown a pack freezes) into blocks a page
 * can show as a document: a title, facts, headed sections, bullets with detail
 * under them, and plain paragraphs. It only understands the shapes
 * `exportDecisionAsAdrMarkdown` writes, and anything else becomes a paragraph,
 * so an older pack still reads. Pure: nothing is rendered as HTML, the page
 * builds elements from these pieces.
 */
export interface InlinePart {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type PackBlock =
  | { kind: 'title'; parts: InlinePart[] }
  | { kind: 'facts'; facts: { label: string; parts: InlinePart[] }[] }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; parts: InlinePart[] }
  | { kind: 'list'; items: { parts: InlinePart[]; details: InlinePart[][] }[] };

/** `**bold**` and a whole-line `*italic*`; everything else is plain text. */
export function inlineParts(text: string): InlinePart[] {
  const whole = /^\*([^*].*[^*]|[^*])\*$/.exec(text.trim());
  if (whole?.[1] !== undefined) return [{ text: whole[1], bold: false, italic: true }];
  const parts: InlinePart[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false, italic: false });
    parts.push({ text: m[1] ?? '', bold: true, italic: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false, italic: false });
  return parts.length > 0 ? parts : [{ text, bold: false, italic: false }];
}

const FACT = /^\*\*([^*]+):\*\*\s*(.*)$/;

export function parsePackDocument(markdown: string): PackBlock[] {
  const blocks: PackBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', parts: inlineParts(paragraph.join(' ')) });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (line.startsWith('# ')) {
      flushParagraph();
      blocks.push({ kind: 'title', parts: inlineParts(line.slice(2).replace(/^ADR:\s*/, '')) });
    } else if (line.startsWith('## ')) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: line.slice(3) });
    } else if (/^ {2,}- /.test(line) && last?.kind === 'list' && paragraph.length === 0) {
      const item = last.items[last.items.length - 1];
      if (item) item.details.push(inlineParts(line.replace(/^\s+- /, '')));
      else last.items.push({ parts: inlineParts(line.replace(/^\s+- /, '')), details: [] });
    } else if (line.startsWith('- ')) {
      flushParagraph();
      const item = { parts: inlineParts(line.slice(2)), details: [] as InlinePart[][] };
      if (last?.kind === 'list') last.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
    } else if (FACT.test(line) && paragraph.length === 0) {
      const m = FACT.exec(line);
      const fact = { label: m?.[1] ?? '', parts: inlineParts(m?.[2] ?? '') };
      if (last?.kind === 'facts') last.facts.push(fact);
      else blocks.push({ kind: 'facts', facts: [fact] });
    } else {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  return blocks;
}
