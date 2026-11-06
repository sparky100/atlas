import { describe, expect, it } from 'vitest';
import { AskProviderError, createProxyAskClient } from './proxyClient';

const REQUEST = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }], toolChoice: 'auto' as const, maxTokens: 2000 };

function client(respond: (init: RequestInit) => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn: typeof fetch = (url, init) => {
    seen.push({ url: typeof url === 'string' ? url : 'other', init: init ?? {} });
    return Promise.resolve(respond(init ?? {}));
  };
  return { seen, client: createProxyAskClient({ proxyUrl: 'https://x.test/functions/v1/llm-proxy', authorization: 'Bearer user-jwt', anonKey: 'anon', orgId: 'org-1', fetchFn }) };
}

describe('createProxyAskClient', () => {
  it('forwards the caller’s token and the organisation, and returns tool calls', async () => {
    const { seen, client: c } = client(() => Response.json({ status: 'ok', text: '', stopReason: 'tool_use', toolCalls: [{ id: 'a', name: 't', input: { q: 1 } }, { nope: true }], inputTokens: 5, outputTokens: 2 }));
    const out = await c.complete(REQUEST);
    expect(out.toolCalls).toEqual([{ id: 'a', name: 't', input: { q: 1 } }]);
    expect(out.stopReason).toBe('tool_use');
    const sent = seen[0];
    expect((sent?.init.headers as Record<string, string>).authorization).toBe('Bearer user-jwt');
    const body = JSON.parse(sent?.init.body as string) as Record<string, unknown>;
    expect(body.orgId).toBe('org-1');
    expect(body.tools).toHaveLength(1);
    expect((body.messages as { role: string }[])[0]?.role).toBe('system');
  });

  it('turns a rate-limit response into an error that carries the status and message', async () => {
    const { client: c } = client(() => Response.json({ status: 'error', message: 'Rate limit exceeded for this organisation (100 requests/hour).' }, { status: 429 }));
    const error = await c.complete(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AskProviderError);
    expect((error as AskProviderError).status).toBe(429);
    expect((error as AskProviderError).message).toContain('Rate limit');
  });

  it('reports an unreadable response as an error rather than an empty answer', async () => {
    const { client: c } = client(() => new Response('<html>', { status: 502 }));
    await expect(c.complete(REQUEST)).rejects.toThrow(/502/);
  });
});
