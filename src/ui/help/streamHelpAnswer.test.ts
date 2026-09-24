import { describe, expect, it, vi } from 'vitest';
import { consumeSseChunk, streamHelpAnswer } from './streamHelpAnswer';

describe('consumeSseChunk', () => {
  it('extracts text from a content_block_delta event', () => {
    const tokens: string[] = [];
    consumeSseChunk('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n', (t) => tokens.push(t));
    expect(tokens).toEqual(['Hello']);
  });

  it('ignores events with no text delta (message_start, message_stop)', () => {
    const tokens: string[] = [];
    consumeSseChunk('data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\ndata: {"type":"message_stop"}\n\n', (t) => tokens.push(t));
    expect(tokens).toEqual([]);
  });

  it('handles multiple events split across one chunk, in order', () => {
    const tokens: string[] = [];
    consumeSseChunk(
      'data: {"delta":{"text":"one "}}\n\ndata: {"delta":{"text":"two"}}\n\n',
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(['one ', 'two']);
  });

  it('ignores [DONE] and malformed JSON payloads without throwing', () => {
    const tokens: string[] = [];
    expect(() => {
      consumeSseChunk('data: [DONE]\n\ndata: not json\n\n', (t) => tokens.push(t));
    }).not.toThrow();
    expect(tokens).toEqual([]);
  });

  it('ignores non-data lines (event: lines, blank lines)', () => {
    const tokens: string[] = [];
    consumeSseChunk('event: content_block_delta\ndata: {"delta":{"text":"hi"}}\n\n', (t) => tokens.push(t));
    expect(tokens).toEqual(['hi']);
  });
});

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

describe('streamHelpAnswer', () => {
  it('streams tokens in order and calls onComplete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(sseStream(['data: {"delta":{"text":"Hi"}}\n\n', 'data: {"delta":{"text":" there"}}\n\n']), { status: 200 }),
    );
    const onToken = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await streamHelpAnswer(
      { orgId: 'org-1', messages: [{ role: 'user', content: 'hello' }], fetchImpl: fetchImpl as typeof fetch, getAccessToken: () => Promise.resolve('token-1'), proxyUrl: 'https://example.test/functions/v1/llm-proxy' },
      { onToken, onComplete, onError },
    );

    expect(onToken.mock.calls.map((c): string => c[0] as string)).toEqual(['Hi', ' there']);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
    const body = JSON.parse(init.body as string) as { orgId: string; streamToClient: boolean; stream: boolean; responseFormat: string };
    expect(body.orgId).toBe('org-1');
    expect(body.streamToClient).toBe(true);
    expect(body.stream).toBe(true);
    expect(body.responseFormat).toBe('text');
  });

  it('reports a non-ok response via onError instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('Rate limit exceeded', { status: 429 }));
    const onError = vi.fn();

    await streamHelpAnswer(
      { orgId: 'org-1', messages: [{ role: 'user', content: 'hi' }], fetchImpl: fetchImpl as typeof fetch, getAccessToken: () => Promise.resolve(null), proxyUrl: 'https://example.test/functions/v1/llm-proxy' },
      { onToken: vi.fn(), onComplete: vi.fn(), onError },
    );

    expect(onError).toHaveBeenCalledOnce();
    const [reportedError] = onError.mock.calls[0] as [Error];
    expect(reportedError.message).toContain('429');
  });

  it('silently returns on AbortError rather than calling onError', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const fetchImpl = vi.fn().mockRejectedValue(abortError);
    const onError = vi.fn();
    const onComplete = vi.fn();

    await streamHelpAnswer(
      { orgId: 'org-1', messages: [{ role: 'user', content: 'hi' }], fetchImpl: fetchImpl as typeof fetch, getAccessToken: () => Promise.resolve(null), proxyUrl: 'https://example.test/functions/v1/llm-proxy' },
      { onToken: vi.fn(), onComplete, onError },
    );

    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
