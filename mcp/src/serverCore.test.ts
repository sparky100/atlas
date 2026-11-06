import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import type { Client } from '../../src/db/client';
import { NOT_SIGNED_IN } from './auth';
import { MODEL_TOOLS } from '../../src/tools';
import { createAtlasServer } from './serverCore';

const MODELS = [
  { id: 'm2', org_id: 'o1', name: 'Zeta', slug: 'zeta', archived_at: null },
  { id: 'm1', org_id: 'o1', name: 'Alpha', slug: 'alpha', archived_at: '2026-01-01' },
];
const ORGS = [{ id: 'o1', name: 'Council', slug: 'council' }];

function fakeSupabase(opts: { signedIn: boolean; failQueries?: boolean }): Client {
  const table = (rows: unknown[]) => ({
    select: () => ({
      order: () => ({
        range: () => Promise.resolve(opts.failQueries ? { data: null, error: { message: 'permission denied' }, count: null } : { data: rows, error: null, count: rows.length }),
      }),
    }),
  });
  return {
    auth: {
      getSession: () => Promise.resolve({ data: { session: opts.signedIn ? { user: { id: 'u1', email: 'ada@example.test' } } : null }, error: null }),
      signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'Invalid login credentials' } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    from: (name: string) => table(name === 'models' ? MODELS : ORGS),
  } as unknown as Client;
}

async function connect(supabase: Client) {
  const server = createAtlasServer({ supabase, email: null, password: null });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new McpClient({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const textOf = (result: unknown): string => ((result as { content: { text: string }[] }).content[0]?.text ?? '');

describe('the Atlas MCP server', () => {
  it('offers atlas_list_models and says it is read-only', async () => {
    const client = await connect(fakeSupabase({ signedIn: true }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'atlas_list_models',
      'atlas_get_guide',
      ...MODEL_TOOLS.map((t) => `atlas_${t.name}`),
    ]);
    expect(client.getInstructions()).toMatch(/read-only/);
  });

  it('lists the models the signed-in user can see, with their organisation, sorted', async () => {
    const client = await connect(fakeSupabase({ signedIn: true }));
    const result = await client.callTool({ name: 'atlas_list_models', arguments: {} });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(result)) as { models: { name: string; organisation: string; archived: boolean }[] };
    expect(parsed.models.map((m) => [m.name, m.organisation, m.archived])).toEqual([['Alpha', 'Council', true], ['Zeta', 'Council', false]]);
  });

  it('answers a signed-out call with how to sign in, as an error the assistant can read', async () => {
    const client = await connect(fakeSupabase({ signedIn: false }));
    const result = await client.callTool({ name: 'atlas_list_models', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(NOT_SIGNED_IN);
  });

  it('turns a failed read into a plain message instead of crashing', async () => {
    const client = await connect(fakeSupabase({ signedIn: true, failQueries: true }));
    const result = await client.callTool({ name: 'atlas_list_models', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/could not answer that/);
  });

  it('gives every model tool optional model and change arguments, and keeps its own inputs', async () => {
    const client = await connect(fakeSupabase({ signedIn: true }));
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === 'atlas_search_elements');
    const props = Object.keys((search?.inputSchema.properties ?? {}));
    expect(props).toEqual(expect.arrayContaining(['query', 'model', 'change']));
    for (const t of tools.filter((x) => x.name.startsWith('atlas_') && !['atlas_list_models', 'atlas_get_guide'].includes(x.name))) {
      expect(t.inputSchema.required ?? []).not.toContain('model');
      expect(t.inputSchema.required ?? []).not.toContain('change');
    }
  });

  it('returns the guide without needing a sign-in', async () => {
    const client = await connect(fakeSupabase({ signedIn: false }));
    const result = await client.callTool({ name: 'atlas_get_guide', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toMatch(/atlas_search_elements/);
  });

  it('says so when the named model is not one the user can see', async () => {
    const client = await connect(fakeSupabase({ signedIn: true }));
    const result = await client.callTool({ name: 'atlas_search_elements', arguments: { query: 'CRM', model: 'Nowhere' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No model called/);
  });

  it('reports an unknown tool plainly', async () => {
    const client = await connect(fakeSupabase({ signedIn: true }));
    const result = await client.callTool({ name: 'atlas_nope', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no tool called/);
  });
});
