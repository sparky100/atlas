/**
 * Platform admin overview against a real local Supabase: the two functions
 * must refuse everyone who is not a platform admin (including an Owner of an
 * organisation, a non-member, and a signed-out caller), and return rows to
 * one who is. Run with `pnpm db:start` then `pnpm test:integration`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { listPlatformAdminOrganisations, listPlatformAdminPeople } from './platformAdminOverview';
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
  const { data: created, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createSignedInUser(${label}): ${error.message}`);
  const client = createSupabaseClient(env);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);
  return { id: created.user.id, client };
}

describe('platform admin overview', () => {
  let admin: TestUser;
  let orgOwner: TestUser;
  let outsider: TestUser;
  let orgId: string;

  beforeAll(async () => {
    admin = await createSignedInUser('overview-admin');
    orgOwner = await createSignedInUser('overview-owner');
    outsider = await createSignedInUser('overview-outsider');
    const { error: adminError } = await service.from('platform_admins').insert({ user_id: admin.id, granted_by: null });
    if (adminError) throw new Error(adminError.message);
    orgId = randomUUID();
    const { error: orgError } = await service.from('organisations').insert({ id: orgId, name: `Overview org ${orgId}`, slug: `overview-${orgId.slice(0, 8)}`, created_by: orgOwner.id });
    if (orgError) throw new Error(orgError.message);
  });

  afterAll(async () => {
    await service.from('platform_admins').delete().eq('user_id', admin.id);
  });

  it('a platform admin sees the organisation with its member count, and the owner with their membership', async () => {
    const orgs = await listPlatformAdminOrganisations(admin.client);
    expect(orgs.status).toBe('ok');
    if (orgs.status !== 'ok') return;
    const row = orgs.rows.find((o) => o.orgId === orgId);
    expect(row?.memberCount).toBe(1);

    const people = await listPlatformAdminPeople(admin.client);
    expect(people.status).toBe('ok');
    if (people.status !== 'ok') return;
    const owner = people.rows.find((p) => p.userId === orgOwner.id);
    expect(owner?.memberships.map((m) => m.orgId)).toEqual([orgId]);
    expect(owner?.signedUpAt).toBeTruthy();
  });

  it('an organisation Owner is refused', async () => {
    expect((await listPlatformAdminOrganisations(orgOwner.client)).status).toBe('error');
    expect((await listPlatformAdminPeople(orgOwner.client)).status).toBe('error');
  });

  it('a user who is in no organisation is refused', async () => {
    expect((await listPlatformAdminOrganisations(outsider.client)).status).toBe('error');
    expect((await listPlatformAdminPeople(outsider.client)).status).toBe('error');
  });

  it('a signed-out caller is refused', async () => {
    const anon = createSupabaseClient(env);
    expect((await listPlatformAdminOrganisations(anon)).status).toBe('error');
    expect((await listPlatformAdminPeople(anon)).status).toBe('error');
  });
});
