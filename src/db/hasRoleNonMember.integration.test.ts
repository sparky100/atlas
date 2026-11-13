/**
 * Regression test for the non-member bypass: `atlas.has_role` used to return
 * NULL for someone outside the organisation, so guards written
 * `if not atlas.has_role(...)` never raised and a signed-in user could call
 * owner-only functions against another organisation. Real database, real RLS.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createOrganisation, setReviewPeriod } from './organisations';
import { createApiKey, revokeApiKey } from './apiKeys';
import { clearEntraTenant, setEntraTenant } from './entraTenants';

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

describe('a signed-in user who is not a member of an organisation', () => {
  let victimOwner: TestUser;
  let stranger: TestUser;
  let victimOrg: string;
  let strangerOrg: string;

  beforeAll(async () => {
    victimOwner = await createSignedInUser('hasrole-owner');
    stranger = await createSignedInUser('hasrole-stranger');
    victimOrg = randomUUID();
    await createOrganisation(victimOwner.client, { id: victimOrg, name: 'Victim Org', slug: `victim-${victimOrg.slice(0, 8)}`, createdBy: victimOwner.id });
    strangerOrg = randomUUID();
    await createOrganisation(stranger.client, { id: strangerOrg, name: 'Stranger Org', slug: `stranger-${strangerOrg.slice(0, 8)}`, createdBy: stranger.id });
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', victimOrg);
    await service.from('organisations').delete().eq('id', strangerOrg);
  });

  it('has_role is false, not NULL, for a non-member (and true for the real owner)', async () => {
    const asStranger = await stranger.client.schema('atlas').rpc('has_role', { p_org: victimOrg, p_roles: ['owner', 'architect'] });
    expect(asStranger.error).toBeNull();
    expect(asStranger.data).toBe(false);
    const asOwner = await victimOwner.client.schema('atlas').rpc('has_role', { p_org: victimOrg, p_roles: ['owner'] });
    expect(asOwner.data).toBe(true);
  });

  it('cannot create or revoke an API key for another organisation', async () => {
    await expect(createApiKey(stranger.client, victimOrg, 'stolen')).rejects.toThrow(/owner/i);
    const key = await createApiKey(victimOwner.client, victimOrg, 'real');
    await expect(revokeApiKey(stranger.client, key.id)).rejects.toThrow(/owner/i);
    const { count } = await service.from('api_keys').select('id', { count: 'exact', head: true }).eq('org_id', victimOrg);
    expect(count).toBe(1);
  });

  it('cannot change another organisation review period', async () => {
    await expect(setReviewPeriod(stranger.client, victimOrg, 90)).rejects.toThrow();
    const { data } = await service.from('organisations').select('review_period_days').eq('id', victimOrg).single();
    expect((data as { review_period_days: number }).review_period_days).toBe(5);
  });

  it("cannot record a tenant on, or clear a tenant from, another organisation", async () => {
    await expect(setEntraTenant(stranger.client, victimOrg, randomUUID())).rejects.toThrow();
    await expect(clearEntraTenant(stranger.client, victimOrg)).rejects.toThrow();
    const { count } = await service.from('org_entra_tenants').select('org_id', { count: 'exact', head: true }).eq('org_id', victimOrg);
    expect(count).toBe(0);
  });
});
