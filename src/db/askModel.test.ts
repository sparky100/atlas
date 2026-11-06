import { describe, expect, it } from 'vitest';
import { askModel, AskModelError, parseAskLine } from './askModel';
import type { AskEvent } from '../tools/askLoop';

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start: (c) => { for (const chunk of chunks) c.enqueue(encoder.encode(chunk)); c.close(); } }));
}
const base = { functionUrl: 'https://x.test/functions/v1/ask-model', accessToken: 't', modelId: '00000000-0000-4000-8000-000000000001', question: 'q', history: [] };

describe('parseAskLine', () => {
  it('reads events, results and errors, and ignores anything else', () => {
    expect(parseAskLine('{"type":"event","event":{"type":"tool_call","name":"x"}}')).toEqual({ type: 'event', event: { type: 'tool_call', name: 'x' } });
    expect(parseAskLine('{"type":"result","status":"disabled"}')).toEqual({ type: 'result', outcome: { status: 'disabled' } });
    expect(parseAskLine('{"type":"error","code":"rate_limited","message":"m"}')).toEqual({ type: 'error', code: 'rate_limited', message: 'm' });
    expect(parseAskLine('{"type":"error","code":"weird","message":"m"}')).toMatchObject({ code: 'failed' });
    for (const bad of ['', 'not json', '42', '{"type":"other"}']) expect(parseAskLine(bad)).toBeNull();
  });
});

describe('askModel', () => {
  it('delivers events as they arrive, including a line split across chunks, then returns the outcome', async () => {
    const events: AskEvent[] = [];
    const outcome = await askModel({
      ...base,
      onEvent: (e) => events.push(e),
      fetchImpl: () => Promise.resolve(streamOf(['{"type":"event","event":{"type":"tool_call",', '"name":"search_elements"}}\n{"type":"result","status":"not_found"}\n'])),
    });
    expect(events).toEqual([{ type: 'tool_call', name: 'search_elements' }]);
    expect(outcome).toEqual({ status: 'not_found' });
  });

  it('throws the function’s own error message', async () => {
    const error = await askModel({ ...base, onEvent: () => undefined, fetchImpl: () => Promise.resolve(streamOf(['{"type":"error","code":"rate_limited","message":"Rate limit exceeded"}\n'])) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AskModelError);
    expect((error as AskModelError).code).toBe('rate_limited');
  });

  it('throws when the stream ends with no result, and when the request fails', async () => {
    await expect(askModel({ ...base, onEvent: () => undefined, fetchImpl: () => Promise.resolve(streamOf([''])) })).rejects.toThrow(/stopped/);
    await expect(askModel({ ...base, onEvent: () => undefined, fetchImpl: () => Promise.resolve(new Response('no', { status: 500 })) })).rejects.toThrow(/500/);
  });
});
