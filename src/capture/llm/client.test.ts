import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPTURE_MAX_TOKENS, DEFAULT_CAPTURE_MODEL, LlmRefusalError, LlmSchemaInvalidError, LlmTruncatedError, ProxyLlmClient, RecordedLlmClient, hashLlmRequest, type LlmRequest } from './client';

const BASE_REQUEST: LlmRequest = {
  effort: 'medium',
  system: 'You are a careful clerk.',
  format: { type: 'json_schema', schema: { type: 'object' } },
  messages: [{ role: 'user', content: 'Map these columns.' }],
};

describe('ProxyLlmClient', () => {
  function makeFetch(response: unknown, ok = true, status = 200): typeof fetch {
    return vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(response) }) as typeof fetch;
  }

  it('POSTs a well-formed llm-proxy request: cache-controlled, structured output, org id and bearer token forwarded', async () => {
    const fetchImpl = makeFetch({ status: 'ok', text: '{"ok":true}', inputTokens: 10, outputTokens: 5, stopReason: 'end_turn', cacheReadTokens: 3 });
    const client = new ProxyLlmClient({ proxyUrl: 'https://example.com/llm-proxy', authToken: 'a-token', orgId: 'org-1', fetchImpl });

    const response = await client.complete(BASE_REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/llm-proxy');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer a-token');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.orgId).toBe('org-1');
    expect(body.cacheControl).toBe(true);
    expect(body.responseFormat).toBe('json');
    expect(body.maxTokens).toBe(DEFAULT_CAPTURE_MAX_TOKENS);
    expect(body.outputConfig).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a careful clerk.' },
      { role: 'user', content: 'Map these columns.' },
    ]);

    expect(response).toEqual({ text: '{"ok":true}', stopReason: 'end_turn', inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 });
  });

  it('strips unsupported numeric bounds from the schema on the wire without mutating the caller\'s schema', async () => {
    const fetchImpl = makeFetch({ status: 'ok', text: '{}', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' });
    const client = new ProxyLlmClient({ proxyUrl: 'https://x', authToken: 't', orgId: 'o', fetchImpl });
    const request: LlmRequest = {
      ...BASE_REQUEST,
      format: { type: 'json_schema', schema: { type: 'object', properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['confidence'], additionalProperties: false } },
    };

    await client.complete(request);

    const body = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    const sentSchema = (body.outputConfig as { format: { schema: Record<string, unknown> } }).format.schema;
    expect(sentSchema).toEqual({ type: 'object', properties: { confidence: { type: 'number' } }, required: ['confidence'], additionalProperties: false });
    // The caller's own schema is untouched, so a recorded cassette keyed on it still resolves.
    const callerSchema = (request.format.schema as { properties: { confidence: Record<string, unknown> } }).properties.confidence;
    expect(callerSchema).toHaveProperty('minimum', 0);
    expect(callerSchema).toHaveProperty('maximum', 1);
  });

  it('passes stream through only when the request opts in', async () => {
    const fetchImpl = makeFetch({ status: 'ok', text: 'x', inputTokens: 1, outputTokens: 1, stopReason: 'end_turn' });
    const client = new ProxyLlmClient({ proxyUrl: 'https://x', authToken: 't', orgId: 'o', fetchImpl });

    await client.complete({ ...BASE_REQUEST, stream: true });
    const bodyWithStream = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    expect(bodyWithStream.stream).toBe(true);

    await client.complete(BASE_REQUEST);
    const bodyWithoutStream = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]?.body as string) as Record<string, unknown>;
    expect(bodyWithoutStream).not.toHaveProperty('stream');
  });

  it('throws LlmRefusalError before returning text when stop_reason is refusal (§3.5: checked before content is read)', async () => {
    const fetchImpl = makeFetch({ status: 'ok', text: 'should never be read', inputTokens: 1, outputTokens: 1, stopReason: 'refusal' });
    const client = new ProxyLlmClient({ proxyUrl: 'https://x', authToken: 't', orgId: 'o', fetchImpl });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('throws LlmTruncatedError on stop_reason max_tokens', async () => {
    const fetchImpl = makeFetch({ status: 'ok', text: 'partial', inputTokens: 1, outputTokens: 1, stopReason: 'max_tokens' });
    const client = new ProxyLlmClient({ proxyUrl: 'https://x', authToken: 't', orgId: 'o', fetchImpl });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(LlmTruncatedError);
  });

  it('throws a plain error when the proxy itself reports an error', async () => {
    const fetchImpl = makeFetch({ status: 'error', message: 'Rate limit exceeded' }, false, 429);
    const client = new ProxyLlmClient({ proxyUrl: 'https://x', authToken: 't', orgId: 'o', fetchImpl });
    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/429.*Rate limit exceeded/);
  });
});

