/**
 * ADR-028 §5: turns the assistant's answer into blocks of plain text and
 * verified citations. The text is only ever rendered as text, never as HTML
 * or as a link the model wrote, so the only links on the page are the
 * element links this builds from ids the server has already checked.
 */
export type AnswerPart = { kind: 'text'; text: string } | { kind: 'citation'; id: string };
export interface AnswerBlock {
  kind: 'paragraph' | 'item';
  parts: AnswerPart[];
}

const CITATION = /\[\[element:([0-9a-f-]{36})\]\]/g;

function partsOf(line: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of line.matchAll(CITATION)) {
    const index = match.index;
    if (index > last) parts.push({ kind: 'text', text: line.slice(last, index) });
    parts.push({ kind: 'citation', id: match[1] ?? '' });
    last = index + match[0].length;
  }
  if (last < line.length) parts.push({ kind: 'text', text: line.slice(last) });
  return parts;
}

export function answerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const paragraph of answer.split(/\n\s*\n/)) {
    const lines = paragraph.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    let current: string[] = [];
    const flush = () => {
      if (current.length > 0) blocks.push({ kind: 'paragraph', parts: partsOf(current.join(' ').trim()) });
      current = [];
    };
    for (const line of lines) {
      const item = /^\s*[-*]\s+(.*)$/.exec(line);
      if (item) {
        flush();
        blocks.push({ kind: 'item', parts: partsOf(item[1] ?? '') });
      } else {
        current.push(line.trim());
      }
    }
    flush();
  }
  return blocks;
}
