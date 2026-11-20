/** Exercises the real edge entrypoint with fake Supabase/provider I/O, including its trial fallback. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';

const orgId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
let handler: (request: Request) => Promise<Response>;
let ownKey = true;
let role = 'contributor';
let member = true;
let assistantEnabled = true;
let agentsEnabled = true;
let providerCalls = 0;
let trialReads = 0;
const logs: Record<string, unknown>[] = [];

interface Query {
  select: (...args: unknown[]) => Query;
  eq: (...args: unknown[]) => Query;
  gte: (...args: unknown[]) => Query;
  limit: (...args: unknown[]) => Query;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  insert: (row: Record<string, unknown>) => Promise<{ error: null }>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
}

function fakeClient(_url: string, key: string) {
  const service = key === 'service';
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    schema: (_name: string) => ({ rpc: (_fn: string) => Promise.resolve({ data: ownKey ? 'own-secret' : null, error: null }) }),
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query: Query = {
        select: () => query,
        eq: (column, value) => { filters[String(column)] = value; return query; },
        gte: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: table === 'members' ? (filters.user_id ? { role } : member ? { user_id: 'user-1' } : null) : table === 'organisations' && service ? { ai_assistant_enabled: assistantEnabled, ai_agents_enabled: agentsEnabled, ai_agent_key_set: ownKey } : null, error: null }),
        insert: (row) => { logs.push(row); return Promise.resolve({ error: null }); },
        then: (resolve) => {
          if (table === 'llm_proxy_requests' && filters.key_source === 'trial') trialReads++;
          return Promise.resolve(resolve({ data: [], count: 0, error: null }));
        },
      };
      return query;
    },
  };
}

beforeAll(async () => {
  vi.stubGlobal('__atlasFakeCreateClient', fakeClient);
  const env: Record<string, string> = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', ANTHROPIC_API_KEY: 'platform-secret' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] ?? null }, serve: (fn: typeof handler) => { handler = fn; } });
  const built = await build({
    entryPoints: ['supabase/functions/llm-proxy/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral',
    plugins: [{ name: 'fake-supabase', setup(plugin) {
      plugin.onResolve({ filter: /^https:\/\/esm\.sh\// }, () => ({ path: 'fake-client', namespace: 'test' }));
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createClient = globalThis.__atlasFakeCreateClient;', loader: 'js' }));
    } }],
  });
  const js = built.outputFiles[0]?.text;
  if (!js) throw new Error('Could not bundle the real proxy entrypoint.');
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
});
afterAll(() => { vi.unstubAllGlobals(); });

async function call(fields: Record<string, unknown>) {
  return handler(new Request('https://db.test/functions/v1/llm-proxy', { method: 'POST', headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, useOrgKey: true, requireOrgKey: true, runId, messages: [{ role: 'user', content: 'Review' }], maxTokens: 100, ...fields }) }));
}

describe('llm-proxy reviewer key and tier on the actual edge entrypoint', () => {
  it('refuses a missing key even with a trial run id, with no provider call or trial read', async () => {
    ownKey = false;
    const response = await call({ modelTier: 'light' });
    expect(response.status).toBe(403);
    expect((await response.json()) as Record<string, unknown>).toMatchObject({ status: 'error', message: "This request needs the organisation's own AI key." });
    expect(providerCalls).toBe(0);
    expect(trialReads).toBe(0);
    ownKey = true;
  });

  it('never selects the light model on the platform key and refuses unknown tiers', async () => {
    const noOwnKey = await call({ useOrgKey: false, modelTier: 'light' });
    expect(noOwnKey.status).toBe(403);
    const unknown = await call({ modelTier: 'unknown' });
    expect(unknown.status).toBe(400);
    expect(providerCalls).toBe(0);
  });

  it('refuses a viewer or foreign organisation before calling the provider', async () => {
    role = 'viewer';
    expect((await call({})).status).toBe(403);
    role = 'contributor';
    member = false;
    expect((await call({})).status).toBe(403);
    member = true;
    expect(providerCalls).toBe(0);
  });

  it('refuses when either switch is off', async () => {
    assistantEnabled = false;
    expect((await call({})).status).toBe(403);
    assistantEnabled = true;
    agentsEnabled = false;
    expect((await call({})).status).toBe(403);
    agentsEnabled = true;
  });

  it('uses the own key and records the run id, then refuses a key removed before a second call', async () => {
    const oldFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('platform_config')) return Promise.resolve(Response.json([]));
      if (url.includes('api.anthropic.com')) {
        providerCalls++;
        return Promise.resolve(Response.json({ content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 10, output_tokens: 2 }, stop_reason: 'end_turn' }));
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    try {
      const first = await call({ modelTier: 'light' });
      expect(first.status).toBe(200);
      expect(logs.at(-1)).toMatchObject({ key_source: 'org', run_id: runId, model: 'claude-haiku-5-5' });
      ownKey = false;
      const second = await call({ modelTier: 'light' });
      expect(second.status).toBe(403);
      expect(providerCalls).toBe(1);
      expect(trialReads).toBe(0);
    } finally {
      ownKey = true;
      vi.stubGlobal('fetch', oldFetch);
    }
  });
});