describe('hashLlmRequest', () => {
  it('is deterministic for the same logical request regardless of object construction order', () => {
    const a: LlmRequest = { effort: 'high', system: 'S', format: { type: 'json_schema', schema: { a: 1, b: 2 } }, messages: [{ role: 'user', content: 'hi' }] };
    const b: LlmRequest = { messages: [{ role: 'user', content: 'hi' }], format: { schema: { b: 2, a: 1 }, type: 'json_schema' }, system: 'S', effort: 'high' };
    expect(hashLlmRequest(a)).toBe(hashLlmRequest(b));
  });

  it('changes when the request content changes', () => {
    const a: LlmRequest = { ...BASE_REQUEST };
    const b: LlmRequest = { ...BASE_REQUEST, system: 'A different system prompt.' };
    expect(hashLlmRequest(a)).not.toBe(hashLlmRequest(b));
  });

  it('defaults model/maxTokens into the key so an explicit default and an omitted one hash the same', () => {
    const a: LlmRequest = { ...BASE_REQUEST };
    const b: LlmRequest = { ...BASE_REQUEST, model: DEFAULT_CAPTURE_MODEL, maxTokens: DEFAULT_CAPTURE_MAX_TOKENS };
    expect(hashLlmRequest(a)).toBe(hashLlmRequest(b));
  });
});

describe('RecordedLlmClient', () => {
  it('replays the cassette for a matching request hash', async () => {
    const key = hashLlmRequest(BASE_REQUEST);
    const client = new RecordedLlmClient({ cassettes: new Map([[key, { text: 'recorded', stopReason: 'end_turn', inputTokens: 4, outputTokens: 2, cacheReadTokens: 0 }]]) });
    await expect(client.complete(BASE_REQUEST)).resolves.toEqual({ text: 'recorded', stopReason: 'end_turn', inputTokens: 4, outputTokens: 2, cacheReadTokens: 0 });
  });

  it('throws on a cassette miss rather than silently falling back to anything', async () => {
    const client = new RecordedLlmClient({ cassettes: new Map() });
    await expect(client.complete(BASE_REQUEST)).rejects.toThrow(/no cassette/);
  });

  it('still enforces the refusal/truncation check on a recorded response', async () => {
    const key = hashLlmRequest(BASE_REQUEST);
    const client = new RecordedLlmClient({ cassettes: new Map([[key, { text: '', stopReason: 'refusal', inputTokens: 1, outputTokens: 0, cacheReadTokens: 0 }]]) });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(LlmRefusalError);
  });
});

const streamMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({ messages: { stream: streamMock } })),
}));

describe('DirectLlmClient', () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  it('builds the Messages API request with cache-controlled system, output_config format (no effort — the model rejects it), and resolves via finalMessage', async () => {
    streamMock.mockReturnValue({
      finalMessage: () =>
        Promise.resolve({
          content: [{ type: 'text', text: '{"ok":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 6, cache_read_input_tokens: 4 },
        }),
    });

    const { DirectLlmClient } = await import('./client');
    const client = new DirectLlmClient({ apiKey: 'sk-test' });
    const response = await client.complete(BASE_REQUEST);

    expect(streamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_CAPTURE_MODEL,
        max_tokens: DEFAULT_CAPTURE_MAX_TOKENS,
        system: [{ type: 'text', text: 'You are a careful clerk.', cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
      }),
    );
    expect(response).toEqual({ text: '{"ok":true}', stopReason: 'end_turn', inputTokens: 12, outputTokens: 6, cacheReadTokens: 4 });
  });

  it('strips unsupported numeric bounds from output_config.format.schema', async () => {
    streamMock.mockReturnValue({
      finalMessage: () => Promise.resolve({ content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null } }),
    });

    const { DirectLlmClient } = await import('./client');
    const client = new DirectLlmClient({ apiKey: 'sk-test' });
    const request: LlmRequest = {
      ...BASE_REQUEST,
      format: { type: 'json_schema', schema: { type: 'object', properties: { confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['confidence'] } },
    };

    await client.complete(request);

    expect(streamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: { format: { type: 'json_schema', schema: { type: 'object', properties: { confidence: { type: 'number' } }, required: ['confidence'] } } },
      }),
    );
  });

  it('throws LlmRefusalError on stop_reason refusal without reading content as output', async () => {
    streamMock.mockReturnValue({
      finalMessage: () => Promise.resolve({ content: [], stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: null } }),
    });
    const { DirectLlmClient } = await import('./client');
    const client = new DirectLlmClient({ apiKey: 'sk-test' });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('throws LlmSchemaInvalidError when a successful, non-truncated response carries no text block', async () => {
    streamMock.mockReturnValue({
      finalMessage: () => Promise.resolve({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null } }),
    });
    const { DirectLlmClient } = await import('./client');
    const client = new DirectLlmClient({ apiKey: 'sk-test' });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(LlmSchemaInvalidError);
  });
});
