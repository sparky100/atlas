import { describe, expect, it } from 'vitest';
import { answerBlocks } from './answerBlocks';

const ID = '00000000-0000-4000-8000-000000000010';

describe('answerBlocks', () => {
  it('splits paragraphs and bullet lines and pulls citations out of the text', () => {
    const blocks = answerBlocks(`Two systems matter.\n\n- CRM [[element:${ID}]] is critical\n- Nothing else`);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'item', 'item']);
    expect(blocks[1]?.parts).toEqual([{ kind: 'text', text: 'CRM ' }, { kind: 'citation', id: ID }, { kind: 'text', text: ' is critical' }]);
  });

  it('keeps anything that looks like HTML or a link as plain text', () => {
    const [block] = answerBlocks('<img src=x onerror=alert(1)> [click](https://evil.test)');
    expect(block?.parts).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)> [click](https://evil.test)' }]);
  });

  it('does not turn a malformed citation into a link', () => {
    const [block] = answerBlocks('See [[element:not-an-id]].');
    expect(block?.parts.every((p) => p.kind === 'text')).toBe(true);
  });

  it('returns nothing for an empty answer', () => {
    expect(answerBlocks('  ')).toEqual([]);
  });
});
