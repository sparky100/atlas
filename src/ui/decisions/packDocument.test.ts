import { describe, expect, it } from 'vitest';
import { inlineParts, parsePackDocument } from './packDocument';

const SAMPLE = `# ADR: Same-day quotes

**Status:** Accepted — decided 2026-11-20
**Result:** Chose Configure the tool

## Context

Quotes take two days.
We want the same day.

*AI helped with this: Drafted by the Designer.*

## Options considered

- **Configure the tool** — chosen
  - About: Use what we have.
  - Fit: Good — fits the steps
- Replace — cancelled

## Decision

Chosen option: **Configure the tool**.
`;

describe('parsePackDocument', () => {
  const blocks = parsePackDocument(SAMPLE);
  it('puts the title first, without the ADR prefix', () => {
    expect(blocks[0]).toEqual({ kind: 'title', parts: [{ text: 'Same-day quotes', bold: false, italic: false }] });
  });
  it('reads status and outcome as facts', () => {
    const facts = blocks[1];
    expect(facts?.kind).toBe('facts');
    expect(facts?.kind === 'facts' && facts.facts.map((f) => f.label)).toEqual(['Status', 'Result']);
  });
  it('joins wrapped lines into one paragraph and keeps the AI line as italics', () => {
    const paragraph = blocks.find((b) => b.kind === 'paragraph');
    expect(paragraph?.kind === 'paragraph' && paragraph.parts[0]?.text).toBe('Quotes take two days. We want the same day.');
    expect(blocks.some((b) => b.kind === 'paragraph' && b.parts[0]?.italic === true)).toBe(true);
  });
  it('keeps detail lines under their option', () => {
    const list = blocks.find((b) => b.kind === 'list');
    expect(list?.kind === 'list' && list.items).toHaveLength(2);
    expect(list?.kind === 'list' && list.items[0]?.details).toHaveLength(2);
    expect(list?.kind === 'list' && list.items[0]?.parts[0]).toEqual({ text: 'Configure the tool', bold: true, italic: false });
  });
  it('shows every heading in order', () => {
    expect(blocks.flatMap((b) => (b.kind === 'heading' ? [b.text] : []))).toEqual(['Context', 'Options considered', 'Decision']);
  });
  it('reads an older pack, or anything unexpected, as plain paragraphs and never throws', () => {
    expect(parsePackDocument('just some words')).toEqual([{ kind: 'paragraph', parts: [{ text: 'just some words', bold: false, italic: false }] }]);
    expect(parsePackDocument('')).toEqual([]);
    expect(() => parsePackDocument('**broken\n- \n  - ')).not.toThrow();
  });
  it('never turns text into markup', () => {
    expect(inlineParts('<script>alert(1)</script>')[0]?.text).toBe('<script>alert(1)</script>');
  });
});
