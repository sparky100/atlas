/**
 * F7 item 5: membership audit against a real local Supabase. Same
 * "this sandbox has no Docker route" limitation named in
 * `repository.integration.test.ts`'s own module comment — written and
 * reasoned through against the real RLS/trigger behaviour, not executed
 * here.
 *
 * Exercises all five `member_events` triggers (`20260916030000_member_events.sql`)
 * end to end through the real repository functions that write `invites`/
 * `members`, plus the owner-only select policy and the org-deletion cascade
 * guard (a pending invite or a member still present when an organisation is
 * deleted must never raise a foreign-key violation).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from './client';
import { createServiceRoleClient, createSupabaseClient } from './client';
import { createInvite, revokeInvite } from './invites';
import { listMemberEvents } from './memberEvents';
import { changeMemberRole, createOrganisation, deleteOrganisation, getMyMembership, removeMember } from './organisations';
import { loadEnv } from './env';

const env = loadEnv();
const service = createServiceRoleClient(env);

interface TestUser {
  id: string;
  email: string;
  client: Client;
}

async function createSignedInUser(label: string, email?: string): Promise<TestUser> {
  const resolvedEmail = email ?? `${label}-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa1!`;
  const { data: created, error: createError } = await service.auth.admin.createUser({ email: resolvedEmail, password, email_confirm: true });
  if (createError) throw new Error(`createSignedInUser(${label}): ${createError.message}`);

  const signIn = createSupabaseClient(env);
  const { error: signInError } = await signIn.auth.signInWithPassword({ email: resolvedEmail, password });
  if (signInError) throw new Error(`createSignedInUser(${label}) sign-in: ${signInError.message}`);

  return { id: created.user.id, email: resolvedEmail, client: signIn };
}

describe('member_events against a real local Supabase', () => {
  let owner: TestUser;
  let secondMember: TestUser;
  let orgId: string;

  beforeAll(async () => {
    owner = await createSignedInUser('memberevents-owner');
    orgId = randomUUID();
    await createOrganisation(owner.client, { id: orgId, name: 'Member Events Test Org', slug: `memberevents-${orgId.slice(0, 8)}`, createdBy: owner.id });

    secondMember = await createSignedInUser('memberevents-second');
    const { error: memberError } = await owner.client.from('members').insert({ org_id: orgId, user_id: secondMember.id, role: 'viewer', invited_by: owner.id });
    if (memberError) throw new Error(`add second member: ${memberError.message}`);
  });

  afterAll(async () => {
    await service.from('organisations').delete().eq('id', orgId);
  });

  it("records 'joined' for the organisation's own creation (the owner, invited by themself) and for a direct member add", async () => {
    const events = await listMemberEvents(owner.client, orgId);
    const ownerJoined = events.find((e) => e.event_type === 'joined' && e.target_user_id === owner.id);
    expect(ownerJoined?.actor_id).toBe(owner.id);
    expect(ownerJoined?.role).toBe('owner');

    const secondJoined = events.find((e) => e.event_type === 'joined' && e.target_user_id === secondMember.id);
    expect(secondJoined?.actor_id).toBe(owner.id);
    expect(secondJoined?.role).toBe('viewer');
  });

  it("records 'invited', then 'joined' via invite consumption, for a fresh signup", async () => {
    const email = `memberevents-invitee-${randomUUID().slice(0, 8)}@example.test`;
    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'contributor', invitedBy: owner.id });
    expect(created.status).toBe('created');

    const events1 = await listMemberEvents(owner.client, orgId);
    const invited = events1.find((e) => e.event_type === 'invited' && e.target_email === email);
    expect(invited?.actor_id).toBe(owner.id);
    expect(invited?.role).toBe('contributor');

    const invitee = await createSignedInUser('memberevents-invitee', email);
    expect((await getMyMembership(invitee.client, orgId, invitee.id))?.role).toBe('contributor');

    const events2 = await listMemberEvents(owner.client, orgId);
    const joined = events2.find((e) => e.event_type === 'joined' && e.target_user_id === invitee.id);
    // The inviter, not the invitee's own session — atlas.consume_invites_for_user
    // carries the original invite's invited_by through, per the migration's
    // own comment.
    expect(joined?.actor_id).toBe(owner.id);
    expect(joined?.role).toBe('contributor');
  });

  it("records 'role_changed' with both the previous and new role", async () => {
    await changeMemberRole(owner.client, orgId, secondMember.id, 'architect');
    const events = await listMemberEvents(owner.client, orgId);
    const roleChanged = events.find((e) => e.event_type === 'role_changed' && e.target_user_id === secondMember.id);
    expect(roleChanged?.actor_id).toBe(owner.id);
    expect(roleChanged?.previous_role).toBe('viewer');
    expect(roleChanged?.role).toBe('architect');
  });

  it("records 'removed' when an owner removes someone else, and 'left' when someone removes themself", async () => {
    await removeMember(owner.client, orgId, secondMember.id);
    const events = await listMemberEvents(owner.client, orgId);
    const removed = events.find((e) => e.event_type === 'removed' && e.target_user_id === secondMember.id);
    expect(removed?.actor_id).toBe(owner.id);
    expect(removed?.role).toBe('architect');

    const thirdMember = await createSignedInUser('memberevents-third');
    const { error: addError } = await owner.client.from('members').insert({ org_id: orgId, user_id: thirdMember.id, role: 'viewer', invited_by: owner.id });
    if (addError) throw new Error(`add third member: ${addError.message}`);
    await removeMember(thirdMember.client, orgId, thirdMember.id);

    const eventsAfterLeave = await listMemberEvents(owner.client, orgId);
    const left = eventsAfterLeave.find((e) => e.event_type === 'left' && e.target_user_id === thirdMember.id);
    expect(left?.actor_id).toBe(thirdMember.id);
  });

  it("records 'invite_revoked' only for revoking a still-pending invite", async () => {
    const email = `memberevents-revoked-${randomUUID().slice(0, 8)}@example.test`;
    const created = await createInvite(owner.client, { id: randomUUID(), orgId, email, role: 'viewer', invitedBy: owner.id });
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('unreachable');

    await revokeInvite(owner.client, created.invite.id);

    const events = await listMemberEvents(owner.client, orgId);
    const revoked = events.find((e) => e.event_type === 'invite_revoked' && e.target_email === email);
    expect(revoked?.actor_id).toBe(owner.id);
    expect(revoked?.role).toBe('viewer');
  });

  it('lists reverse-chronological (most recent event first)', async () => {
    const events = await listMemberEvents(owner.client, orgId);
    const timestamps = events.map((e) => new Date(e.created_at).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('member_events_select is owner-only — a non-owner sees nothing', async () => {
    const viewer = await createSignedInUser('memberevents-viewer');
    const { error: addError } = await owner.client.from('members').insert({ org_id: orgId, user_id: viewer.id, role: 'viewer', invited_by: owner.id });
    if (addError) throw new Error(`add viewer: ${addError.message}`);

    expect(await listMemberEvents(viewer.client, orgId)).toEqual([]);
    await removeMember(owner.client, orgId, viewer.id);
  });

  it('deleting an organisation with a still-pending invite and a still-present member never raises a foreign-key violation (the cascade guard)', async () => {
    const doomedOrgId = randomUUID();
    await createOrganisation(owner.client, { id: doomedOrgId, name: 'Doomed Org', slug: `memberevents-doomed-${doomedOrgId.slice(0, 8)}`, createdBy: owner.id });

    await createInvite(owner.client, { id: randomUUID(), orgId: doomedOrgId, email: `memberevents-doomed-${randomUUID().slice(0, 8)}@example.test`, role: 'viewer', invitedBy: owner.id });

    const result = await deleteOrganisation(owner.client, doomedOrgId);
    expect(result).toEqual({ status: 'deleted' });

    // The audit trail itself cascades away with the organisation — no
    // possible reader remains once it's gone (member_events_select is
    // owner-only, and there's no more org to be an owner of).
    const { data } = await service.from('member_events').select('id').eq('org_id', doomedOrgId);
    expect(data ?? []).toHaveLength(0);
  });
});
