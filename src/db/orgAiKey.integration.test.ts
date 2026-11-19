/**
 * Phase D step 1 (CLAUDE.md rule 9): the organisation's own AI key. Proves the
 * boundary against a real local Supabase: a signed-in user, including an owner
 * and a user from a different organisation, can call none of the key
 * functions; no client can write the "key is set" flag; only an owner can
 * switch agents on; the key round-trips through Vault for the service role
 * only; clearing the key switches agents off; deleting the organisation
 * removes the key. (Like the sibling integration tests, written against the
 * real behaviour and run in CI.)
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createOrganisation, updateOrganisation } from './organisations';
import { loadEnv } from './env';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  client: Client;
}

async function createSignedInUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);
  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client: signIn };
}

const KEY = 'sk-test-key-for-integration';

describe('organisation AI key against a real local Supabase', () => {
  let owner: TestUser;
  let stranger: TestUser;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('aikey-owner');
    stranger = await createSignedInUser('aikey-stranger');
    orgId = randomUUID();
    otherOrgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'AI Key Org', slug: `aikey-${orgId.slice(0, 8)}`, createdBy: owner.id });
    await createOrganisation(stranger.client, { id: otherOrgId, name: 'Other AI Key Org', slug: `aikeyother-${otherOrgId.slice(0, 8)}`, createdBy: stranger.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
    await service.from('organisations').delete().eq('id', otherOrgId);
  });

  it('agents and the key flag are off by default', async () => {
    const { data } = await owner.client.from('organisations').select('ai_agents_enabled, ai_agent_key_set').eq('id', orgId).single();
    expect(data).toEqual({ ai_agents_enabled: false, ai_agent_key_set: false });
  });

  it('no signed-in user can call the key functions, not even the owner and not someone from another organisation', async () => {
    for (const user of [owner, stranger]) {
      const set = await user.client.schema('atlas').rpc('set_org_ai_key', { p_org: orgId, p_key: KEY });
      expect(set.error).not.toBeNull();
      const clear = await user.client.schema('atlas').rpc('clear_org_ai_key', { p_org: orgId });
      expect(clear.error).not.toBeNull();
      const read = await user.client.schema('atlas').rpc('org_ai_api_key', { p_org: orgId });
      expect(read.error).not.toBeNull();
    }
    const flag = await service.from('organisations').select('ai_agent_key_set').eq('id', orgId).single();
    expect((flag.data as { ai_agent_key_set: boolean }).ai_agent_key_set).toBe(false);
  });

  it('no client can write the key-is-set flag, even an owner', async () => {
    const direct = await owner.client.from('organisations').update({ ai_agent_key_set: true }).eq('id', orgId);
    expect(direct.error).not.toBeNull();
  });

  it('only an owner of the organisation can switch agents on or off', async () => {
    const on = await updateOrganisation(owner.client, orgId, { aiAgentsEnabled: true });
    expect(on.ai_agents_enabled).toBe(true);
    // Someone from another organisation: RLS matches no row, so the call fails or changes nothing.
    await updateOrganisation(stranger.client, orgId, { aiAgentsEnabled: false }).catch(() => undefined);
    const still = await service.from('organisations').select('ai_agents_enabled').eq('id', orgId).single();
    expect((still.data as { ai_agents_enabled: boolean }).ai_agents_enabled).toBe(true);
  });

  it('the service role saves the key to Vault, reads it back, and clearing it switches agents off', async () => {
    const set = await service.schema('atlas').rpc('set_org_ai_key', { p_org: orgId, p_key: `  ${KEY}  ` });
    expect(set.error).toBeNull();
    const flag = await owner.client.from('organisations').select('ai_agent_key_set').eq('id', orgId).single();
    expect((flag.data as { ai_agent_key_set: boolean }).ai_agent_key_set).toBe(true);
    const read = await service.schema('atlas').rpc('org_ai_api_key', { p_org: orgId });
    expect(read.data).toBe(KEY);
    // The key is in no column an owner can read.
    const row = await owner.client.from('organisations').select('*').eq('id', orgId).single();
    expect(JSON.stringify(row.data)).not.toContain(KEY);

    const clear = await service.schema('atlas').rpc('clear_org_ai_key', { p_org: orgId });
    expect(clear.error).toBeNull();
    const after = await service.from('organisations').select('ai_agent_key_set, ai_agents_enabled').eq('id', orgId).single();
    expect(after.data).toEqual({ ai_agent_key_set: false, ai_agents_enabled: false });
    const gone = await service.schema('atlas').rpc('org_ai_api_key', { p_org: orgId });
    expect(gone.data).toBeNull();
  });

  it('refuses an empty key and an unknown organisation', async () => {
    expect((await service.schema('atlas').rpc('set_org_ai_key', { p_org: orgId, p_key: '   ' })).error).not.toBeNull();
    expect((await service.schema('atlas').rpc('set_org_ai_key', { p_org: randomUUID(), p_key: KEY })).error).not.toBeNull();
  });

  it('deleting the organisation removes its key from Vault', async () => {
    const doomed = randomUUID();
    await createOrganisation(owner.client, { id: doomed, name: 'Doomed AI Key Org', slug: `doomed-${doomed.slice(0, 8)}`, createdBy: owner.id });
    await service.schema('atlas').rpc('set_org_ai_key', { p_org: doomed, p_key: KEY });
    await service.from('organisations').delete().eq('id', doomed);
    const read = await service.schema('atlas').rpc('org_ai_api_key', { p_org: doomed });
    expect(read.data).toBeNull();
  });
});
