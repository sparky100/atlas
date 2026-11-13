/**
 * Read-only API keys (ADR-031) against a real local Supabase with real RLS:
 * who can create, see and revoke keys, that the key itself is never stored
 * or readable, how `atlas.api_key_authorize` checks, counts and limits, and
 * that a key is only ever tied to its own organisation.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY_PATTERN, API_KEYS_PER_ORG_MAX } from '../contracts/api';
import { createApiKey, listApiKeys, revokeApiKey } from './apiKeys';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createSignedInUser(${label}): ${error.message}`);
  const client = createSupabaseClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client };
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

interface Authorized {
  key_id: string;
  org_id: string;
  allowed: boolean;
  retry_after_seconds: number;
}
async function authorize(hash: string, limit: number): Promise<Authorized | undefined> {
  const { data, error } = await service.schema('atlas').rpc('api_key_authorize', { p_key_hash: hash, p_limit: limit });
  if (error) throw new Error(error.message);
  return (data as Authorized[])[0];
}

describe('API keys against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('apikeys-owner');
    architect = await createSignedInUser('apikeys-architect');
    outsider = await createSignedInUser('apikeys-outsider');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'API Keys Org', slug: `apikeys-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (error) throw new Error(`add architect: ${error.message}`);
    otherOrgId = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Other Org', slug: `apikeys-other-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.from('organisations').delete().eq('id', otherOrgId);
  });

  it('round trip: an owner creates a key, sees its row without the key or hash, and the stored hash is the SHA-256 of the key', async () => {
    const created = await createApiKey(owner.client, orgId, '  Reporting tool  ');
    expect(created.token).toMatch(API_KEY_PATTERN);
    expect(created.name).toBe('Reporting tool');
    expect(created.key_prefix).toBe(created.token.slice(0, 12));

    const rows = await listApiKeys(owner.client, orgId);
    const row = rows.find((r) => r.id === created.id);
    expect(row).toMatchObject({ org_id: orgId, name: 'Reporting tool', key_prefix: created.key_prefix, created_by: owner.id, last_used_at: null, revoked_at: null });
    expect(JSON.stringify(rows)).not.toContain(created.token);

    const hashRead = await owner.client.from('api_keys').select('key_hash').eq('id', created.id);
    expect(hashRead.error).not.toBeNull();

    const { data } = await service.from('api_keys').select('key_hash').eq('id', created.id).single();
    expect((data as { key_hash: string }).key_hash).toBe(sha256(created.token));
  });

  it('only an owner can create, list or revoke; other roles and outsiders cannot', async () => {
    await expect(createApiKey(architect.client, orgId, 'nope')).rejects.toThrow(/owner/i);
    await expect(createApiKey(outsider.client, orgId, 'nope')).rejects.toThrow(/owner/i);
    expect(await listApiKeys(architect.client, orgId)).toEqual([]);
    expect(await listApiKeys(outsider.client, orgId)).toEqual([]);
    const key = await createApiKey(owner.client, orgId, 'Owned');
    await expect(revokeApiKey(architect.client, key.id)).rejects.toThrow(/owner/i);
    await expect(revokeApiKey(outsider.client, key.id)).rejects.toThrow(/owner/i);
    const direct = await owner.client.from('api_keys').insert({ org_id: orgId, name: 'x', key_prefix: 'atl_', key_hash: 'a'.repeat(64), created_by: owner.id });
    expect(direct.error).not.toBeNull();
  });

  it('validates the name', async () => {
    await expect(createApiKey(owner.client, orgId, '   ')).rejects.toThrow();
    await expect(createApiKey(owner.client, orgId, 'x'.repeat(81))).rejects.toThrow();
  });

  it('authorize: returns the key organisation, counts requests, flags the one over the limit, and sets last_used_at', async () => {
    const key = await createApiKey(owner.client, orgId, 'Limited');
    const hash = sha256(key.token);
    const first = await authorize(hash, 2);
    expect(first).toMatchObject({ key_id: key.id, org_id: orgId, allowed: true });
    expect((await authorize(hash, 2))?.allowed).toBe(true);
    const third = await authorize(hash, 2);
    expect(third?.allowed).toBe(false);
    expect(third?.retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(third?.retry_after_seconds).toBeLessThanOrEqual(60);
    const row = (await listApiKeys(owner.client, orgId)).find((r) => r.id === key.id);
    expect(row?.last_used_at).not.toBeNull();
  });

  it('authorize: an unknown hash returns nothing, and a key is tied to its own organisation only', async () => {
    expect(await authorize('f'.repeat(64), 100)).toBeUndefined();
    const other = await createApiKey(outsider.client, otherOrgId, 'Theirs');
    expect((await authorize(sha256(other.token), 100))?.org_id).toBe(otherOrgId);
  });

  it('revoking stops the key at once but keeps its row', async () => {
    const key = await createApiKey(owner.client, orgId, 'Short lived');
    expect(await authorize(sha256(key.token), 100)).toBeDefined();
    await revokeApiKey(owner.client, key.id);
    expect(await authorize(sha256(key.token), 100)).toBeUndefined();
    const row = (await listApiKeys(owner.client, orgId)).find((r) => r.id === key.id);
    expect(row?.revoked_at).not.toBeNull();
  });

  it('no client role can call authorize or read usage', async () => {
    const { error } = await owner.client.schema('atlas').rpc('api_key_authorize', { p_key_hash: 'a'.repeat(64), p_limit: 1 });
    expect(error).not.toBeNull();
    const usage = await owner.client.from('api_key_usage').select('*');
    expect(usage.error !== null || usage.data.length === 0).toBe(true);
  });

  it('caps active keys per organisation', async () => {
    const { count } = await service.from('api_keys').select('id', { count: 'exact', head: true }).eq('org_id', orgId).is('revoked_at', null);
    for (let i = count ?? 0; i < API_KEYS_PER_ORG_MAX; i++) await createApiKey(owner.client, orgId, `fill ${String(i)}`);
    await expect(createApiKey(owner.client, orgId, 'one too many')).rejects.toThrow(/at most/);
  });
});
