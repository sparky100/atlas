import { describe, expect, it } from 'vitest';
import type { AskEvent } from '../tools/askLoop';
import { citationIds, citationsToNames, DesignerError, interpretDesignerReply, parseDesignerLine, runDesigner } from './designAgent';

describe('interpretDesignerReply', () => {
  const design = { options: [{ title: 'Configure', summary: 'Use it as is.', toWeigh: 'Fit.' }, { title: 'Replace', summary: 'Buy one.' }], gaps: ['No owner recorded'], stayNote: 'Slow.', problems: [] };

  it('returns the options, the gaps and the names of what it cites', () => {
    const draft = interpretDesignerReply({ status: 'done', design, result: { answer: '{}', citations: ['a', 'b'], citationNames: { a: 'Quote Tool' }, grounded: true, inputTokens: 1200, outputTokens: 340, toolUses: [{}, {}, {}] } });
    expect(draft).toEqual({
      options: [{ title: 'Configure', approach: 'configure', summary: 'Use it as is.', toWeigh: 'Fit.', catalogueRefs: [], catalogueProducts: [], webRefs: [] }, { title: 'Replace', approach: 'buy', summary: 'Buy one.', toWeigh: '', catalogueRefs: [], catalogueProducts: [], webRefs: [] }],
      gaps: ['No owner recorded'],
      stayNote: 'Slow.',
      problems: [],
      citedNames: ['Quote Tool'],
      grounded: true,
      usage: { inputTokens: 1200, outputTokens: 340, lookups: 3, webSearches: 0 },
    });
  });

  it('reads missing or odd usage as zero rather than showing nonsense', () => {
    const draft = interpretDesignerReply({ status: 'done', design, result: { answer: 'x', inputTokens: -5, outputTokens: 'lots', toolUses: 'none' } });
    expect(draft.usage).toEqual({ inputTokens: 0, outputTokens: 0, lookups: 0, webSearches: 0 });
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

describe('parseDesignerLine', () => {
  it('reads progress, the result and an error, and ignores anything else', () => {
    expect(parseDesignerLine('{"type":"event","event":{"type":"tool_call","name":"get_element"}}')).toEqual({ type: 'event', event: { type: 'tool_call', name: 'get_element' } });
    expect(parseDesignerLine('{"type":"result","status":"done"}')).toEqual({ type: 'result', outcome: { status: 'done' } });
    expect(parseDesignerLine('{"type":"error","code":"rate_limited","message":"Slow down."}')).toEqual({ type: 'error', code: 'rate_limited', message: 'Slow down.' });
    expect(parseDesignerLine('not json')).toBeNull();
    expect(parseDesignerLine('')).toBeNull();
  });
});

describe('runDesigner', () => {
  const input = {
    functionUrl: 'https://x.test/functions/v1/design-agent',
    accessToken: 't',
    modelId: '00000000-0000-4000-8000-000000000001',
    elementId: '00000000-0000-4000-8000-000000000002',
    finding: 'Quotes take two days.',
  };
  const done = {
    type: 'result',
    status: 'done',
    stamp: { modelId: '00000000-0000-4000-8000-000000000001', modelName: 'Estate', ref: 'main', commitId: '00000000-0000-4000-8000-000000000003' },
    design: { options: [{ title: 'Replace', summary: 'Buy one.' }], gaps: [], stayNote: '', problems: [] },
    result: { status: 'answered', answer: '{}', citations: [], citationNames: {}, grounded: false, unverifiedRemoved: 0, toolUses: [], rounds: 1, inputTokens: 1, outputTokens: 1 },
  };

  function streamed(lines: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
  }

  it('streams lookup progress and returns the final draft', async () => {
    const events: AskEvent[] = [];
    const draft = await runDesigner({
      ...input,
      onEvent: (event) => events.push(event),
      fetchImpl: () => Promise.resolve(streamed([
        '{"type":"event","event":{"type":"tool_call","name":"search_elements"}}\n',
        '{"type":"event","event":{"type":"tool_done","name":"search_elements","ok":true}}\n',
        `${JSON.stringify(done)}\n`,
      ])),
    });
    expect(events).toEqual([{ type: 'tool_call', name: 'search_elements' }, { type: 'tool_done', name: 'search_elements', ok: true }]);
    expect(draft.options[0]?.title).toBe('Replace');
  });

  it("throws the function's plain sentence from an error line", async () => {
    await expect(runDesigner({ ...input, fetchImpl: () => Promise.resolve(streamed(['{"type":"error","code":"rate_limited","message":"Too many requests right now."}\n'])) }))
      .rejects.toThrow('Too many requests right now.');
  });

  it('accepts the single JSON reply of an older function', async () => {
    const response = new Response(JSON.stringify({ ...done, type: undefined }), { headers: { 'content-type': 'application/json' } });
    const draft = await runDesigner({ ...input, fetchImpl: () => Promise.resolve(response) });
    expect(draft.options[0]?.title).toBe('Replace');
  });

  it("uses the function's sentence for a refusal before the stream starts", async () => {
    const response = new Response(JSON.stringify({ status: 'not_enabled', message: 'The free trial of the Designer is used up.' }), { status: 403, headers: { 'content-type': 'application/json' } });
    await expect(runDesigner({ ...input, fetchImpl: () => Promise.resolve(response) })).rejects.toThrow('The free trial of the Designer is used up.');
  });

  it('says the run stopped when the stream ends without a result', async () => {
    await expect(runDesigner({ ...input, fetchImpl: () => Promise.resolve(streamed(['{"type":"event","event":{"type":"tool_call","name":"get_element"}}\n'])) }))
      .rejects.toThrow(/stopped before it finished/);
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
    expect(draft.options[0]).toEqual({ title: 'Keep', approach: 'keep', summary: 'Keep Quote Tool.', toWeigh: 'Check Connection Quotations.', catalogueRefs: [], catalogueProducts: [], webRefs: [] });
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
  it('carries only well-formed web refs and reads the billed search count', () => {
    const ref = { url: 'https://vendor.example/product', title: 'Product page' };
    const draft = interpretDesignerReply({
      status: 'done',
      design: { options: [{ title: 'Replace', summary: 'Buy.', webRefs: [ref, { url: 'http://insecure.example', title: 'No' }, { url: 'https://vendor.example/other', title: '' }] }], gaps: [], stayNote: '', problems: [] },
      result: { answer: 'x', webSearch: { requests: 2 } },
    });
    expect(draft.options[0]?.webRefs).toEqual([ref]);
    expect(draft.usage.webSearches).toBe(2);
  });
});
