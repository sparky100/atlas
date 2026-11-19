import { describe, expect, it } from 'vitest';
import { DesignerError, interpretDesignerReply } from './designAgent';

describe('interpretDesignerReply', () => {
  it('returns the draft with the names of what it cites', () => {
    const draft = interpretDesignerReply({ status: 'done', result: { answer: ' 1. Stay as we are. ', citations: ['a', 'b'], citationNames: { a: 'Quote Tool' }, grounded: true, inputTokens: 1200, outputTokens: 340, toolUses: [{}, {}, {}] } });
    expect(draft).toEqual({ text: '1. Stay as we are.', citedNames: ['Quote Tool'], grounded: true, usage: { inputTokens: 1200, outputTokens: 340, lookups: 3 } });
  });

  it('reads missing or odd usage as zero rather than showing nonsense', () => {
    const draft = interpretDesignerReply({ status: 'done', result: { answer: 'x', inputTokens: -5, outputTokens: 'lots', toolUses: 'none' } });
    expect(draft.usage).toEqual({ inputTokens: 0, outputTokens: 0, lookups: 0 });
  });

  it('marks a draft with no verified citation as not grounded', () => {
    expect(interpretDesignerReply({ status: 'done', result: { answer: 'x', citations: [], citationNames: {}, grounded: false } }).grounded).toBe(false);
  });

  it('says so plainly for an empty draft, an empty model and a missing model', () => {
    expect(() => interpretDesignerReply({ status: 'done', result: { answer: '  ' } })).toThrow(/no draft/);
    expect(() => interpretDesignerReply({ status: 'empty_model' })).toThrow(/no committed content/);
    expect(() => interpretDesignerReply({ status: 'not_found' })).toThrow(/could not be found/);
  });

  it("shows the function's own sentence for a refusal, and a plain fallback otherwise", () => {
    expect(() => interpretDesignerReply({ status: 'forbidden', message: 'Only an owner or architect can run the Designer.' })).toThrow('Only an owner or architect can run the Designer.');
    expect(() => interpretDesignerReply(null)).toThrow(DesignerError);
    expect(() => interpretDesignerReply({ status: 'error' })).toThrow(/could not be reached/);
  });
});
