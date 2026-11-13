/**
 * Microsoft Entra sign-in against a real local Supabase: the owner-only tenant
 * setting, one-tenant-one-organisation, and the join rule. The caller-facing
 * `atlas.join_my_entra_org` reads `auth.identities`, which no test client can
 * write, so the join is exercised through its service-role worker
 * `atlas.join_entra_org`; the identity-to-tenant step is exercised through
 * `atlas.entra_tenant_of_identity`. A real Microsoft sign-in is the one thing
 * this suite cannot cover.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromOrgEntraTenantRow, toOrgEntraTenantRow } from '../contracts/entraTenant';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { clearEntraTenant, getEntraTenant, joinMyEntraOrg, setEntraTenant } from './entraTenants';
import { createOrganisation, deleteOrganisation, getMyMembership, listMembers } from './organisations';

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
  const client = createSupabaseClient(env);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`createSignedInUser(${label}) sign-in: ${error.message}`);
  return { id: created.user.id, client };
}

async function join(userId: string, tenantId: string): Promise<string> {
  const { data, error } = await service.schema('atlas').rpc('join_entra_org', { p_user_id: userId, p_tenant_id: tenantId });
  if (error) throw new Error(error.message);
  return data as string;
}

describe('Microsoft Entra sign-in against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let outsider: TestUser;
  let joiner: TestUser;
  let orgId: string;
  let otherOrgId: string;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    owner = await createSignedInUser('entra-owner');
    architect = await createSignedInUser('entra-architect');
    outsider = await createSignedInUser('entra-outsider');
    joiner = await createSignedInUser('entra-joiner');
    orgId = randomUUID();
    otherOrgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Entra Org', slug: `entra-${orgId.slice(0, 8)}`, createdBy: owner.id });
    await createOrganisation(outsider.client, { id: otherOrgId, name: 'Other Org', slug: `entra-${otherOrgId.slice(0, 8)}`, createdBy: outsider.id });
    const { error } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await clearEntraTenant(owner.client, orgId).catch(() => undefined);
    await deleteOrganisation(owner.client, orgId).catch(() => undefined);
    await deleteOrganisation(outsider.client, otherOrgId).catch(() => undefined);
  });

  it('lets an owner record a tenant, and the row round-trips through the contract', async () => {
    const row = await setEntraTenant(owner.client, orgId, tenantA);
    expect(row.tenant_id).toBe(tenantA);
    const read = await getEntraTenant(owner.client, orgId);
    if (read === null) throw new Error('tenant not saved');
    expect(toOrgEntraTenantRow(fromOrgEntraTenantRow(read))).toEqual(read);
  });

  it('refuses an architect and a non-member, and hides the setting from them', async () => {
    await expect(setEntraTenant(architect.client, orgId, tenantB)).rejects.toThrow(/owner/i);
    await expect(setEntraTenant(outsider.client, orgId, tenantB)).rejects.toThrow(/owner/i);
    await expect(clearEntraTenant(architect.client, orgId)).rejects.toThrow(/owner/i);
    expect(await getEntraTenant(architect.client, orgId)).toBeNull();
    expect(await getEntraTenant(outsider.client, orgId)).toBeNull();
  });

  it('refuses a tenant another organisation already holds, and keeps the original', async () => {
    await setEntraTenant(outsider.client, otherOrgId, tenantB);
    await expect(setEntraTenant(owner.client, orgId, tenantB)).rejects.toThrow(/already connected to another organisation/i);
    expect((await getEntraTenant(owner.client, orgId))?.tenant_id).toBe(tenantA);
    await clearEntraTenant(outsider.client, otherOrgId);
  });

  it('replaces the tenant when an owner saves a different one', async () => {
    const replacement = randomUUID();
    await setEntraTenant(owner.client, orgId, replacement);
    expect((await getEntraTenant(owner.client, orgId))?.tenant_id).toBe(replacement);
    await setEntraTenant(owner.client, orgId, tenantA);
  });

  it('joins a person from a recorded tenant as a Viewer, once, and records it in the audit trail', async () => {
    expect(await join(joiner.id, tenantA)).toBe('joined');
    const membership = await getMyMembership(joiner.client, orgId, joiner.id);
    expect(membership?.role).toBe('viewer');
    expect(await join(joiner.id, tenantA)).toBe('already_member');
    const members = await listMembers(owner.client, orgId);
    expect(members.filter((m) => m.member.user_id === joiner.id)).toHaveLength(1);
    const { data: events } = await owner.client.from('member_events').select('event_type, role').eq('org_id', orgId).eq('target_user_id', joiner.id);
    expect(events).toEqual([{ event_type: 'joined', role: 'viewer' }]);
  });

  it('never changes an existing member\'s role', async () => {
    expect(await join(architect.id, tenantA)).toBe('already_member');
    expect((await getMyMembership(architect.client, orgId, architect.id))?.role).toBe('architect');
    expect(await join(owner.id, tenantA)).toBe('already_member');
    expect((await getMyMembership(owner.client, orgId, owner.id))?.role).toBe('owner');
  });

  it('adds nobody from an unknown tenant', async () => {
    const stranger = await createSignedInUser('entra-stranger');
    expect(await join(stranger.id, randomUUID())).toBe('unknown_tenant');
    expect(await getMyMembership(stranger.client, orgId, stranger.id)).toBeNull();
  });

  it('stops new joins once the tenant is removed, and keeps the people already in', async () => {
    await clearEntraTenant(owner.client, orgId);
    expect(await getEntraTenant(owner.client, orgId)).toBeNull();
    const late = await createSignedInUser('entra-late');
    expect(await join(late.id, tenantA)).toBe('unknown_tenant');
    expect((await getMyMembership(joiner.client, orgId, joiner.id))?.role).toBe('viewer');
    await setEntraTenant(owner.client, orgId, tenantA);
  });

  it('reports not_microsoft for a password account, and cannot be called with a client-chosen tenant', async () => {
    expect(await joinMyEntraOrg(outsider.client)).toBe('not_microsoft');
    const { error } = await outsider.client.schema('atlas').rpc('join_entra_org', { p_user_id: outsider.id, p_tenant_id: tenantA });
    expect(error).not.toBeNull();
    expect(await getMyMembership(outsider.client, orgId, outsider.id)).toBeNull();
  });

  it('reads the tenant from a stored Microsoft identity the way the TypeScript contract does', async () => {
    const read = async (data: Record<string, unknown>) => {
      const { data: out, error } = await service.schema('atlas').rpc('entra_tenant_of_identity', { p_identity_data: data });
      if (error) throw new Error(error.message);
      return out as string | null;
    };
    expect(await read({ custom_claims: { tid: tenantA } })).toBe(tenantA);
    expect(await read({ iss: `https://login.microsoftonline.com/${tenantA}/v2.0` })).toBe(tenantA);
    expect(await read({ iss: 'https://accounts.google.com' })).toBeNull();
    expect(await read({ tid: 'not-a-guid' })).toBeNull();
  });
});
