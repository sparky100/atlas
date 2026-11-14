/**
 * Regression tests for the 14 Nov 2026 security assessment
 * (`supabase/migrations/20261114090000_security_hardening.sql`): the invite
 * function nobody may call directly, and nothing callable by a signed-out
 * caller. Real database, real grants. Run with `pnpm db:start` then
 * `pnpm test:integration`.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { loadEnv } from './env';
import { createOrganisation } from './organisations';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
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
  return { id: created.user.id, email, client };
}

describe('security hardening: who can call what', () => {
  let owner: TestUser;
  let attacker: TestUser;
  let orgId: string;
  const invitedEmail = `invited-${randomUUID()}@example.test`;

  beforeAll(async () => {
    owner = await createSignedInUser('exposure-owner');
    attacker = await createSignedInUser('exposure-attacker');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Exposure Org', slug: `exposure-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error } = await service.from('invites').insert({ id: randomUUID(), org_id: orgId, email: invitedEmail, role: 'owner', invited_by: owner.id });
    if (error) throw new Error(`seed invite: ${error.message}`);
  });

  afterAll(async () => {
    await service.from('invites').delete().eq('org_id', orgId);
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('a signed-in stranger cannot use consume_invites_for_user to join an organisation as the invited role', async () => {
    const result = await attacker.client.schema('atlas').rpc('consume_invites_for_user', { p_user_id: attacker.id, p_email: invitedEmail });
    expect(result.error).not.toBeNull();
    const { data } = await service.from('members').select('user_id').eq('org_id', orgId).eq('user_id', attacker.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('a signed-out caller cannot use consume_invites_for_user either', async () => {
    const anon = createSupabaseClient(env);
    const result = await anon.schema('atlas').rpc('consume_invites_for_user', { p_user_id: attacker.id, p_email: invitedEmail });
    expect(result.error).not.toBeNull();
    const { data } = await service.from('members').select('user_id').eq('org_id', orgId).eq('user_id', attacker.id);
    expect(data ?? []).toHaveLength(0);
  });

  it('the real invite flow still works: the invited person joins through consume_my_invites', async () => {
    const invitee = await createSignedInUser('exposure-invitee');
    await service.from('invites').insert({ id: randomUUID(), org_id: orgId, email: invitee.email.toLowerCase(), role: 'viewer', invited_by: owner.id });
    const result = await invitee.client.schema('atlas').rpc('consume_my_invites');
    expect(result.error).toBeNull();
    const { data } = await service.from('members').select('role').eq('org_id', orgId).eq('user_id', invitee.id).maybeSingle();
    expect(data?.role).toBe('viewer');
  });

  it('a signed-out caller is refused by owner-run functions that used to be open to them', async () => {
    const anon = createSupabaseClient(env);
    const calls = [
      anon.schema('atlas').rpc('commit_shared_with_me', { p_commit: randomUUID() }),
      anon.schema('atlas').rpc('model_shared_with_me', { p_model: randomUUID() }),
      anon.schema('atlas').rpc('org_shares_a_model_with_me', { p_owner_org: randomUUID() }),
      anon.schema('atlas').rpc('assert_project_accepts_members', { p_project_id: randomUUID(), p_model_id: randomUUID(), p_what: 'x' }),
    ];
    for (const result of await Promise.all(calls)) expect(result.error).not.toBeNull();
  });

  it('trigger-only functions are not callable through the API', async () => {
    for (const name of ['record_member_joined', 'on_organisation_created', 'guard_branch_project']) {
      const result = await attacker.client.schema('atlas').rpc(name);
      expect(result.error).not.toBeNull();
    }
  });
});
