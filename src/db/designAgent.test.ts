import { describe, expect, it } from 'vitest';
import { citationIds, citationsToNames, DesignerError, interpretDesignerReply } from './designAgent';

describe('interpretDesignerReply', () => {
  const design = { options: [{ title: 'Configure', summary: 'Use it as is.', toWeigh: 'Fit.' }, { title: 'Replace', summary: 'Buy one.' }], gaps: ['No owner recorded'], stayNote: 'Slow.', problems: [] };

  it('returns the options, the gaps and the names of what it cites', () => {
    const draft = interpretDesignerReply({ status: 'done', design, result: { answer: '{}', citations: ['a', 'b'], citationNames: { a: 'Quote Tool' }, grounded: true, inputTokens: 1200, outputTokens: 340, toolUses: [{}, {}, {}] } });
    expect(draft).toEqual({
      options: [{ title: 'Configure', summary: 'Use it as is.', toWeigh: 'Fit.', catalogueRefs: [] }, { title: 'Replace', summary: 'Buy one.', toWeigh: '', catalogueRefs: [] }],
      gaps: ['No owner recorded'],
      stayNote: 'Slow.',
      problems: [],
      citedNames: ['Quote Tool'],
      grounded: true,
      usage: { inputTokens: 1200, outputTokens: 340, lookups: 3 },
    });
  });

  it('reads missing or odd usage as zero rather than showing nonsense', () => {
    const draft = interpretDesignerReply({ status: 'done', design, result: { answer: 'x', inputTokens: -5, outputTokens: 'lots', toolUses: 'none' } });
    expect(draft.usage).toEqual({ inputTokens: 0, outputTokens: 0, lookups: 0 });
  });

  it('marks a draft with no verified citation as not grounded', () => {
    expect(interpretDesignerReply({ status: 'done', design, result: { answer: 'x', citations: [], citationNames: {}, grounded: false } }).grounded).toBe(false);
  });

  it('keeps the function\'s own reasons when an answer is incomplete, and invents one when there are none and no options', () => {
    const partial = interpretDesignerReply({ status: 'done', design: { options: [{ title: 'A', summary: 'a' }], problems: ['The Designer gave fewer options than expected.'] }, result: { answer: 'x' } });
    expect(partial.problems).toEqual(['The Designer gave fewer options than expected.']);
    expect(interpretDesignerReply({ status: 'done', design: { options: [] }, result: { answer: 'x' } }).problems).toEqual(['The Designer gave no usable options.']);
  });

  it('says the Designer is being updated when an older function returns only text', () => {
    expect(() => interpretDesignerReply({ status: 'done', result: { answer: 'prose' } })).toThrow(/being updated/);
  });

  it('says so plainly for an empty model and a missing model', () => {
    expect(() => interpretDesignerReply({ status: 'empty_model' })).toThrow(/no committed content/);
    expect(() => interpretDesignerReply({ status: 'not_found' })).toThrow(/could not be found/);
  });

  it("shows the function's own sentence for a refusal, and a plain fallback otherwise", () => {
    expect(() => interpretDesignerReply({ status: 'forbidden', message: 'Only an owner, architect or contributor can run the Designer.' })).toThrow('Only an owner, architect or contributor can run the Designer.');
    expect(() => interpretDesignerReply(null)).toThrow(DesignerError);
    expect(() => interpretDesignerReply({ status: 'error' })).toThrow(/could not be reached/);
  });
});

describe('citations become names, never ids', () => {
  const A = '486e1fef-f5d4-4635-a6fa-124d8c2852b0';
  const B = '22cddb73-6439-4b1f-ac7a-fe72b44364d8';
  it('replaces a cited id with its name, and an unknown id with plain words', () => {
    expect(citationsToNames(`Keep [[element:${A}]] for [[element:${B}]] and [[element:${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}]].`, { [A]: 'Quote Tool', [B]: 'Connection Quotations' })).toBe('Keep Quote Tool for Connection Quotations and an element in the model.');
  });
  it('lists each id a saved text still cites, once', () => {
    expect(citationIds(`Replace [[element:${A}]] and again [[element:${A}]], keep [[element:${B}]].`)).toEqual([A, B]);
    expect(citationIds('No citations here.')).toEqual([]);
  });
  it('the options, gaps and stay note a person edits carry names', () => {
    const draft = interpretDesignerReply({
      status: 'done',
      design: { options: [{ title: 'Keep', summary: `Keep [[element:${A}]].`, toWeigh: `Check [[element:${B}]].` }], gaps: [`No owner for [[element:${A}]]`], stayNote: `[[element:${A}]] stays poor.`, problems: [] },
      result: { answer: 'x', citations: [A, B], citationNames: { [A]: 'Quote Tool', [B]: 'Connection Quotations' }, grounded: true },
    });
    expect(draft.options[0]).toEqual({ title: 'Keep', summary: 'Keep Quote Tool.', toWeigh: 'Check Connection Quotations.', catalogueRefs: [] });
    expect(draft.gaps).toEqual(['No owner for Quote Tool']);
    expect(draft.stayNote).toBe('Quote Tool stays poor.');
  });
  it('carries only well-formed catalogue refs from the function', () => {
    const ref = { sector: 'electricity_network', version: 2, entryCode: 'crm-x' };
    const draft = interpretDesignerReply({
      status: 'done',
      design: { options: [{ title: 'Replace', summary: 'Buy.', catalogueRefs: [ref, { sector: '', version: 0, entryCode: '' }] }], gaps: [], stayNote: '', problems: [] },
      result: { answer: 'x' },
    });
    expect(draft.options[0]?.catalogueRefs).toEqual([ref]);
  });
});
