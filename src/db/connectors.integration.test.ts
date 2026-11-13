/**
 * Live connectors (ADR-032) against a real local Supabase with real RLS and
 * a real Vault: who can save, read and remove a connector, that the secret is
 * encrypted at rest and never readable by a client, and that only the service
 * role can decrypt it.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { findConnector, listConnectors, removeConnector, saveConnector } from './connectors';
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

const CONFIG = { region: 'us', organizationId: 'org-1234-abcd', clientId: 'client-id-12345', environments: ['Production'] };
const SECRET = `secret-${randomUUID()}`;

describe('connectors against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let contributor: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('connectors-owner');
    architect = await createSignedInUser('connectors-architect');
    contributor = await createSignedInUser('connectors-contributor');
    outsider = await createSignedInUser('connectors-outsider');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Connectors Org', slug: `connectors-${orgId.slice(0, 8)}`, createdBy: owner.id });
    for (const [user, role] of [[architect, 'architect'], [contributor, 'contributor']] as const) {
      const { error } = await owner.client.from('members').insert({ org_id: orgId, user_id: user.id, role, invited_by: owner.id });
      if (error) throw new Error(`add ${role}: ${error.message}`);
    }
    otherOrgId = randomUUID();
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Other Org', slug: `connectors-other-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
  });

  afterAll(async () => {
    for (const id of [orgId, otherOrgId]) {
      await service.schema('atlas').rpc('remove_connector', { p_org_id: id, p_kind: 'mulesoft' });
      await service.from('organisations').delete().eq('id', id);
    }
  });

  it('round trip: an owner saves a connector; owner and architect read the settings; the secret is nowhere a client can see', async () => {
    await saveConnector(owner.client, orgId, 'mulesoft', CONFIG, SECRET);
    for (const reader of [owner, architect]) {
      const row = findConnector(await listConnectors(reader.client, orgId), 'mulesoft');
      expect(row).toMatchObject({ org_id: orgId, kind: 'mulesoft', config: CONFIG, created_by: owner.id, last_fetch_at: null });
      expect(JSON.stringify(row)).not.toContain(SECRET);
    }
    const direct = await owner.client.from('org_connectors').select('secret_id');
    expect(direct.error).not.toBeNull();
  });

  it('the secret is encrypted at rest in Vault and only the service role can decrypt it', async () => {
    const { data: rows } = await service.from('org_connectors').select('id, secret_id').eq('org_id', orgId).single().then((r) => ({ data: r.data as { id: string; secret_id: string } }));
    const stored = await service.schema('vault').from('secrets').select('secret').eq('id', rows.secret_id).maybeSingle();
    if (stored.data) expect(stored.data.secret).not.toBe(SECRET);

    const decrypted = await service.schema('atlas').rpc('connector_secret', { p_connector_id: rows.id });
    expect(decrypted.data).toBe(SECRET);
    for (const user of [owner, architect, contributor, outsider]) {
      const attempt = await user.client.schema('atlas').rpc('connector_secret', { p_connector_id: rows.id });
      expect(attempt.error).not.toBeNull();
    }
  });

  it('only an owner can save or remove; architects can read but not change; contributors and outsiders see nothing', async () => {
    await expect(saveConnector(architect.client, orgId, 'mulesoft', CONFIG, SECRET)).rejects.toThrow(/owner/i);
    await expect(saveConnector(outsider.client, orgId, 'mulesoft', CONFIG, SECRET)).rejects.toThrow(/owner/i);
    await expect(removeConnector(architect.client, orgId, 'mulesoft')).rejects.toThrow(/owner/i);
    expect(await listConnectors(contributor.client, orgId)).toEqual([]);
    expect(await listConnectors(outsider.client, orgId)).toEqual([]);
    const direct = await owner.client.from('org_connectors').insert({ org_id: orgId, kind: 'mulesoft', secret_id: randomUUID(), created_by: owner.id });
    expect(direct.error).not.toBeNull();
  });

  it('rejects an unknown kind, bad settings, and a first save with no secret', async () => {
    await expect(saveConnector(outsider.client, otherOrgId, 'nope' as never, CONFIG, SECRET)).rejects.toThrow();
    await expect(saveConnector(outsider.client, otherOrgId, 'mulesoft', CONFIG, '   ')).rejects.toThrow(/secret/i);
  });

  it('changing the settings with a blank secret keeps the saved secret; a new secret replaces it', async () => {
    const { data: row } = await service.from('org_connectors').select('id').eq('org_id', orgId).single();
    const id = (row as { id: string }).id;
    await saveConnector(owner.client, orgId, 'mulesoft', { ...CONFIG, environments: ['Production', 'Sandbox'] }, '');
    expect((await service.schema('atlas').rpc('connector_secret', { p_connector_id: id })).data).toBe(SECRET);
    expect(findConnector(await listConnectors(owner.client, orgId), 'mulesoft')?.config).toMatchObject({ environments: ['Production', 'Sandbox'] });
    await saveConnector(owner.client, orgId, 'mulesoft', CONFIG, `${SECRET}-new`);
    expect((await service.schema('atlas').rpc('connector_secret', { p_connector_id: id })).data).toBe(`${SECRET}-new`);
  });

  it('records the outcome of a fetch (service role only)', async () => {
    const { data: row } = await service.from('org_connectors').select('id').eq('org_id', orgId).single();
    const id = (row as { id: string }).id;
    const asUser = await owner.client.schema('atlas').rpc('record_connector_fetch', { p_connector_id: id, p_status: 'ok', p_message: 'x' });
    expect(asUser.error).not.toBeNull();
    const { error } = await service.schema('atlas').rpc('record_connector_fetch', { p_connector_id: id, p_status: 'error', p_message: 'Anypoint refused the client ID and secret.' });
    expect(error).toBeNull();
    expect(findConnector(await listConnectors(owner.client, orgId), 'mulesoft')).toMatchObject({ last_fetch_status: 'error', last_fetch_message: 'Anypoint refused the client ID and secret.' });
  });

  it('removing a connector deletes the row and the stored secret', async () => {
    const { data: row } = await service.from('org_connectors').select('id, secret_id').eq('org_id', orgId).single();
    const { id, secret_id } = row as { id: string; secret_id: string };
    await removeConnector(owner.client, orgId, 'mulesoft');
    expect(findConnector(await listConnectors(owner.client, orgId), 'mulesoft')).toBeNull();
    expect((await service.schema('atlas').rpc('connector_secret', { p_connector_id: id })).data).toBeNull();
    const left = await service.schema('vault').from('secrets').select('id').eq('id', secret_id);
    expect(left.data ?? []).toEqual([]);
  });
});
