/**
 * Sprint 7j item 2: organisation rename/member-directory/Delete against a
 * real local Supabase. Same "this sandbox has no Docker route" limitation
 * named in `repository.integration.test.ts`'s own module comment — written
 * and reasoned through against the real RLS/RPC/trigger behaviour, not
 * executed here.
 *
 * `atlas.guard_last_owner` (20260906071200_tenancy.sql) is pre-existing and
 * already fully enforces "an org must always have ≥1 owner" — the two
 * guard tests below exist to prove this migration's narrower `members`
 * grant (`role` only) doesn't accidentally let that trigger be bypassed,
 * not to test the trigger itself.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { archiveModel, createModel, deleteModel } from './models';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { changeMemberRole, createOrganisation, deleteOrganisation, listMembers, removeMember, updateOrganisation } from './organisations';
import { loadEnv } from './env';

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
  const { data: created, error: createError } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, email, client: signIn };
}

describe('organisation settings against a real local Supabase', () => {
  let owner: TestUser;
  let architect: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('orgsettings-owner');
    architect = await createSignedInUser('orgsettings-architect');

    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Org Settings Test Org', slug: `orgsettings-${orgId.slice(0, 8)}`, createdBy: owner.id });
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: architect.id, role: 'architect', invited_by: owner.id });
    if (memberError) throw new Error(`add architect: ${memberError.message}`);
  });

  afterAll(async () => {
    // Best-effort — a local Supabase reset (pnpm db:reset) is the real
    // cleanup between full test runs.
    await service.from('organisations').delete().eq('id', orgId);
  });

  it('an owner can rename/reslug; an architect cannot (organisations_update RLS)', async () => {
    const renamed = await updateOrganisation(owner.client, orgId, { name: 'Renamed Org', slug: `renamed-${orgId.slice(0, 8)}` });
    expect(renamed.name).toBe('Renamed Org');

    await expect(updateOrganisation(architect.client, orgId, { name: 'Should Not Land' })).rejects.toThrow();
  });

  it('Ask Atlas is off by default; an owner can switch it on and off; an architect cannot (ADR-028 §7)', async () => {
    const before = await owner.client.from('organisations').select('ai_assistant_enabled').eq('id', orgId).single();
    expect((before.data as { ai_assistant_enabled: boolean }).ai_assistant_enabled).toBe(false);

    const on = await updateOrganisation(owner.client, orgId, { aiAssistantEnabled: true });
    expect(on.ai_assistant_enabled).toBe(true);

    await expect(updateOrganisation(architect.client, orgId, { aiAssistantEnabled: false })).rejects.toThrow();
    const stillOn = await owner.client.from('organisations').select('ai_assistant_enabled').eq('id', orgId).single();
    expect((stillOn.data as { ai_assistant_enabled: boolean }).ai_assistant_enabled).toBe(true);

    const off = await updateOrganisation(owner.client, orgId, { aiAssistantEnabled: false });
    expect(off.ai_assistant_enabled).toBe(false);
  });

  it('listMembers returns every member with their profile, role and joined date', async () => {
    const members = await listMembers(owner.client, orgId);
    expect(members).toHaveLength(2);
    const architectRow = members.find((m) => m.member.user_id === architect.id);
    expect(architectRow?.member.role).toBe('architect');
    expect(architectRow?.profile?.user_id).toBe(architect.id);
  });

  it('an owner can change a member’s role; an architect cannot (members_update RLS)', async () => {
    const updated = await changeMemberRole(owner.client, orgId, architect.id, 'contributor');
    expect(updated.role).toBe('contributor');

    await expect(changeMemberRole(architect.client, orgId, architect.id, 'owner')).rejects.toThrow();

    // Restore for the tests below, which assume 'architect'.
    await changeMemberRole(owner.client, orgId, architect.id, 'architect');
  });

  it('guard_last_owner refuses demoting the only owner, even via the narrowed role-only grant', async () => {
    await expect(changeMemberRole(owner.client, orgId, owner.id, 'architect')).rejects.toThrow();
  });

  it('guard_last_owner refuses removing the only owner', async () => {
    await expect(removeMember(owner.client, orgId, owner.id)).rejects.toThrow();
  });

  it('an owner can remove a non-owner member; they disappear from listMembers', async () => {
    const secondArchitect = await createSignedInUser('orgsettings-architect2');
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: secondArchitect.id, role: 'viewer', invited_by: owner.id });
    if (memberError) throw new Error(`add second member: ${memberError.message}`);

    await removeMember(owner.client, orgId, secondArchitect.id);
    const members = await listMembers(owner.client, orgId);
    expect(members.find((m) => m.member.user_id === secondArchitect.id)).toBeUndefined();
  });

  it('delete refuses while the organisation has a model, with the model count', async () => {
    const modelId = randomUUID();
    await createModel(owner.client, { id: modelId, orgId, name: 'Org Settings Test Model', slug: `orgsettings-model-${modelId.slice(0, 8)}`, createdBy: owner.id });

    const result = await deleteOrganisation(owner.client, orgId);
    expect(result).toEqual({ status: 'has_models', count: 1 });

    // Clean up the model so the next test's delete can actually succeed —
    // atlas.delete_model only accepts an already-archived model
    // (20260911040000_model_archive.sql's own precondition).
    await archiveModel(owner.client, modelId);
    await deleteModel(owner.client, modelId);
  });

  it('delete refuses a non-owner', async () => {
    await expect(deleteOrganisation(architect.client, orgId)).rejects.toThrow(/only an owner may delete/);
  });

  it('delete on a non-existent organisation returns not_found rather than throwing', async () => {
    const result = await deleteOrganisation(owner.client, randomUUID());
    expect(result).toEqual({ status: 'not_found' });
  });

  it('an owner can delete an organisation once it has no models', async () => {
    const result = await deleteOrganisation(owner.client, orgId);
    expect(result).toEqual({ status: 'deleted' });

    const { data } = await service.from('organisations').select('id').eq('id', orgId);
    expect(data ?? []).toHaveLength(0);
  });
});
