/**
 * ADR-029 step 4: the MCP tools against a real local Supabase, as real
 * signed-in users. Row-level security is the only authorisation, so this
 * proves what the server shows and refuses: nothing from another
 * organisation, nothing while the owner switch is off, and a change only to
 * someone who can see it. Written against the real RLS behaviour; the
 * sandbox it was authored in cannot run Docker, so it is run locally with
 * `pnpm db:start` then `pnpm test:integration`.
 */
import { randomUUID } from 'node:crypto';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '../../src/db/client';
import { createServiceRoleClient, createSupabaseClient } from '../../src/db/client';
import { loadEnv } from '../../src/db/env';
import { createModel } from '../../src/db/models';
import { createOrganisation, updateOrganisation } from '../../src/db/organisations';
import { createAtlasServer } from './serverCore';
import { DISABLED_MESSAGE } from './atlasTools';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  client: Client;
}

async function user(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`${label}: ${error.message}`);
  const client = createSupabaseClient(env);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`${label} sign-in: ${signedIn.error.message}`);
  return { id: data.user.id, client };
}

async function connect(supabase: Client): Promise<McpClient> {
  const server = createAtlasServer({ supabase, email: null, password: null });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new McpClient({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const textOf = (result: unknown): string => (result as { content: { text: string }[] }).content[0]?.text ?? '';

describe('Atlas MCP tools against a real local Supabase', () => {
  let owner: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let modelId: string;

  beforeAll(async () => {
    owner = await user('mcp-owner');
    outsider = await user('mcp-outsider');
    orgId = randomUUID();
    modelId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'MCP Test Org', slug: `mcp-${orgId.slice(0, 8)}`, createdBy: owner.id });
    await createModel(owner.client, { id: modelId, orgId, name: 'MCP Test Model', slug: `mcp-model-${modelId.slice(0, 8)}`, createdBy: owner.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('lists only the models the signed-in user can see', async () => {
    const mine = await connect(owner.client);
    const seen = JSON.parse(textOf(await mine.callTool({ name: 'atlas_list_models', arguments: {} }))) as { models: { modelId: string }[] };
    expect(seen.models.map((m) => m.modelId)).toContain(modelId);

    const theirs = await connect(outsider.client);
    const result = await theirs.callTool({ name: 'atlas_list_models', arguments: {} });
    expect(textOf(result)).not.toContain(modelId);
  });

  it('does not let an outsider read a model by its id', async () => {
    const theirs = await connect(outsider.client);
    const result = await theirs.callTool({ name: 'atlas_search_elements', arguments: { query: 'anything', model: modelId } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No model called|read/);
  });

  it('refuses while the owner switch is off, and answers once it is on', async () => {
    const mine = await connect(owner.client);
    const off = await mine.callTool({ name: 'atlas_search_elements', arguments: { query: 'anything', model: modelId } });
    expect(off.isError).toBe(true);
    expect(textOf(off)).toBe(DISABLED_MESSAGE);

    await updateOrganisation(owner.client, orgId, { aiAssistantEnabled: true });
    const on = await mine.callTool({ name: 'atlas_search_elements', arguments: { query: 'anything', model: modelId } });
    expect(on.isError).toBeFalsy();
    const parsed = JSON.parse(textOf(on)) as { stamp: { modelId: string; ref: unknown } };
    expect(parsed.stamp.modelId).toBe(modelId);
    expect(parsed.stamp.ref).toBe('main');
  });

  it('refuses a change id that is not in the model', async () => {
    const mine = await connect(owner.client);
    const result = await mine.callTool({ name: 'atlas_list_changes', arguments: { model: modelId, change: randomUUID() } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No change with that id/);
  });
});
